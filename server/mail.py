"""Sending mail.

Two things need it: proving an address belongs to whoever signed up, and letting
someone who has forgotten their password back in.

Backends, chosen with EMAIL_BACKEND:

  log   (default) — writes the whole message, link included, to the server log.
  smtp            — hands it to a relay over STARTTLS.

The log backend is the default on purpose. A pilot has to be able to run with no
mail account at all, and both flows stay testable end to end by reading the
journal (`journalctl -u havak-api | grep -A12 'email/log'`). Nothing silently
half-works: the log line says plainly that no mail was sent.

Delivery from this box directly would be a waste of effort — a fresh VPS address
with no SPF, no DKIM and no reverse DNS gets filed as spam by Gmail whatever the
message says. Use a relay. Notes on picking one are in server/.env.example.

One rule throughout: a mail failure must never fail the request that triggered
it. Someone signing up has already got their account; a dead SMTP relay is our
problem, not a reason to reject them at the door. Every send here reports failure
by returning False and logging, and never by raising.
"""

import asyncio
import logging
import os
import smtplib
from email.message import EmailMessage
from urllib.parse import quote

logger = logging.getLogger("havak.mail")

BACKEND = os.getenv("EMAIL_BACKEND", "log").strip().lower()

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "").strip()

# Whitespace stripped throughout, not just at the ends. Google shows an App
# Password as four spaced groups ("abcd efgh ijkl mnop") and that is exactly how
# it gets pasted into a config file, but SMTP AUTH wants the 16 characters with
# nothing between them — so the obvious thing to paste is the thing that fails,
# with an authentication error that says nothing about spaces. No app password
# from any provider contains one, so there is nothing legitimate to lose here.
SMTP_PASSWORD = "".join(os.getenv("SMTP_PASSWORD", "").split())

# Shown as the sender. Many relays insist this match an address or domain you
# have proven you own, and quietly reject everything otherwise.
MAIL_FROM = os.getenv("MAIL_FROM", "Havak <no-reply@havak.am>")

# Where the links point: the published PWA, not this API. The API serves JSON and
# has no business rendering pages, and a link into the app means the click lands
# on a screen that can explain itself and then carry on into the app.
APP_URL = os.getenv(
    "APP_URL", "https://fedorshoshin.github.io/Dilijan-Business-Hackathon/app.html"
).rstrip("/")

VERIFY_HOURS = int(os.getenv("VERIFY_TOKEN_HOURS", "48"))
RESET_HOURS = int(os.getenv("RESET_TOKEN_HOURS", "1"))


def link(kind: str, token: str) -> str:
    """The URL that goes in the mail.

    A hash route, because the app is a hash router on a static host: `#/reset/x`
    needs no rewrite rule and cannot 404 on refresh. The token is url-safe base64
    so quote() has nothing to do in practice — it is here so that a future change
    to how tokens are generated cannot quietly produce a broken link.
    """
    return f"{APP_URL}#/{kind}/{quote(token, safe='')}"


def _send_smtp(message: EmailMessage) -> None:
    """Blocking. Always called through asyncio.to_thread."""
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as smtp:
        smtp.ehlo()
        if SMTP_PORT != 465:
            smtp.starttls()
            smtp.ehlo()
        if SMTP_USER:
            smtp.login(SMTP_USER, SMTP_PASSWORD)
        smtp.send_message(message)


def _write_to_log(to: str, subject: str, body: str, reason: str, level=logging.INFO) -> None:
    """Put the whole message, link and all, in the journal.

    This is the log backend's only job, and it is also what happens whenever a
    real send fails. A password-reset link that is neither delivered nor written
    down anywhere is a user locked out of their account for good — so when the
    relay refuses, the link goes here and somebody with journal access can still
    get them back in. That is not a leak of anything the operator did not already
    have: root on this box can read the database directly.

    Indented so the whole message reads as one block in the journal.
    """
    logger.log(
        level,
        "email/log — NOT DELIVERED (%s). To: %s\n    Subject: %s\n%s",
        reason,
        to,
        subject,
        "\n".join("    " + line for line in body.splitlines()),
    )


async def send(to: str, subject: str, body: str) -> bool:
    """True if handed off to a relay, False if not sent. Never raises."""
    if BACKEND == "log":
        _write_to_log(to, subject, body, "EMAIL_BACKEND=log")
        return False

    if BACKEND != "smtp":
        _write_to_log(to, subject, body,
                      "EMAIL_BACKEND=%r is not a backend" % BACKEND, logging.ERROR)
        return False

    if not SMTP_HOST:
        # The exact half-configured state you land in by flipping EMAIL_BACKEND to
        # smtp without filling in the relay. Loud, and the link is still written
        # down, so the switch being flipped early costs nothing.
        _write_to_log(to, subject, body,
                      "EMAIL_BACKEND=smtp but SMTP_HOST is empty", logging.ERROR)
        return False

    message = EmailMessage()
    message["From"] = MAIL_FROM
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    try:
        # smtplib is blocking, and a slow relay would otherwise stall every other
        # request on the event loop — there is one worker on a 2 GB box.
        await asyncio.to_thread(_send_smtp, message)
        logger.info("email sent to %s (%s)", to, subject)
        return True
    except Exception as exc:
        # Deliberately broad: DNS, TLS, auth, timeout, a relay refusing the
        # sender. Every one of them means "not delivered", and none of them is
        # the caller's problem to handle.
        _write_to_log(to, subject, body,
                      "%s: %s" % (type(exc).__name__, exc), logging.ERROR)
        return False


# ---------------------------------------------------------------------------
# The two messages
# ---------------------------------------------------------------------------
# Plain text, no HTML. It renders everywhere, cannot leak a tracking pixel, and
# is far less likely to be treated as spam than a single-image template. The link
# appears on its own line so every client makes it tappable.


async def send_verify(to: str, name: str, token: str) -> bool:
    first = (name or "").strip().split(" ")[0] or "there"
    return await send(
        to,
        "Confirm your Havak email",
        f"""Hi {first},

Confirm this address so we know we can reach you about your reports:

{link('verify', token)}

The link works once and expires in {VERIFY_HOURS} hours. If it has expired, open
Havak and tap "Resend" on the banner at the top of your profile.

If you did not create a Havak account, someone typed this address by mistake —
you can ignore this and nothing will happen.

Havak · Հավաք · Dilijan
""",
    )


async def send_reset(to: str, name: str, token: str) -> bool:
    first = (name or "").strip().split(" ")[0] or "there"
    plural = "hour" if RESET_HOURS == 1 else f"{RESET_HOURS} hours"
    return await send(
        to,
        "Reset your Havak password",
        f"""Hi {first},

Someone asked to reset the password for this address. If it was you, set a new
one here:

{link('reset', token)}

The link works once and expires in {plural}. Using it signs you out everywhere
else, so anyone who should not be in your account will be locked out.

If this was not you, ignore this email — your password has not changed and
nobody can get in without this link.

Havak · Հավաք · Dilijan
""",
    )

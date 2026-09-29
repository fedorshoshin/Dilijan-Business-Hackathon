"""Accounts: sign up, log in, log out, who am I, edit my profile.

BACKEND.md §5. A session is a JWT the client keeps in localStorage, so it
survives an app relaunch.
"""

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks

from .. import db, mail, security
from ..errors import NOT_AUTHORISED, NOT_FOUND, VALIDATION_FAILED, ApiError
from ..models import ConfirmEmail, ForgotPassword, LogIn, ProfilePatch, ResetPassword, SignUp
from ..security import CurrentUser

logger = logging.getLogger("havak.auth")

router = APIRouter(tags=["auth"])

PROFILE = "id, name, email, roles, place, avatar_key, joined_at, email_verified_at"
PUBLIC = "id, name, roles, place, avatar_key, joined_at"


def _session(user: dict) -> dict:
    return {"token": security.issue_token(user["id"]), "user": user}


@router.post("/auth/signup")
async def signup(body: SignUp, background: BackgroundTasks):
    email = body.email.strip().lower()

    existing = await db.fetchrow("select 1 from users where lower(email) = $1", email)
    if existing:
        # Deliberately explicit. Hiding whether an email is registered protects
        # nothing here — anyone can discover it by trying to sign up — and being
        # vague just strands a user who forgot they already have an account.
        raise ApiError(VALIDATION_FAILED, "That email already has an account. Try logging in.")

    user = await db.fetchrow(
        f"""insert into users (id, name, email, roles, place, password_hash)
            values ($1, $2, $3, $4, $5, $6)
            returning {PROFILE}""",
        uuid4(),
        body.name.strip(),
        email,
        body.roles,
        (body.place or "").strip() or None,
        security.hash_password(body.password),
    )

    # Best effort, and off the response path: the account exists either way, and
    # a slow relay must not make signing up feel slow. A relay that is down must
    # not turn "welcome to Havak" into "signup failed" either — they can resend
    # from their profile once it is back.
    background.add_task(_email_link_task, "verify", dict(user))

    return _session(user)


@router.post("/auth/login")
async def login(body: LogIn):
    row = await db.fetchrow(
        f"select {PROFILE}, password_hash from users where lower(email) = $1",
        body.email.strip().lower(),
    )
    # Same message for "no such account" and "wrong password", so the response
    # cannot be used to enumerate who has an account.
    if not row or not security.check_password(body.password, row.pop("password_hash", None)):
        raise ApiError(NOT_AUTHORISED, "That email and password do not match.", status=401)
    return _session(row)


@router.post("/auth/logout")
async def logout(user: dict = CurrentUser):
    # Tokens are stateless, so there is nothing to tear down: the client drops
    # the token. This endpoint exists so the client has one thing to call and a
    # place to hang real revocation later.
    return {"ok": True}


@router.get("/me")
async def me(user: dict = CurrentUser):
    return user


@router.patch("/me")
async def update_me(body: ProfilePatch, user: dict = CurrentUser):
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return user

    if "name" in fields:
        fields["name"] = (fields["name"] or "").strip()
        if not fields["name"]:
            raise ApiError(VALIDATION_FAILED, "A name is required.")
    if "place" in fields:
        fields["place"] = (fields["place"] or "").strip() or None

    # Built from a fixed allow-list of column names, never from user input.
    columns = [c for c in ("name", "place", "roles", "avatar_key") if c in fields]
    assignments = ", ".join(f"{c} = ${i + 2}" for i, c in enumerate(columns))
    return await db.fetchrow(
        f"update users set {assignments} where id = $1 returning {PROFILE}",
        user["id"],
        *[fields[c] for c in columns],
    )


@router.get("/users/{user_id}")
async def public_profile(user_id: UUID, _: dict = CurrentUser):
    """What one user is allowed to see about another: no email."""
    row = await db.fetchrow(f"select {PUBLIC} from users where id = $1", user_id)
    if not row:
        raise ApiError(NOT_FOUND, "No such person.")
    return row


# ---------------------------------------------------------------------------
# Confirming an email address, and getting back in without a password
# ---------------------------------------------------------------------------
# Both flows are the same three steps: mint a random token, store only its hash
# with an expiry, mail the raw one as a link into the app. Clicking spends it.
#
# Neither flow may reveal whether an address has an account. Login already takes
# that care; a forgot-password endpoint that 404s on unknown addresses would hand
# back exactly the account list that login refuses to give up.

# Don't mint a second link if one was minted this recently. Without this, anyone
# who knows your address can have our server mail-bomb you by holding down a
# button, and we would be the ones reported for it.
RESEND_AFTER = timedelta(seconds=60)

_EXPIRY = {"verify": timedelta(hours=mail.VERIFY_HOURS), "reset": timedelta(hours=mail.RESET_HOURS)}


async def _recently_sent(user_id, kind: str) -> bool:
    row = await db.fetchrow(
        """select created_at from email_tokens
           where user_id = $1 and kind = $2
           order by created_at desc limit 1""",
        user_id,
        kind,
    )
    return bool(row) and datetime.now(timezone.utc) - row["created_at"] < RESEND_AFTER


async def _send_email_link(kind: str, user: dict) -> bool:
    """Mint, store and mail one link. True if a mail was handed to a relay."""
    token, token_hash = security.new_email_token()
    await db.execute(
        """insert into email_tokens (user_id, kind, token_hash, expires_at)
           values ($1, $2, $3, $4)""",
        user["id"],
        kind,
        token_hash,
        datetime.now(timezone.utc) + _EXPIRY[kind],
    )
    sender = mail.send_verify if kind == "verify" else mail.send_reset
    return await sender(user["email"], user["name"], token)


async def _email_link_task(kind: str, user: dict) -> None:
    """Mint and mail a link after the response has already gone out.

    Everything that depends on the account existing lives in here, which is what
    keeps /auth/forgot from answering faster for an address with no account than
    for one with. See the note on that endpoint.

    Nothing may escape: this runs with no client left to tell, so a failure here
    belongs in the log and nowhere else.
    """
    try:
        if await _recently_sent(user["id"], kind):
            return
        await _send_email_link(kind, user)
    except Exception:
        logger.exception("could not send the %s link", kind)


async def _spend_token(kind: str, token: str) -> dict:
    """The row this token belongs to, marked used. Raises if it is not good.

    Looked up by hash, so a token that is not in the table is indistinguishable
    from one that never existed. The update is conditional on used_at being null,
    which is what makes "one time" true even if two clicks land at once — the
    second update matches no row.
    """
    row = await db.fetchrow(
        """update email_tokens
              set used_at = now()
            where token_hash = $1
              and kind = $2
              and used_at is null
              and expires_at > now()
        returning user_id""",
        security.hash_email_token(token),
        kind,
    )
    if not row:
        # One message for expired, already used, and never existed. Telling them
        # apart helps nobody: the answer either way is "get a fresh link".
        raise ApiError(
            VALIDATION_FAILED,
            "This link has expired or has already been used. Please request a new one.",
        )
    return row


@router.post("/auth/verify")
async def verify_email(body: ConfirmEmail):
    """Spend a confirmation link. No session needed — the link IS the proof.

    Deliberately open: the link arrives by email and may well be opened in a
    browser that has never signed in, or on a different phone from the one that
    signed up. Requiring a session here would strand exactly those people.
    """
    row = await _spend_token("verify", body.token)

    # coalesce: clicking an old link after already verifying should not move the
    # date, and re-verifying is not an error worth showing anyone.
    user = await db.fetchrow(
        f"""update users set email_verified_at = coalesce(email_verified_at, now())
             where id = $1 returning {PROFILE}""",
        row["user_id"],
    )
    return user


@router.post("/auth/verify/resend")
async def resend_verification(background: BackgroundTasks, user: dict = CurrentUser):
    if user["email_verified_at"]:
        return {"ok": True, "alreadyVerified": True}

    # Reported before the send is attempted, because the answer the user needs
    # ("we already sent one, go and look") does not depend on the relay. Tapping
    # twice is not an error and gets no red message.
    throttled = await _recently_sent(user["id"], "verify")
    if not throttled:
        background.add_task(_email_link_task, "verify", dict(user))

    return {"ok": True, "throttled": throttled, "sent": not throttled}


@router.post("/auth/forgot")
async def forgot_password(body: ForgotPassword, background: BackgroundTasks):
    """Always succeeds, whether or not the address has an account.

    The response is identical either way — same shape, same status. This endpoint
    is the easiest place in the whole API to test a list of addresses against, so
    it gives nothing back.

    Identical content is not enough on its own: the first version of this did the
    minting and sending inline, so a registered address answered in 1.7-2.5s and
    an unregistered one in 0.8s. That gap is a perfectly good account oracle —
    you do not need to read the body if you can time it. Everything that only
    happens for a real account is now a background task, so both answers come
    back after the same single SELECT.
    """
    email = body.email.strip().lower()
    user = await db.fetchrow(
        "select id, name, email from users where lower(email) = $1", email
    )

    if user:
        background.add_task(_email_link_task, "reset", dict(user))
    else:
        # Logged, never returned: worth seeing in the journal if somebody is
        # walking a list of addresses through here.
        logger.info("password reset asked for an address with no account")

    return {"ok": True}


@router.post("/auth/reset")
async def reset_password(body: ResetPassword):
    """Set a new password from a link, and sign every device out.

    No session is issued. Whoever clicked has proven they can read the inbox, but
    making them type the new password once more on the login screen costs one
    screen and means a link forwarded or left in a shared browser's history is
    not a session on its own.
    """
    row = await _spend_token("reset", body.token)

    async with db.transaction() as con:
        # tokens_valid_from truncated to the second to match the whole-second
        # `iat` claim on issued tokens; see sql/003_email.sql. One transaction so
        # a password can never change without the sign-out landing with it.
        await con.execute(
            """update users
                  set password_hash = $2,
                      tokens_valid_from = date_trunc('second', now()),
                      email_verified_at = coalesce(email_verified_at, now())
                      -- reading a link sent to that address IS proof of the
                      -- address, which is all verification ever meant
                where id = $1""",
            row["user_id"],
            security.hash_password(body.password),
        )
        # Any other outstanding reset links die with this one. Two "forgot"
        # requests in a row otherwise leave a second live key to the account.
        await con.execute(
            """update email_tokens set used_at = now()
                where user_id = $1 and kind = 'reset' and used_at is null""",
            row["user_id"],
        )

    return {"ok": True}

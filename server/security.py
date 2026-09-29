"""Passwords and sessions.

Passwords are bcrypt hashes. Sessions are signed JWTs held in the client's
localStorage — stateless, so there is nothing to invalidate on logout beyond the
client throwing the token away. For a pilot that is the right trade; if you ever
need real revocation, add a `sessions` table and check it here.
"""

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

import bcrypt
import jwt
from fastapi import Depends, Request

from . import db
from .errors import NOT_AUTHORISED, ApiError

ALGORITHM = "HS256"
TOKEN_DAYS = int(os.getenv("TOKEN_DAYS", "60"))


def _secret() -> str:
    secret = os.environ.get("JWT_SECRET", "")
    if len(secret) < 32:
        raise RuntimeError(
            "JWT_SECRET must be set to at least 32 random characters. "
            "Generate one with: python -c 'import secrets; print(secrets.token_urlsafe(48))'"
        )
    return secret


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def check_password(password: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def issue_token(user_id: UUID) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": str(user_id), "iat": now, "exp": now + timedelta(days=TOKEN_DAYS)},
        _secret(),
        algorithm=ALGORITHM,
    )


def _bearer(request: Request) -> str:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise ApiError(NOT_AUTHORISED, "Please sign in.", status=401)
    return token


async def current_user(request: Request) -> dict:
    """The signed-in user's profile row, or 401.

    Read fresh from the database on every request rather than trusted from the
    token, so a role toggled on one device takes effect on the next call from
    another (DESIGN.md task 1.4).
    """
    token = _bearer(request)
    try:
        payload = jwt.decode(token, _secret(), algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise ApiError(NOT_AUTHORISED, "Your session has expired. Please sign in again.", status=401)
    except jwt.InvalidTokenError:
        raise ApiError(NOT_AUTHORISED, "Please sign in.", status=401)

    user = await db.fetchrow(
        """select id, name, email, roles, place, avatar_key, joined_at,
                  email_verified_at, tokens_valid_from
           from users where id = $1""",
        UUID(payload["sub"]),
    )
    if not user:
        raise ApiError(NOT_AUTHORISED, "This account no longer exists.", status=401)

    # Tokens are stateless, so this is the only thing standing between "I changed
    # my password" and a thief keeping their session for the remaining 59 days.
    # Resetting a password moves tokens_valid_from to now; anything issued before
    # that is refused from here on. Setting the column by hand for one user is a
    # per-account revoke, and for every user a global one.
    issued_at = datetime.fromtimestamp(payload["iat"], tz=timezone.utc)
    if issued_at < user["tokens_valid_from"]:
        raise ApiError(
            NOT_AUTHORISED,
            "Your password was changed, so this device was signed out. Please sign in again.",
            status=401,
        )

    # Internal only: no endpoint should hand a client the revocation watermark.
    user.pop("tokens_valid_from", None)
    return user


CurrentUser = Depends(current_user)


def require_role(role: str):
    """Guard an endpoint on a role the account actually holds."""

    async def dep(user: dict = CurrentUser) -> dict:
        if role not in (user["roles"] or []):
            raise ApiError(NOT_AUTHORISED, f"This needs the {role} role turned on.")
        return user

    return Depends(dep)


# ---------------------------------------------------------------------------
# Email links
# ---------------------------------------------------------------------------
# One-time tokens for confirming an address and resetting a password. Only a
# sha256 of the token is stored (sql/003_email.sql), so what lands in the
# database is useless to whoever steals it: you cannot turn a hash back into a
# link. The raw token exists only in the email and in the URL the user clicks.
#
# sha256 with no salt and no stretching is right here, unlike for passwords. A
# password is short, guessable and reused; this is 32 bytes from os.urandom, so
# there is no dictionary to try and nothing to slow an attacker down for. What
# matters is a constant-time lookup, which a hash gives us for free.

TOKEN_KINDS = ("verify", "reset")


def new_email_token() -> tuple[str, str]:
    """(token to email, hash to store)."""
    token = secrets.token_urlsafe(32)
    return token, hash_email_token(token)


def hash_email_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

"""Accounts: sign up, log in, log out, who am I, edit my profile.

BACKEND.md §5. A session is a JWT the client keeps in localStorage, so it
survives an app relaunch.
"""

from uuid import UUID, uuid4

from fastapi import APIRouter

from .. import db, security
from ..errors import NOT_AUTHORISED, NOT_FOUND, VALIDATION_FAILED, ApiError
from ..models import LogIn, ProfilePatch, SignUp
from ..security import CurrentUser

router = APIRouter(tags=["auth"])

PROFILE = "id, name, email, roles, place, avatar_key, joined_at"
PUBLIC = "id, name, roles, place, avatar_key, joined_at"


def _session(user: dict) -> dict:
    return {"token": security.issue_token(user["id"]), "user": user}


@router.post("/auth/signup")
async def signup(body: SignUp):
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

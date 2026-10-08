"""Request bodies. Responses are plain dicts built from database rows.

Validation here is the server's own guarantee, not a repeat of the client's.
The client validates for fast feedback; anyone can bypass that (BACKEND.md §3).
"""

from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator

ROLES = {"reporter", "cleaner", "donor"}

# What a reporter may ask for one cleanup, in AMD. The floor keeps a job worth
# turning up for; the ceiling stops one typo emptying the whole donation pot.
MIN_PAYOUT = 500
MAX_PAYOUT = 100_000


class SignUp(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    roles: list[str] = Field(min_length=1)
    place: str | None = Field(default=None, max_length=120)

    @field_validator("roles")
    @classmethod
    def known_roles(cls, v: list[str]) -> list[str]:
        unknown = set(v) - ROLES
        if unknown:
            raise ValueError(f"unknown role(s): {', '.join(sorted(unknown))}")
        return sorted(set(v))


class LogIn(BaseModel):
    email: EmailStr
    password: str


class ProfilePatch(BaseModel):
    """Every field optional: this is a patch, absent means unchanged."""

    name: str | None = Field(default=None, min_length=1, max_length=80)
    place: str | None = Field(default=None, max_length=120)
    roles: list[str] | None = None
    avatar_key: str | None = None

    @field_validator("roles")
    @classmethod
    def known_roles(cls, v):
        if v is None:
            return v
        if not v:
            raise ValueError("at least one role is required")
        unknown = set(v) - ROLES
        if unknown:
            raise ValueError(f"unknown role(s): {', '.join(sorted(unknown))}")
        return sorted(set(v))


class ForgotPassword(BaseModel):
    email: EmailStr


class ResetPassword(BaseModel):
    token: str = Field(min_length=16, max_length=200)
    # Same floor as signup. Enforced in both places because this endpoint is a
    # second, entirely separate door onto the password column.
    password: str = Field(min_length=8, max_length=200)


class ConfirmEmail(BaseModel):
    token: str = Field(min_length=16, max_length=200)


class NewReport(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    description: str = Field(min_length=1, max_length=2000)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    loc_x: float = Field(ge=0, le=100)
    loc_y: float = Field(ge=0, le=100)
    loc_label: str = Field(min_length=1, max_length=160)
    level: int = Field(ge=1, le=5)
    hazardous: bool = False
    # 8 hours: beyond that it is not one person's afternoon but a council job,
    # and an estimate is the one number a reporter can inflate to raise a payout.
    est_minutes: int = Field(ge=1, le=8 * 60)
    # The reporter sets the price. Optional only for older copies of the app,
    # which never sent one: those get the suggested price (payout.price).
    payout: int | None = Field(default=None, ge=MIN_PAYOUT, le=MAX_PAYOUT)
    client_id: UUID | None = None


class ReportPatch(BaseModel):
    """The reporter's edit. Every field optional: absent means unchanged."""

    title: str | None = Field(default=None, min_length=3, max_length=120)
    description: str | None = Field(default=None, min_length=1, max_length=2000)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    loc_x: float | None = Field(default=None, ge=0, le=100)
    loc_y: float | None = Field(default=None, ge=0, le=100)
    loc_label: str | None = Field(default=None, min_length=1, max_length=160)
    level: int | None = Field(default=None, ge=1, le=5)
    hazardous: bool | None = None
    est_minutes: int | None = Field(default=None, ge=1, le=8 * 60)
    payout: int | None = Field(default=None, ge=MIN_PAYOUT, le=MAX_PAYOUT)


class Confirm(BaseModel):
    rating: int = Field(ge=1, le=5)


class NewDonation(BaseModel):
    amount: int = Field(gt=0)
    target: str = "general"  # 'general' or a report id
    client_id: UUID | None = None


IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MEDIA_TYPES = IMAGE_TYPES | {"video/mp4", "video/quicktime", "video/webm"}


class UploadRequest(BaseModel):
    """Ask for a signed URL to PUT a file straight to the bucket."""

    report_id: UUID
    kind: str
    mime: str
    client_id: UUID | None = None

    @field_validator("kind")
    @classmethod
    def before_or_after(cls, v: str) -> str:
        if v not in {"before", "after"}:
            raise ValueError("must be 'before' or 'after'")
        return v

    @field_validator("mime")
    @classmethod
    def image_or_video(cls, v: str) -> str:
        # A closed list, because the type decides the file extension in the
        # bucket and the tag the browser renders it with. The client re-encodes
        # every photo to JPEG, so only video arrives in its phone's own format.
        if v not in MEDIA_TYPES:
            raise ValueError("must be a JPEG, PNG or WebP photo, or an MP4, MOV or WebM video")
        return v


class AvatarRequest(BaseModel):
    mime: str

    @field_validator("mime")
    @classmethod
    def image_only(cls, v: str) -> str:
        if v not in IMAGE_TYPES:
            raise ValueError("must be a JPEG, PNG or WebP image")
        return v

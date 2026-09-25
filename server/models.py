"""Request bodies. Responses are plain dicts built from database rows.

Validation here is the server's own guarantee, not a repeat of the client's.
The client validates for fast feedback; anyone can bypass that (BACKEND.md §3).
"""

from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator

ROLES = {"reporter", "cleaner", "donor"}


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
    est_minutes: int = Field(ge=1, le=24 * 60)
    payout: int = Field(ge=0)
    client_id: UUID | None = None


class Confirm(BaseModel):
    rating: int = Field(ge=1, le=5)


class NewDonation(BaseModel):
    amount: int = Field(gt=0)
    target: str = "general"  # 'general' or a report id
    client_id: UUID | None = None


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
        if not (v.startswith("image/") or v.startswith("video/")):
            raise ValueError("must be an image or video type")
        return v


class AvatarRequest(BaseModel):
    mime: str

    @field_validator("mime")
    @classmethod
    def image_only(cls, v: str) -> str:
        if not v.startswith("image/"):
            raise ValueError("must be an image type")
        return v

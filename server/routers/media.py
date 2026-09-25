"""Photos, video and avatars — keys in the database, bytes in the bucket.

The upload is two calls (BACKEND.md §6):

  1. POST /media/upload-url  -> a signed URL and the row it belongs to
  2. client PUTs the file straight to that URL

Bytes never pass through this server, which is what makes a 50 MB video upload
survivable on a small box. The cost of that design is an orphan window: if the
client dies between the two steps, the row exists with no blob behind it. The
client retries the PUT; anything still missing is swept up by /media/{id} which
reports it rather than pretending.
"""

from uuid import UUID, uuid4

from fastapi import APIRouter

from .. import db, storage
from ..errors import NOT_AUTHORISED, NOT_FOUND, STORAGE_QUOTA, VALIDATION_FAILED, ApiError
from ..models import AvatarRequest, UploadRequest
from ..security import CurrentUser

router = APIRouter(tags=["media"])

# The client downscales before uploading, so these caps are a backstop against a
# broken or hostile client, not the primary limit.
MAX_PER_REPORT = 12


def _extension(mime: str) -> str:
    return {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "video/mp4": "mp4",
        "video/quicktime": "mov",
        "video/webm": "webm",
    }.get(mime, "bin")


@router.post("/media/upload-url", status_code=201)
async def request_upload(body: UploadRequest, user: dict = CurrentUser):
    report = await db.fetchrow(
        "select id, reporter_id, status from reports where id = $1", body.report_id
    )
    if not report:
        raise ApiError(NOT_FOUND, "That spot no longer exists.")

    # 'before' photos belong to whoever reported the spot; 'after' photos to
    # whoever is cleaning it. Anything else is someone attaching pictures to a
    # stranger's report.
    if body.kind == "before" and report["reporter_id"] != user["id"]:
        raise ApiError(NOT_AUTHORISED, "Only the reporter can add photos of the spot.")
    if body.kind == "after":
        claim = await db.fetchrow(
            """select cleaner_id from claims
                where report_id = $1 and status in ('active', 'done')
                order by claimed_at desc limit 1""",
            body.report_id,
        )
        if not claim or claim["cleaner_id"] != user["id"]:
            raise ApiError(NOT_AUTHORISED, "Only the cleaner working here can add after photos.")

    count = await db.fetchrow(
        "select count(*) as n from media where report_id = $1 and kind = $2",
        body.report_id,
        body.kind,
    )
    if count["n"] >= MAX_PER_REPORT:
        raise ApiError(
            STORAGE_QUOTA, f"That is the maximum of {MAX_PER_REPORT} {body.kind} files for a spot."
        )

    if body.client_id:
        existing = await db.fetchrow(
            "select id, bucket_key from media where client_id = $1", body.client_id
        )
        if existing:
            return {
                "media_id": existing["id"],
                "bucket_key": existing["bucket_key"],
                "upload_url": await storage.signed_upload_url(
                    storage.MEDIA_BUCKET, existing["bucket_key"]
                ),
            }

    media_id = uuid4()
    key = f"{body.report_id}/{body.kind}/{media_id}.{_extension(body.mime)}"
    upload_url = await storage.signed_upload_url(storage.MEDIA_BUCKET, key)

    row = await db.fetchrow(
        """insert into media (id, owner_id, report_id, kind, mime, bucket_key, client_id)
           values ($1, $2, $3, $4, $5, $6, $7)
        returning id, bucket_key""",
        media_id,
        user["id"],
        body.report_id,
        body.kind,
        body.mime,
        key,
        body.client_id,
    )
    return {"media_id": row["id"], "bucket_key": row["bucket_key"], "upload_url": upload_url}


@router.get("/reports/{report_id}/media")
async def report_media(report_id: UUID, _: dict = CurrentUser):
    """Before and after files for a spot, each with a signed read URL.

    Signed rather than public, because a report photo carries the GPS of a real
    place and the client asked for that choice to be explicit.
    """
    rows = await db.fetch(
        """select id, owner_id, kind, mime, bucket_key, created_at
             from media where report_id = $1 order by created_at""",
        report_id,
    )
    for row in rows:
        row["url"] = await storage.signed_read_url(storage.MEDIA_BUCKET, row["bucket_key"])
    return rows


@router.delete("/media/{media_id}")
async def delete_media(media_id: UUID, user: dict = CurrentUser):
    row = await db.fetchrow("select id, owner_id, bucket_key from media where id = $1", media_id)
    if not row:
        raise ApiError(NOT_FOUND, "That file is already gone.")
    if row["owner_id"] != user["id"]:
        raise ApiError(NOT_AUTHORISED, "You can only remove your own files.")

    await db.execute("delete from media where id = $1", media_id)
    await storage.delete(storage.MEDIA_BUCKET, row["bucket_key"])
    return {"ok": True}


@router.post("/me/avatar/upload-url", status_code=201)
async def request_avatar_upload(body: AvatarRequest, user: dict = CurrentUser):
    """One avatar per user, overwritten in place.

    The path is fixed per user rather than unique per upload, so changing a
    picture does not leave the old one behind. The bucket is public-read: an
    avatar appears next to every name on every list, and signing dozens of URLs
    per screen would cost real latency for no privacy gained (BACKEND.md §6).
    """
    key = f"{user['id']}/avatar.{_extension(body.mime)}"
    return {
        "bucket_key": key,
        "upload_url": await storage.signed_upload_url(storage.AVATAR_BUCKET, key),
        "public_url": storage.public_url(storage.AVATAR_BUCKET, key),
    }


@router.delete("/me/avatar")
async def delete_avatar(user: dict = CurrentUser):
    """Remove the picture; the client falls back to initials."""
    key = user["avatar_key"]
    await db.execute("update users set avatar_key = null where id = $1", user["id"])
    if key:
        await storage.delete(storage.AVATAR_BUCKET, key)
    return {"ok": True}


@router.get("/avatars/{user_id}")
async def avatar_url(user_id: UUID, _: dict = CurrentUser):
    row = await db.fetchrow("select avatar_key from users where id = $1", user_id)
    if not row:
        raise ApiError(NOT_FOUND, "No such person.")
    if not row["avatar_key"]:
        return {"url": None}
    return {"url": storage.public_url(storage.AVATAR_BUCKET, row["avatar_key"])}

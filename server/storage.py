"""Supabase Storage, driven with the service key.

Bytes never pass through this API (BACKEND.md §6): the client asks for a signed
URL and PUTs the file straight to the bucket. That keeps large video uploads off
the server entirely, which matters on a small box.

Two buckets, deliberately different:
  report-media — private. Reads are signed with an expiry.
  avatars      — public-read. An avatar sits next to every name on every list;
                 re-signing dozens of URLs per screen buys no privacy.

Create both in the dashboard (Storage → New bucket) before using these. Leave
their policies empty: only this server holds the service key, so nothing else
can write to them anyway.
"""

import os

import httpx

from .errors import ApiError

MEDIA_BUCKET = os.getenv("MEDIA_BUCKET", "report-media")
AVATAR_BUCKET = os.getenv("AVATAR_BUCKET", "avatars")
READ_URL_TTL = int(os.getenv("READ_URL_TTL", str(60 * 60 * 6)))  # 6 hours

_client: httpx.AsyncClient | None = None


async def connect() -> None:
    global _client
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_KEY"]
    _client = httpx.AsyncClient(
        base_url=f"{base}/storage/v1",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=20,
    )


async def disconnect() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _http() -> httpx.AsyncClient:
    if _client is None:
        raise RuntimeError("storage client is not open")
    return _client


def _storage_base() -> str:
    return os.environ["SUPABASE_URL"].rstrip("/") + "/storage/v1"


async def signed_upload_url(bucket: str, key: str) -> str:
    """A one-shot URL the client can PUT the file to."""
    r = await _http().post(f"/object/upload/sign/{bucket}/{key}")
    if r.status_code >= 400:
        raise ApiError("storage_failed", "Could not prepare the upload. Please try again.")
    # Supabase returns a path like "/object/upload/sign/bucket/key?token=..."
    return _storage_base() + r.json()["url"].removeprefix("/storage/v1")


async def signed_read_url(bucket: str, key: str, ttl: int = READ_URL_TTL) -> str:
    r = await _http().post(f"/object/sign/{bucket}/{key}", json={"expiresIn": ttl})
    if r.status_code >= 400:
        raise ApiError("storage_failed", "Could not load this file.")
    return _storage_base() + r.json()["signedURL"].removeprefix("/storage/v1")


def public_url(bucket: str, key: str) -> str:
    return f"{_storage_base()}/object/public/{bucket}/{key}"


async def delete(bucket: str, key: str) -> None:
    # A missing object is not an error worth surfacing: the row is going away
    # either way, and a half-deleted state is worse than an orphaned blob.
    await _http().delete(f"/object/{bucket}/{key}")

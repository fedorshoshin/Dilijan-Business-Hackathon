"""Cloudflare R2 — keys in the database, bytes in the bucket.

Bytes never pass through this API (BACKEND.md §6): the client asks for a signed
URL and PUTs the file straight to R2. That keeps a 50 MB video upload off the
server entirely, which matters on a box this small.

R2 speaks S3, so every URL here is an ordinary SigV4 presigned URL. Signing is
pure HMAC — no network call, no SDK. That is worth stating, because the Supabase
Storage version of this file had to make an HTTP round trip *per file* to sign a
read, so a spot with twelve photos cost twelve calls before the gallery could
render. Here it costs twelve hashes.

One bucket, two prefixes:
  report-media/<report>/<before|after>/<id>.<ext>
  avatars/<user>/avatar.<ext>

Everything is private and read through a signed URL with an expiry. An R2 bucket
has no per-object ACL — public access means attaching a whole public hostname to
the bucket (r2.dev or a custom domain), which would publish every report photo
along with the avatars. A report photo carries the GPS of a real place, so the
prefixes stay private and avatars pay for a signature they do not strictly need.

Configure with R2_ACCOUNT_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and
R2_SECRET_ACCESS_KEY (see server/.env.example). With no credentials the server
still starts and everything else works; only uploads fail, loudly.
"""

import datetime as dt
import hashlib
import hmac
import logging
import os
from urllib.parse import quote

import httpx

from .errors import ApiError

logger = logging.getLogger("havak.storage")

# The account endpoint, no bucket and no trailing slash:
#   https://<account-id>.r2.cloudflarestorage.com
ENDPOINT = os.getenv("R2_ACCOUNT_ENDPOINT", "").strip().rstrip("/")
BUCKET = os.getenv("R2_BUCKET", "havak").strip().strip("/")
ACCESS_KEY = os.getenv("R2_ACCESS_KEY_ID", "").strip()
SECRET_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "").strip()
REGION = os.getenv("R2_REGION", "auto").strip()  # R2 wants "auto"

# Prefixes, not buckets. Kept in the same names the rest of the code already
# used, so nothing else had to change when the storage behind them did.
MEDIA_BUCKET = os.getenv("MEDIA_PREFIX", "report-media").strip("/")
AVATAR_BUCKET = os.getenv("AVATAR_PREFIX", "avatars").strip("/")

READ_URL_TTL = int(os.getenv("READ_URL_TTL", str(60 * 60 * 6)))  # 6 hours
WRITE_URL_TTL = int(os.getenv("WRITE_URL_TTL", str(60 * 15)))  # 15 minutes

# The dashboard pastes the endpoint with the bucket already on the end. Accept
# that instead of failing in a way nobody could diagnose from the error.
if ENDPOINT.endswith("/" + BUCKET):
    ENDPOINT = ENDPOINT[: -(len(BUCKET) + 1)]

_client: httpx.AsyncClient | None = None


def configured() -> bool:
    return bool(ENDPOINT and ACCESS_KEY and SECRET_KEY)


async def connect() -> None:
    """Open the client used for server-side deletes. Signing needs nothing."""
    global _client
    _client = httpx.AsyncClient(timeout=20)
    if not configured():
        logger.warning(
            "R2 is not configured — photo and avatar uploads will fail. Set "
            "R2_ACCOUNT_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in "
            "server/.env, then restart."
        )
    else:
        logger.info("storage: R2 bucket %r at %s", BUCKET, ENDPOINT)


async def disconnect() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


# ---------------------------------------------------------------------------
# SigV4, query-string flavour
# ---------------------------------------------------------------------------

_UNSIGNED = "UNSIGNED-PAYLOAD"


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def _signing_key(date_stamp: str) -> bytes:
    k = _sign(("AWS4" + SECRET_KEY).encode(), date_stamp)
    k = _sign(k, REGION)
    k = _sign(k, "s3")
    return _sign(k, "aws4_request")


def _presign(method: str, path: str, ttl: int) -> str:
    """A URL that is valid, on its own, for `ttl` seconds and nothing else.

    Only `host` is signed. Signing Content-Type as well would mean the browser's
    PUT had to reproduce it byte for byte or R2 answers 403 — a failure that
    looks like a CORS problem and is not one.
    """
    if not configured():
        raise ApiError(
            "storage_failed",
            "File storage is not set up on the server yet, so this cannot be uploaded.",
        )

    host = ENDPOINT.split("://", 1)[1]
    now = dt.datetime.now(dt.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    scope = f"{date_stamp}/{REGION}/s3/aws4_request"

    query = {
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": f"{ACCESS_KEY}/{scope}",
        "X-Amz-Date": amz_date,
        "X-Amz-Expires": str(ttl),
        "X-Amz-SignedHeaders": "host",
    }
    canonical_query = "&".join(
        f"{quote(k, safe='')}={quote(v, safe='')}" for k, v in sorted(query.items())
    )
    canonical_request = "\n".join(
        [method, path, canonical_query, f"host:{host}\n", "host", _UNSIGNED]
    )
    to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            scope,
            hashlib.sha256(canonical_request.encode()).hexdigest(),
        ]
    )
    signature = hmac.new(_signing_key(date_stamp), to_sign.encode(), hashlib.sha256).hexdigest()
    return f"{ENDPOINT}{path}?{canonical_query}&X-Amz-Signature={signature}"


def _path(prefix: str, key: str) -> str:
    """/bucket/prefix/key with each segment escaped, the slashes left alone."""
    parts = [BUCKET] + [p for p in f"{prefix}/{key}".split("/") if p]
    return "/" + "/".join(quote(p, safe="") for p in parts)


# ---------------------------------------------------------------------------
# What the routers call
# ---------------------------------------------------------------------------


async def signed_upload_url(prefix: str, key: str) -> str:
    """A URL the client can PUT the file to, once, soon."""
    return _presign("PUT", _path(prefix, key), WRITE_URL_TTL)


async def signed_read_url(prefix: str, key: str, ttl: int = READ_URL_TTL) -> str:
    return signed_read_url_sync(prefix, key, ttl)


def signed_read_url_sync(prefix: str, key: str, ttl: int = READ_URL_TTL) -> str:
    return _presign("GET", _path(prefix, key), ttl)


async def delete(prefix: str, key: str) -> None:
    """Best effort. A missing object is not worth surfacing: the row is going
    away either way, and a half-deleted state is worse than an orphaned blob."""
    if _client is None or not configured():
        return
    try:
        await _client.delete(_presign("DELETE", _path(prefix, key), WRITE_URL_TTL))
    except Exception as exc:  # network, DNS, timeout — never fail the request
        logger.warning("could not delete %s/%s from R2: %s", prefix, key, exc)


def sign_urls(data):
    """Turn every bucket key in a response into a signed URL beside it:
    `avatar_key` -> `avatar_url` on any user object however deeply nested (a
    report's reporter, its claim's cleaner), and a report's `cover_key` ->
    `cover_url`. Signing is local and cheap, so a list of forty reports costs a
    hundred-odd HMACs rather than as many follow-up requests from the phone.

    Mutates and returns `data`, so a router can write `return sign_urls(row)`.
    """
    if isinstance(data, list):
        for item in data:
            sign_urls(item)
    elif isinstance(data, dict):
        for value in data.values():
            if isinstance(value, (dict, list)):
                sign_urls(value)
        if "avatar_key" in data:
            key = data["avatar_key"]
            data["avatar_url"] = signed_avatar_url(key) if key else None
        if "cover_key" in data:
            key = data.pop("cover_key")
            data["cover_url"] = (
                signed_read_url_sync(MEDIA_BUCKET, key) if key and configured() else None
            )
    return data


def signed_avatar_url(key: str) -> str | None:
    if not configured():
        return None  # a missing picture falls back to initials; never an error
    return _presign("GET", _path(AVATAR_BUCKET, key), READ_URL_TTL)

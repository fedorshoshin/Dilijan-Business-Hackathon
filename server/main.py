"""Havak API — the server behind the static PWA.

The frontend is published as static files with no backend of its own, so every
request arrives cross-origin from the published site. That makes CORS a
functional requirement, not a detail: get ALLOWED_ORIGINS wrong and the app
silently fails to load anything.

Run locally:   uvicorn server.main:app --reload --port 20220
Run deployed:  uvicorn server.main:app --host 0.0.0.0 --port $PORT
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db, errors, mail, storage
from .routers import auth, media, money, reports

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("havak")


def _origins() -> list[str]:
    """Origins allowed to call this API.

    Comma-separated in ALLOWED_ORIGINS. Must include the published site's exact
    origin — scheme and host, no trailing slash and no path.
    """
    raw = os.getenv("ALLOWED_ORIGINS", "")
    found = [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
    if not found:
        logger.warning(
            "ALLOWED_ORIGINS is empty, so every browser request will be blocked by CORS. "
            "Set it to the published site's origin."
        )
    return found


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    await storage.connect()
    logger.info("havak api ready; allowed origins: %s", _origins() or "(none)")

    # Said loudly, because the failure it describes is invisible from the outside:
    # the app tells people to check their inbox and the API answers 200, while
    # nothing is actually delivered. Better a line in the journal every restart
    # than a pilot user waiting on an email that was never sent.
    if mail.BACKEND == "log":
        logger.warning(
            "EMAIL_BACKEND=log — confirmation and password-reset emails are NOT "
            "being delivered; the links are written to this log instead. Set "
            "EMAIL_BACKEND=smtp and the SMTP_ settings to send them for real."
        )
    elif mail.BACKEND == "smtp" and not mail.SMTP_HOST:
        # Flipping the switch without filling in the relay is the easy mistake,
        # and it is invisible from outside: the app still says "check your inbox"
        # and the API still answers 200. Say so at every start, not only when
        # somebody is already locked out and waiting on a link.
        logger.warning(
            "EMAIL_BACKEND=smtp but SMTP_HOST is empty — no mail can be sent. "
            "Links are being written to this log instead. Fill in SMTP_HOST, "
            "SMTP_USER and SMTP_PASSWORD in server/.env, then restart."
        )
    else:
        logger.info(
            "email backend: %s via %s:%s as %s",
            mail.BACKEND, mail.SMTP_HOST, mail.SMTP_PORT, mail.SMTP_USER or "(no auth)",
        )
    try:
        yield
    finally:
        await storage.disconnect()
        await db.disconnect()


app = FastAPI(
    title="Cleaner Armenia API",
    version="1.0",
    summary="Reporting, cleaning and funding polluted spots around Dilijan.",
    lifespan=lifespan,
)
app.logger = logger

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins(),
    allow_credentials=False,  # the session is a Bearer token, not a cookie
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=3600,
)

errors.install(app)

app.include_router(auth.router)
app.include_router(reports.router)
app.include_router(money.router)
app.include_router(media.router)


@app.get("/health", tags=["meta"])
async def health():
    """Is the server up and can it reach the database?

    Point your host's health check here. It touches the database on purpose: a
    process that is running but cannot reach Postgres is not healthy.
    """
    await db.fetchrow("select 1")
    return {"ok": True}

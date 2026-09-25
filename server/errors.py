"""One error shape, everywhere.

BACKEND.md section 7: the client switches on `error.code` and shows the message.
Anything that is not one of the known codes shows a generic failure, so raising
ApiError with a new code is safe but pointless unless the client learns it.
"""

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

# Codes the client handles specifically.
ALREADY_CLAIMED = "already_claimed"
NOT_AUTHORISED = "not_authorised"
NOT_FOUND = "not_found"
VALIDATION_FAILED = "validation_failed"
STORAGE_QUOTA = "storage_quota"

_STATUS = {
    ALREADY_CLAIMED: 409,
    NOT_AUTHORISED: 403,
    NOT_FOUND: 404,
    VALIDATION_FAILED: 422,
    STORAGE_QUOTA: 413,
}


class ApiError(Exception):
    def __init__(self, code: str, message: str, status: int | None = None):
        self.code = code
        self.message = message
        self.status = status or _STATUS.get(code, 400)


def _body(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


def install(app) -> None:
    """Register the handlers that keep every failure in the same shape."""

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return JSONResponse(status_code=exc.status, content=_body(exc.code, exc.message))

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        field = ".".join(str(p) for p in first.get("loc", ())[1:]) or "request"
        detail = first.get("msg", "is not valid")
        return JSONResponse(
            status_code=422,
            content=_body(VALIDATION_FAILED, f"{field}: {detail}"),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        code = {401: NOT_AUTHORISED, 403: NOT_AUTHORISED, 404: NOT_FOUND}.get(
            exc.status_code, "request_failed"
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=_body(code, str(exc.detail)),
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        # Logged with a stack trace by uvicorn; the client is told nothing that
        # would help an attacker.
        request.app.logger.exception("unhandled error on %s", request.url.path)
        return JSONResponse(
            status_code=500,
            content=_body("server_error", "Something went wrong. Please try again."),
        )

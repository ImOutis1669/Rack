"""FastAPI app: /api routes plus the built frontend served as a SPA."""

import logging
import mimetypes
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.gzip import GZipMiddleware

from rack.api import (
    actions,
    admin,
    auth,
    feed,
    gallery,
    hunts,
    me,
    notify,
    owner_assets,
    profile,
    purchases,
    push,
    refresh,
    search,
    taste,
    thumbs,
)
from rack.config import Settings, get_settings

mimetypes.add_type("application/manifest+json", ".webmanifest")
log = logging.getLogger("rack.api")
CallNext = Callable[[Request], Awaitable[Response]]

API_MAX_BODY = 1024 * 1024  # 1 MB for JSON requests
IMMUTABLE = "public, max-age=31536000, immutable"
UPLOAD_MAX_BODY = 20 * 10 * 1024 * 1024 + 1024 * 1024  # 20 photos x 10 MB + form overhead
AVATAR_MAX_BODY = 10 * 1024 * 1024 + 256 * 1024  # one 10 MB photo + form overhead

# Marketplace photos are hotlinked, so images may come from any https host; everything else is ours.
CSP = (
    "default-src 'self'; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline'; "
    "script-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; "
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'"
)
SECURITY_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}
# httpx logs full request URLs at INFO; Telegram's contains the bot token.
logging.getLogger("httpx").setLevel(logging.WARNING)


def config_problems(s: Settings) -> list[str]:
    """Settings that are unsafe for a public deployment (logged at startup)."""
    problems = []
    if len(s.rack_session_secret) < auth.MIN_SECRET_LENGTH:
        problems.append(
            f"RACK_SESSION_SECRET is shorter than {auth.MIN_SECRET_LENGTH} characters: "
            "logins are refused until it is fixed"
        )
    if not s.rack_password_hash.startswith("$argon2"):
        problems.append(
            "RACK_PASSWORD_HASH is not an argon2 hash: run `rack hash-password` "
            "(it creates the owner account on first login)"
        )
    if s.rack_public_url.startswith("https://") and not s.rack_cookie_secure:
        problems.append("RACK_PUBLIC_URL is https but RACK_COOKIE_SECURE=false")
    return problems


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    for problem in config_problems(get_settings()):
        log.warning("config: %s", problem)
    yield


def create_app(static_dir: Path | None = None) -> FastAPI:
    app = FastAPI(title="Rack", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.include_router(auth.router)
    app.include_router(admin.router)
    app.include_router(me.router)
    app.include_router(owner_assets.router)
    app.include_router(feed.router)
    app.include_router(search.router)
    app.include_router(profile.router)
    app.include_router(taste.router)
    app.include_router(actions.router)
    app.include_router(gallery.router)
    app.include_router(refresh.router)
    app.include_router(hunts.router)
    app.include_router(notify.router)
    app.include_router(push.router)
    app.include_router(purchases.router)
    app.include_router(thumbs.router)

    # JS/CSS/HTML/JSON go out gzipped (the app bundle was sent uncompressed: 383 kB instead of
    # ~128 kB). Photos are already compressed. Responses carry no secrets for BREACH to target.
    app.add_middleware(
        GZipMiddleware,
        minimum_size=1024,
        compresslevel=6,
        exclude_content_types=(
            "text/event-stream",
            "image/webp",
            "image/jpeg",
            "image/png",
            "image/gif",
        ),
    )

    @app.middleware("http")
    async def limits_and_headers(request: Request, call_next: CallNext) -> Response:
        if request.method in ("POST", "PUT", "PATCH"):
            limit = {
                "/api/taste/upload": UPLOAD_MAX_BODY,
                "/api/me/avatar": AVATAR_MAX_BODY,
            }.get(request.url.path, API_MAX_BODY)
            length = request.headers.get("content-length")
            if length is None and request.headers.get("transfer-encoding"):
                return JSONResponse({"detail": "Content-Length required"}, status_code=411)
            if length is not None and (not length.isdigit() or int(length) > limit):
                return JSONResponse({"detail": "Request too large"}, status_code=413)
        response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        if get_settings().rack_cookie_secure:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
        return response

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    root = (static_dir or get_settings().static_dir).resolve()
    index = root / "index.html"

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(404)
        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):
            if path == "sw.js":  # must update promptly; browsers re-check it anyway
                return FileResponse(candidate, headers={"Cache-Control": "no-cache"})
            if path.startswith("assets/"):  # content-hashed names: never change, cache for good
                return FileResponse(candidate, headers={"Cache-Control": IMMUTABLE})
            return FileResponse(candidate)
        if index.is_file():  # always re-checked, so a deploy shows up on the next open
            return FileResponse(index, headers={"Cache-Control": "no-cache"})
        raise HTTPException(404, "Frontend not built")

    return app


app = create_app()

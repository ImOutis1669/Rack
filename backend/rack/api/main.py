"""FastAPI app: /api routes plus the built frontend served as a SPA."""

import mimetypes
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from rack.api import (
    actions,
    auth,
    feed,
    gallery,
    hunts,
    notify,
    profile,
    push,
    refresh,
    taste,
)
from rack.config import get_settings

mimetypes.add_type("application/manifest+json", ".webmanifest")


def create_app(static_dir: Path | None = None) -> FastAPI:
    app = FastAPI(title="Rack", docs_url=None, redoc_url=None, openapi_url=None)
    app.include_router(auth.router)
    app.include_router(feed.router)
    app.include_router(profile.router)
    app.include_router(taste.router)
    app.include_router(actions.router)
    app.include_router(gallery.router)
    app.include_router(refresh.router)
    app.include_router(hunts.router)
    app.include_router(notify.router)
    app.include_router(push.router)

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
            return FileResponse(candidate)
        if index.is_file():
            return FileResponse(index)
        raise HTTPException(404, "Frontend not built")

    return app


app = create_app()

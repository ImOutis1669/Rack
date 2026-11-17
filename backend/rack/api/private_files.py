"""Files that belong to one account (profile photos, wardrobe photos and their thumbnails).

The browser may keep them, but must ask the server again every time (`no-cache`): the server
then checks who's asking, and answers 304 Not Modified when the copy is still right. Without
this, someone else logging in on the same browser could be shown the earlier account's
photos straight from the cache (security audit 2026-11-17, RACK-21).
"""

import hashlib
from pathlib import Path

from fastapi import Request, Response
from fastapi.responses import FileResponse

PRIVATE_NO_CACHE = "private, no-cache"


def file_etag(path: Path) -> str:
    st = path.stat()
    return (
        '"'
        + hashlib.sha256(f"{path.name}:{st.st_mtime_ns}:{st.st_size}".encode()).hexdigest()[:32]
        + '"'
    )


def private_file(
    request: Request, path: Path, media_type: str, vary: str | None = None
) -> Response:
    """The file, or 304 if the browser's copy (If-None-Match) is current. Call only after the
    caller has checked the file belongs to the user making the request."""
    etag = file_etag(path)
    headers = {"Cache-Control": PRIVATE_NO_CACHE, "ETag": etag}
    if vary:
        headers["Vary"] = vary
    sent = request.headers.get("if-none-match", "")
    if etag in {t.strip() for t in sent.split(",")}:
        return Response(status_code=304, headers=headers)
    return FileResponse(path, media_type=media_type, headers=headers)

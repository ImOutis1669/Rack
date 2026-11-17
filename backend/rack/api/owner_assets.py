"""The owner's licensed font and icons (v2.1).

Neue Montreal (personal-use licence) and Basil Icons (Craftwork: no sharing the files) may not be
handed to friends' browsers, so they're not in the public bundle any more. The web app asks for
them here after an owner login; friends get the system font and lucide icons.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from rack.api.auth import require_owner
from rack.config import Settings, get_settings

router = APIRouter(
    prefix="/api/owner-assets", tags=["owner-assets"], dependencies=[Depends(require_owner)]
)
Config = Annotated[Settings, Depends(get_settings)]
FONTS = frozenset({"neuemontreal-regular.otf", "neuemontreal-medium.otf", "neuemontreal-bold.otf"})
# private: only this browser may cache it, never a shared cache
CACHE = {"Cache-Control": "private, max-age=604800"}


def _file(settings: Settings, *parts: str) -> FileResponse:
    root = settings.rack_private_dir.resolve()
    path = root.joinpath(*parts).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, headers=CACHE)


@router.get("/fonts/{name}")
def font(name: str, settings: Config) -> FileResponse:
    if name not in FONTS:  # an allow-list: no paths, no other files
        raise HTTPException(404)
    response = _file(settings, "fonts", name)
    response.media_type = "font/otf"
    response.headers["content-type"] = "font/otf"
    return response


@router.get("/icons.json")
def icons(settings: Config) -> FileResponse:
    response = _file(settings, "basil.json")
    response.headers["content-type"] = "application/json"
    return response

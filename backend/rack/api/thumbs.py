"""GET /api/img/{image_id}?w=480|960 - cached WebP thumbnails of photos Rack already has.

Listing photos are looked up by id (never an arbitrary URL) and downloaded with the same rules
as the worker (embeddings.images.fetch_listing_image: marketplace CDNs only, pinned public IP, no
redirects, 10 MB cap). Wardrobe photos are resized from the local upload.
"""

import asyncio
from pathlib import Path
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from rack.api.auth import require_session
from rack.config import Settings, get_settings
from rack.db import get_session
from rack.embeddings.images import ImageError, fetch_listing_image
from rack.models import ListingImageRow, TasteItemRow
from rack.sources.http import USER_AGENT
from rack.thumbs import WIDTHS, cache_path, make_thumb, write_atomic

router = APIRouter(prefix="/api", tags=["thumbs"], dependencies=[Depends(require_session)])
Session = Annotated[AsyncSession, Depends(get_session)]
Config = Annotated[Settings, Depends(get_settings)]
Width = Annotated[int, Query(description="480 or 960")]


def _width(w: int) -> int:
    if w not in WIDTHS:
        raise HTTPException(422, f"w must be one of {WIDTHS}")
    return w


# Private: behind the login. Immutable: a photo id/URL never changes its picture.
CACHE_HEADERS = {"Cache-Control": "private, max-age=604800, immutable"}
_downloads = asyncio.Semaphore(6)  # at most 6 marketplace downloads at once


async def download(url: str) -> bytes:
    async with (
        _downloads,
        httpx.AsyncClient(timeout=15, headers={"User-Agent": USER_AGENT}) as client,
    ):
        return await fetch_listing_image(url, client)


def thumbs_dir(settings: Settings) -> Path:
    return settings.rack_data_dir / "thumbs"


async def _serve(path: Path) -> FileResponse:
    return FileResponse(path, media_type="image/webp", headers=CACHE_HEADERS)


@router.get("/img/{image_id}")
async def listing_thumb(
    image_id: int, session: Session, settings: Config, w: Width = 480
) -> FileResponse:
    w = _width(w)
    image = await session.get(ListingImageRow, image_id)
    if image is None:
        raise HTTPException(404)
    path = cache_path(thumbs_dir(settings), image.url, w)
    if not path.is_file():
        try:
            data = await download(image.url)
            thumb = await asyncio.to_thread(make_thumb, data, w)
        except ImageError as exc:
            raise HTTPException(502, f"photo unavailable: {exc}") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(502, "photo unavailable") from exc
        await asyncio.to_thread(write_atomic, path, thumb)
    return await _serve(path)


@router.get("/taste/{item_id}/thumb")
async def taste_thumb(
    item_id: int, session: Session, settings: Config, w: Width = 480
) -> FileResponse:
    w = _width(w)
    row = await session.get(TasteItemRow, item_id)
    if row is None or not row.image_path:
        raise HTTPException(404)
    source = settings.uploads_dir / row.image_path
    if not source.is_file():
        raise HTTPException(404)
    path = cache_path(thumbs_dir(settings), f"upload:{row.image_path}", w)
    if not path.is_file():
        data = await asyncio.to_thread(source.read_bytes)
        try:
            thumb = await asyncio.to_thread(make_thumb, data, w)
        except ImageError as exc:
            raise HTTPException(422, str(exc)) from exc
        await asyncio.to_thread(write_atomic, path, thumb)
    return await _serve(path)

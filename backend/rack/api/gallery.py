"""All photos (and the full description) of one listing, fetched from the item page on demand.

Vinted search results carry one photo; the item page has them all. Fetching happens only when you
open a listing, at most once a day per listing, through the same rate-limited client settings as
the worker. eBay search results already include every image; Grailed only exposes a cover photo.
"""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Protocol

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rack.api.auth import require_session
from rack.config import get_settings
from rack.db import get_session
from rack.ingest import set_images
from rack.models import ListingImageRow, ListingRow
from rack.sources.base import SourceError, SourceGone
from rack.sources.vinted import ItemDetails, VintedAdapter
from rack.store import mark_listings_changed

router = APIRouter(prefix="/api", tags=["gallery"], dependencies=[Depends(require_session)])
REFETCH_AFTER = timedelta(days=1)


class DetailFetcher(Protocol):
    async def item_details(self, url: str) -> ItemDetails: ...


_vinted: VintedAdapter | None = None


def get_fetchers() -> dict[str, DetailFetcher]:
    global _vinted
    if _vinted is None:
        _vinted = VintedAdapter(min_interval=get_settings().rate_vinted)
    return {"vinted": _vinted}


class GalleryOut(BaseModel):
    images: list[str]
    description: str | None
    photo_count: int | None  # how many the marketplace says exist, when we can't show them all
    note: str | None


@router.get("/listings/{listing_id}/gallery", response_model=GalleryOut)
async def gallery(
    listing_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    fetchers: Annotated[dict[str, DetailFetcher], Depends(get_fetchers)],
) -> GalleryOut:
    row = await session.get(ListingRow, listing_id)
    if row is None:
        raise HTTPException(404)
    note: str | None = None
    fetcher = fetchers.get(row.source)
    stale = (
        row.details_fetched_at is None or datetime.now(UTC) - row.details_fetched_at > REFETCH_AFTER
    )
    if fetcher is not None and stale and row.active:
        try:
            details = await fetcher.item_details(row.url)
        except SourceGone:
            row.active = False
            row.details_fetched_at = datetime.now(UTC)
            await session.commit()
            note = "This listing is no longer available."
        except SourceError as exc:
            note = f"Couldn't load more photos: {exc}"
        else:
            existing = (
                (
                    await session.execute(
                        select(ListingImageRow).where(ListingImageRow.listing_id == row.id)
                    )
                )
                .scalars()
                .all()
            )
            if details.images:
                await set_images(session, row.id, existing, details.images)
            if details.description:
                row.description = details.description
                # new text may contain measurements: let the worker rescore
                await mark_listings_changed(session)
            if details.available is False:
                row.active = False
                note = "This listing is no longer available."
            row.details_fetched_at = datetime.now(UTC)
            await session.commit()
            await session.refresh(row, ["images"])

    photo_count = None
    if row.source == "grailed":
        photo_count = (row.raw or {}).get("photo_count")
        if not photo_count or photo_count <= len(row.images):
            photo_count = None
    return GalleryOut(
        images=[i.url for i in sorted(row.images, key=lambda i: i.position)],
        description=row.description,
        photo_count=photo_count,
        note=note,
    )

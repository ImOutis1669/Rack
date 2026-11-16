""" "I bought it": turn a (saved) listing into a wardrobe item, and undo that.

The listing row is never deleted here: the wardrobe item keeps its own copy of the photo and the
details, and points back at the listing while it exists.
"""

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from rack.api.auth import require_session
from rack.api.taste import TasteItemOut, store_image, to_out
from rack.config import Settings, get_settings
from rack.db import get_session
from rack.embeddings.images import ImageError, fetch_user_image, is_listing_image_host
from rack.models import ListingRow, SavedRow, TasteItemRow, utcnow
from rack.sources.http import USER_AGENT
from rack.store import bump_version

router = APIRouter(prefix="/api", tags=["purchases"], dependencies=[Depends(require_session)])
Session = Annotated[AsyncSession, Depends(get_session)]
Config = Annotated[Settings, Depends(get_settings)]


class BoughtIn(BaseModel):
    price_gbp: Decimal = Field(ge=0, le=100_000, decimal_places=2)


class UndoOut(BaseModel):
    restored_to_saved: bool


async def download_photo(url: str) -> bytes:
    """The listing's photo, from a marketplace image CDN only (SSRF-checked, size-capped)."""
    if not is_listing_image_host(url):
        raise ImageError("not a marketplace image host")
    async with httpx.AsyncClient(timeout=15, headers={"User-Agent": USER_AGENT}) as client:
        return await fetch_user_image(url, client)


def _snapshot(saved: SavedRow) -> dict[str, Any]:
    def money(v: Decimal | None) -> str | None:
        return str(v) if v is not None else None

    return {
        "saved_at": saved.saved_at.isoformat(),
        "price_gbp_at_save": money(saved.price_gbp_at_save),
        "last_alert_price_gbp": money(saved.last_alert_price_gbp),
    }


@router.post("/listings/{listing_id}/bought", response_model=TasteItemOut)
async def bought(
    listing_id: int, body: BoughtIn, session: Session, settings: Config
) -> TasteItemOut:
    listing = await session.get(ListingRow, listing_id)
    if listing is None:
        raise HTTPException(404)
    dup = await session.execute(
        select(TasteItemRow.id).where(
            TasteItemRow.listing_id == listing_id, TasteItemRow.purchased_at.is_not(None)
        )
    )
    if dup.first() is not None:
        raise HTTPException(409, "Already in your wardrobe")

    photo_url = listing.images[0].url if listing.images else None
    path: str | None = None
    if photo_url:
        try:
            path = await store_image(await download_photo(photo_url), settings)
        except (ImageError, httpx.HTTPError):
            path = None  # still add it: the title shapes the feed through the text match

    saved = await session.get(SavedRow, listing_id)
    row = TasteItemRow(
        kind="wardrobe",
        image_path=path,
        image_url=photo_url if path else None,
        text=" ".join(listing.title.split())[:300] or None,
        listing_id=listing_id,
        source=listing.source,
        listing_url=listing.url,
        brand=listing.brand,
        size=listing.size,
        purchase_price_gbp=body.price_gbp,
        purchased_at=utcnow(),
        saved_snapshot=_snapshot(saved) if saved else None,
    )
    session.add(row)
    if saved is not None:
        await session.delete(saved)  # leaves Saved, so price-drop checks stop too
    await bump_version(session)
    await session.commit()
    return to_out(row)


@router.post("/taste/{item_id}/undo-bought", response_model=UndoOut)
async def undo_bought(item_id: int, session: Session, settings: Config) -> UndoOut:
    row = await session.get(TasteItemRow, item_id)
    if row is None or row.purchased_at is None:
        raise HTTPException(404)
    restored = False
    snap = row.saved_snapshot
    listing = await session.get(ListingRow, row.listing_id) if row.listing_id is not None else None
    if listing is not None and snap:
        await session.execute(
            insert(SavedRow)
            .values(
                listing_id=row.listing_id,
                saved_at=datetime.fromisoformat(snap["saved_at"]),
                price_gbp_at_save=snap.get("price_gbp_at_save"),
                last_alert_price_gbp=snap.get("last_alert_price_gbp"),
            )
            .on_conflict_do_nothing()
        )
        restored = True
    if row.image_path:
        (settings.uploads_dir / row.image_path).unlink(missing_ok=True)
    await session.delete(row)
    await bump_version(session)
    await session.commit()
    return UndoOut(restored_to_saved=restored)

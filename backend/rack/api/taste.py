"""Wardrobe / wishlist items: uploaded photos, pasted image URLs, or plain text."""

import asyncio
import secrets
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Any, Literal

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rack.api.auth import require_session
from rack.config import Settings, get_settings
from rack.db import get_session
from rack.embeddings.images import MAX_BYTES, ImageError, fetch_user_image, sanitize_upload
from rack.models import ListingRow, SoldListingRow, TasteItemRow
from rack.pricing.resale import item_category
from rack.sources.http import USER_AGENT
from rack.store import bump_version

router = APIRouter(prefix="/api/taste", tags=["taste"], dependencies=[Depends(require_session)])
Session = Annotated[AsyncSession, Depends(get_session)]
Config = Annotated[Settings, Depends(get_settings)]
Kind = Literal["wardrobe", "wishlist"]
MAX_FILES = 20


class TasteItemOut(BaseModel):
    id: int
    kind: str
    text: str | None
    note: str | None
    name: str | None = None  # what the item is called (display)
    purchase_date: date | None = None
    category: str | None = None  # set by you; else worked out from the name (see effective)
    effective_category: str = "any"
    image: str | None  # authenticated URL to the stored image
    thumb: str | None = None  # /api/taste/{id}/thumb (add ?w=480|960)
    image_url: str | None  # where it was fetched from, if pasted
    embedded: bool
    embed_error: str | None
    created_at: datetime
    # "I bought it" details (None for items added by hand)
    listing_id: int | None = None
    source: str | None = None
    listing_url: str | None = None
    brand: str | None = None
    size: str | None = None
    purchase_price_gbp: Decimal | None = None
    purchased_at: datetime | None = None
    custom_value_gbp: Decimal | None = None
    estimate_gbp: Decimal | None = None  # median asking price of comparables (None: no estimate)
    estimate_count: int | None = None  # comparables found (None: not estimated)
    estimate_at: datetime | None = None
    estimate_brand: str | None = None  # brand the estimate used
    estimate_kind: str | None = None  # sold (median sold price) | asking (median asking price)
    trend: dict[str, Any] | None = None  # sold-price trend: {"30": {...}|None, "90": ..., "points"}
    photo_missing: bool = False  # bought, but the listing photo couldn't be copied


class UrlIn(BaseModel):
    kind: Kind
    url: str = Field(max_length=2000)
    note: str | None = Field(default=None, max_length=500)
    text: str | None = Field(default=None, max_length=300)
    name: str | None = Field(default=None, max_length=300)


class TextIn(BaseModel):
    kind: Kind
    text: str = Field(min_length=1, max_length=300)


Money = Annotated[Decimal, Field(ge=0, le=100_000, decimal_places=2)]
ItemCategory = Literal["tops", "trousers", "shoes", "outerwear", "accessories"]


class PatchIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)
    text: str | None = Field(default=None, max_length=300)
    # wardrobe value (null clears); doesn't affect ranking
    purchase_price_gbp: Money | None = None
    custom_value_gbp: Money | None = None
    brand: str | None = Field(default=None, max_length=200)
    name: str | None = Field(default=None, max_length=300)
    size: str | None = Field(default=None, max_length=64)
    category: ItemCategory | None = None
    purchase_date: date | None = None

    @field_validator("purchase_date")
    @classmethod
    def _sane_date(cls, v: date | None) -> date | None:
        if v is not None and not (date(1950, 1, 1) <= v <= date.today() + timedelta(days=1)):
            raise ValueError("purchase date must be between 1950 and today")
        return v


def to_out(r: TasteItemRow) -> TasteItemOut:
    return TasteItemOut(
        id=r.id,
        kind=r.kind,
        text=r.text,
        note=r.note,
        name=r.name,
        purchase_date=r.purchase_date,
        category=r.category,
        effective_category=item_category(r).value,
        image=f"/api/taste/{r.id}/image" if r.image_path else None,
        thumb=f"/api/taste/{r.id}/thumb" if r.image_path else None,
        image_url=r.image_url,
        embedded=r.embedding is not None if r.image_path else r.text_embedding is not None,
        embed_error=r.embed_error,
        created_at=r.created_at,
        listing_id=r.listing_id,
        source=r.source,
        listing_url=r.listing_url,
        brand=r.brand,
        size=r.size,
        purchase_price_gbp=r.purchase_price_gbp,
        purchased_at=r.purchased_at,
        custom_value_gbp=r.custom_value_gbp,
        estimate_gbp=r.estimate_gbp,
        estimate_count=r.estimate_count,
        estimate_at=r.estimate_at,
        estimate_brand=(r.estimate_basis or {}).get("brand"),
        estimate_kind=r.estimate_kind,
        trend=r.trend,
        photo_missing=r.purchased_at is not None and not r.image_path,
    )


async def store_image(data: bytes, settings: Settings) -> str:
    clean = await asyncio.to_thread(sanitize_upload, data)
    d = settings.uploads_dir
    d.mkdir(parents=True, exist_ok=True)
    name = f"{secrets.token_hex(16)}.jpg"
    await asyncio.to_thread((d / name).write_bytes, clean)
    return name


def _clean(s: str | None) -> str | None:
    s = " ".join((s or "").split())
    return s or None


@router.get("", response_model=list[TasteItemOut])
async def list_items(session: Session, kind: Kind | None = None) -> list[TasteItemOut]:
    stmt = select(TasteItemRow).order_by(TasteItemRow.created_at.desc())
    if kind:
        stmt = stmt.where(TasteItemRow.kind == kind)
    return [to_out(r) for r in (await session.execute(stmt)).scalars()]


@router.post("/upload", response_model=list[TasteItemOut])
async def upload(
    session: Session,
    settings: Config,
    kind: Annotated[Kind, Form()],
    files: Annotated[list[UploadFile], File()],
    note: Annotated[str | None, Form(max_length=500)] = None,
    text: Annotated[str | None, Form(max_length=300)] = None,
    name: Annotated[str | None, Form(max_length=300)] = None,
) -> list[TasteItemOut]:
    if len(files) > MAX_FILES:
        raise HTTPException(400, f"at most {MAX_FILES} files at once")
    rows: list[TasteItemRow] = []
    for f in files:
        data = await f.read(MAX_BYTES + 1)
        try:
            path = await store_image(data, settings)
        except ImageError as exc:
            raise HTTPException(400, f"{f.filename}: {exc}") from exc
        row = TasteItemRow(
            kind=kind, image_path=path, note=_clean(note), text=_clean(text), name=_clean(name)
        )
        session.add(row)
        rows.append(row)
    await bump_version(session)
    await session.commit()
    return [to_out(r) for r in rows]


@router.post("/url", response_model=TasteItemOut)
async def add_url(body: UrlIn, session: Session, settings: Config) -> TasteItemOut:
    try:
        async with httpx.AsyncClient(timeout=15, headers={"User-Agent": USER_AGENT}) as client:
            data = await fetch_user_image(body.url, client)
        path = await store_image(data, settings)
    except (ImageError, httpx.HTTPError) as exc:
        raise HTTPException(400, f"Couldn't use that link: {exc}") from exc
    row = TasteItemRow(
        kind=body.kind,
        image_path=path,
        image_url=body.url,
        note=_clean(body.note),
        text=_clean(body.text),
        name=_clean(body.name),
    )
    session.add(row)
    await bump_version(session)
    await session.commit()
    return to_out(row)


@router.post("/text", response_model=TasteItemOut)
async def add_text(body: TextIn, session: Session) -> TasteItemOut:
    row = TasteItemRow(kind=body.kind, text=_clean(body.text), name=_clean(body.text))
    session.add(row)
    await bump_version(session)
    await session.commit()
    return to_out(row)


async def _get(session: AsyncSession, item_id: int) -> TasteItemRow:
    row = await session.get(TasteItemRow, item_id)
    if row is None:
        raise HTTPException(404)
    return row


@router.patch("/{item_id}", response_model=TasteItemOut)
async def patch_item(item_id: int, body: PatchIn, session: Session) -> TasteItemOut:
    row = await _get(session, item_id)
    fields = body.model_fields_set
    money = {"purchase_price_gbp", "custom_value_gbp", "purchase_date"} & fields
    if money and row.kind != "wardrobe":
        raise HTTPException(400, "Only wardrobe items have a price, value or purchase date")
    for field in money:
        setattr(row, field, getattr(body, field))
    if "size" in fields:
        row.size = _clean(body.size)
    # brand, name and category feed the resale estimate: re-estimate within a couple of minutes
    for field in ("brand", "name"):
        if field in fields and _clean(getattr(body, field)) != getattr(row, field):
            setattr(row, field, _clean(getattr(body, field)))
            row.estimate_at = None
    if "category" in fields and body.category != row.category:
        row.category = body.category
        row.estimate_at = None
    taste_changed = False
    if "note" in fields:
        row.note = _clean(body.note)
        taste_changed = True
    if "text" in fields and _clean(body.text) != row.text:
        row.text = _clean(body.text)
        row.text_embedding = None
        row.estimate_at = None  # the label can name the brand/category
        taste_changed = True
    if taste_changed:  # prices don't change ranking: no rescore for them
        await bump_version(session)
    await session.commit()
    return to_out(row)


@router.delete("/{item_id}", status_code=204)
async def delete_item(item_id: int, session: Session, settings: Config) -> None:
    row = await _get(session, item_id)
    if row.image_path:
        (settings.uploads_dir / row.image_path).unlink(missing_ok=True)
    await session.delete(row)
    await bump_version(session)
    await session.commit()


class ComparableOut(BaseModel):
    id: int
    title: str
    source: str
    url: str
    price_gbp: Decimal | None
    image: str | None
    similarity: float
    sold_at: datetime | None = None  # set for sold comparables


@router.get("/{item_id}/comparables", response_model=list[ComparableOut])
async def comparables(item_id: int, session: Session, limit: int = 3) -> list[ComparableOut]:
    """The listings behind the item's estimate, closest first (gone ones drop out)."""
    row = await _get(session, item_id)
    basis = (row.estimate_basis or {}).get("comparables") or []
    sims = {int(lid): float(sim) for lid, sim in basis}
    if not sims:
        return []
    n = max(1, min(limit, 15))
    if (row.estimate_basis or {}).get("kind") == "sold":
        sold = (
            (await session.execute(select(SoldListingRow).where(SoldListingRow.id.in_(sims))))
            .scalars()
            .all()
        )
        out_sold = [
            ComparableOut(
                id=x.id,
                title=x.title,
                source=x.source,
                url=f"https://www.grailed.com/listings/{x.source_id}",
                price_gbp=x.sold_price_gbp,
                image=x.image_url,
                similarity=sims[x.id],
                sold_at=x.sold_at,
            )
            for x in sold
        ]
        out_sold.sort(key=lambda c: c.similarity, reverse=True)
        return out_sold[:n]
    listings = (
        (await session.execute(select(ListingRow).where(ListingRow.id.in_(sims)))).scalars().all()
    )
    out = [
        ComparableOut(
            id=listing.id,
            title=listing.title,
            source=listing.source,
            url=listing.url,
            price_gbp=listing.price_gbp,
            image=listing.images[0].url if listing.images else None,
            similarity=sims[listing.id],
        )
        for listing in listings
    ]
    out.sort(key=lambda c: c.similarity, reverse=True)
    return out[:n]


@router.get("/{item_id}/image")
async def item_image(item_id: int, session: Session, settings: Config) -> FileResponse:
    row = await _get(session, item_id)
    if not row.image_path:
        raise HTTPException(404)
    path = settings.uploads_dir / row.image_path
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(
        path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"}
    )

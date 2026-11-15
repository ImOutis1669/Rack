"""Wardrobe / wishlist items: uploaded photos, pasted image URLs, or plain text."""

import asyncio
import secrets
from datetime import datetime
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rack.api.auth import require_session
from rack.config import Settings, get_settings
from rack.db import get_session
from rack.embeddings.images import MAX_BYTES, ImageError, fetch_user_image, sanitize_upload
from rack.models import TasteItemRow
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
    image: str | None  # authenticated URL to the stored image
    image_url: str | None  # where it was fetched from, if pasted
    embedded: bool
    embed_error: str | None
    created_at: datetime


class UrlIn(BaseModel):
    kind: Kind
    url: str = Field(max_length=2000)
    note: str | None = Field(default=None, max_length=500)
    text: str | None = Field(default=None, max_length=300)


class TextIn(BaseModel):
    kind: Kind
    text: str = Field(min_length=1, max_length=300)


class PatchIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)
    text: str | None = Field(default=None, max_length=300)


def to_out(r: TasteItemRow) -> TasteItemOut:
    return TasteItemOut(
        id=r.id,
        kind=r.kind,
        text=r.text,
        note=r.note,
        image=f"/api/taste/{r.id}/image" if r.image_path else None,
        image_url=r.image_url,
        embedded=r.embedding is not None if r.image_path else r.text_embedding is not None,
        embed_error=r.embed_error,
        created_at=r.created_at,
    )


async def _store_image(data: bytes, settings: Settings) -> str:
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
) -> list[TasteItemOut]:
    if len(files) > MAX_FILES:
        raise HTTPException(400, f"at most {MAX_FILES} files at once")
    rows: list[TasteItemRow] = []
    for f in files:
        data = await f.read(MAX_BYTES + 1)
        try:
            path = await _store_image(data, settings)
        except ImageError as exc:
            raise HTTPException(400, f"{f.filename}: {exc}") from exc
        row = TasteItemRow(kind=kind, image_path=path, note=_clean(note), text=_clean(text))
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
        path = await _store_image(data, settings)
    except (ImageError, httpx.HTTPError) as exc:
        raise HTTPException(400, f"Couldn't use that link: {exc}") from exc
    row = TasteItemRow(
        kind=body.kind,
        image_path=path,
        image_url=body.url,
        note=_clean(body.note),
        text=_clean(body.text),
    )
    session.add(row)
    await bump_version(session)
    await session.commit()
    return to_out(row)


@router.post("/text", response_model=TasteItemOut)
async def add_text(body: TextIn, session: Session) -> TasteItemOut:
    row = TasteItemRow(kind=body.kind, text=_clean(body.text))
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
    if "note" in body.model_fields_set:
        row.note = _clean(body.note)
    if "text" in body.model_fields_set and _clean(body.text) != row.text:
        row.text = _clean(body.text)
        row.text_embedding = None
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

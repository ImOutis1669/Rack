"""Your own account (v2.1 step 4): profile details, profile photo, delete my account."""

import asyncio
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from rack.account_files import remove_user_files
from rack.accounts import MAX_PASSWORD, AccountError, check_display_name
from rack.api.auth import (
    COOKIE,
    User,
    attempts,
    client_ip,
    forget_user,
    require_user,
    trusted_proxy_ips,
    user_attempts,
    verify_password,
)
from rack.api.private_files import private_file
from rack.avatars import avatar_path, make_avatar
from rack.config import Settings, get_settings
from rack.db import get_session
from rack.embeddings.images import MAX_BYTES, ImageError
from rack.models import UserRow
from rack.thumbs import write_atomic

router = APIRouter(prefix="/api/me", tags=["me"], dependencies=[Depends(require_user)])
Session = Annotated[AsyncSession, Depends(get_session)]
Config = Annotated[Settings, Depends(get_settings)]


class MeOut(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
    created_at: datetime
    avatar: str | None  # /api/me/avatar?v=N, or None for the initials placeholder


class MePatch(BaseModel):
    display_name: str = Field(max_length=200)


class DeleteBody(BaseModel):
    password: str = Field(max_length=MAX_PASSWORD * 4)


def avatar_url(row: UserRow) -> str | None:
    return f"/api/me/avatar?v={row.avatar_version}" if row.avatar_version else None


def _out(row: UserRow) -> MeOut:
    return MeOut(
        id=row.id,
        username=row.username,
        display_name=row.display_name,
        role=row.role,
        created_at=row.created_at,
        avatar=avatar_url(row),
    )


async def _row(session: AsyncSession, user_id: int) -> UserRow:
    row = await session.get(UserRow, user_id)
    if row is None:  # deleted mid-request
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
    return row


@router.get("")
async def get_me(user: User, session: Session) -> MeOut:
    return _out(await _row(session, user.id))


@router.patch("")
async def patch_me(body: MePatch, user: User, session: Session) -> MeOut:
    row = await _row(session, user.id)
    try:
        row.display_name = check_display_name(body.display_name, row.username)
    except AccountError as exc:
        raise HTTPException(400, str(exc)) from exc
    await session.commit()
    forget_user(user.id)
    return _out(row)


@router.put("/avatar")
async def put_avatar(
    user: User, session: Session, settings: Config, file: Annotated[UploadFile, File()]
) -> MeOut:
    data = await file.read(MAX_BYTES + 1)
    try:
        photo = await asyncio.to_thread(make_avatar, data)
    except ImageError as exc:
        raise HTTPException(400, f"Couldn't use that photo: {exc}") from exc
    await asyncio.to_thread(write_atomic, avatar_path(settings.rack_data_dir, user.id), photo)
    row = await _row(session, user.id)
    row.avatar_version = (row.avatar_version or 0) + 1
    await session.commit()
    return _out(row)


@router.delete("/avatar")
async def delete_avatar(user: User, session: Session, settings: Config) -> MeOut:
    avatar_path(settings.rack_data_dir, user.id).unlink(missing_ok=True)
    row = await _row(session, user.id)
    row.avatar_version = None
    await session.commit()
    return _out(row)


@router.get("/avatar")
async def get_avatar(user: User, settings: Config, request: Request) -> Response:
    """Only your own photo; the owner sees friends' through /api/admin/users/{id}/avatar."""
    path = avatar_path(settings.rack_data_dir, user.id)
    if not path.is_file():
        raise HTTPException(404)
    return private_file(request, path, "image/jpeg")


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    body: DeleteBody,
    user: User,
    request: Request,
    response: Response,
    session: Session,
    settings: Config,
) -> None:
    """Delete your account and everything of yours: taste, wardrobe, photos, Saved, votes,
    hunts, alerts, devices. Needs your password. The owner account can't be deleted here."""
    if user.is_owner:
        raise HTTPException(400, "The owner account can't be deleted")
    ip = client_ip(request, await trusted_proxy_ips(settings))
    if attempts.blocked(ip) or user_attempts.blocked(user.username):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts, try later")
    row = await _row(session, user.id)
    if not await asyncio.to_thread(verify_password, body.password, row.password_hash):
        attempts.fail(ip)
        user_attempts.fail(user.username)
        raise HTTPException(400, "Wrong password")
    await remove_user_files(session, settings, user.id)
    await session.delete(row)
    await session.commit()
    forget_user(user.id)
    response.delete_cookie(COOKIE, path="/")

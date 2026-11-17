"""Owner-only account admin (v2.1): friends' accounts and invites."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from rack.accounts import invite_expiry, invite_hash, invite_status, new_invite_code
from rack.api.auth import CurrentUser, forget_user, require_owner
from rack.config import Settings, get_settings
from rack.db import get_session
from rack.models import InviteRow, UserRow

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_owner)])
Session = Annotated[AsyncSession, Depends(get_session)]
Owner = Annotated[CurrentUser, Depends(require_owner)]


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
    created_at: datetime
    disabled: bool
    last_active_at: datetime | None


def _user_out(r: UserRow) -> UserOut:
    return UserOut(
        id=r.id,
        username=r.username,
        display_name=r.display_name,
        role=r.role,
        created_at=r.created_at,
        disabled=r.disabled_at is not None,
        last_active_at=r.last_active_at,
    )


@router.get("/users")
async def list_users(session: Session) -> list[UserOut]:
    rows = (await session.execute(select(UserRow).order_by(UserRow.id))).scalars()
    return [_user_out(r) for r in rows]


async def _friend(session: AsyncSession, user_id: int) -> UserRow:
    row = await session.get(UserRow, user_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such user")
    if row.role == "owner":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The owner account can't be changed here")
    return row


@router.post("/users/{user_id}/disable")
async def disable_user(user_id: int, session: Session) -> UserOut:
    """Blocks logins and ends every session of that user at once."""
    row = await _friend(session, user_id)
    row.disabled_at = row.disabled_at or datetime.now(UTC)
    row.session_epoch += 1
    await session.commit()
    forget_user(row.id)
    return _user_out(row)


@router.post("/users/{user_id}/enable")
async def enable_user(user_id: int, session: Session) -> UserOut:
    row = await _friend(session, user_id)
    row.disabled_at = None
    await session.commit()
    forget_user(row.id)
    return _user_out(row)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: int, session: Session) -> None:
    """Deletes the account (from step 2 on, everything theirs goes with it: ON DELETE CASCADE)."""
    row = await _friend(session, user_id)
    await session.delete(row)
    await session.commit()
    forget_user(user_id)


class InviteOut(BaseModel):
    id: int
    note: str | None
    created_at: datetime
    expires_at: datetime
    status: str  # open | used | revoked | expired
    used_by: str | None = None


class NewInvite(BaseModel):
    note: str | None = Field(default=None, max_length=100)


class CreatedInvite(InviteOut):
    code: str  # shown once; only its hash is stored
    url: str


@router.get("/invites")
async def list_invites(session: Session) -> list[InviteOut]:
    rows = (
        await session.execute(
            select(InviteRow, UserRow.username)
            .outerjoin(UserRow, UserRow.id == InviteRow.used_by)
            .order_by(InviteRow.id.desc())
            .limit(100)
        )
    ).all()
    now = datetime.now(UTC)
    return [
        InviteOut(
            id=r.id,
            note=r.note,
            created_at=r.created_at,
            expires_at=r.expires_at,
            status=invite_status(r, now),
            used_by=name,
        )
        for r, name in rows
    ]


@router.post("/invites", status_code=status.HTTP_201_CREATED)
async def create_invite(
    body: NewInvite,
    owner: Owner,
    session: Session,
    settings: Annotated[Settings, Depends(get_settings)],
) -> CreatedInvite:
    code = new_invite_code()
    row = InviteRow(
        code_hash=invite_hash(code),
        note=(body.note or "").strip() or None,
        created_by=owner.id,
        expires_at=invite_expiry(settings),
    )
    session.add(row)
    await session.commit()
    # The code goes in the fragment: browsers never send it to the server or in a Referer.
    url = f"{settings.rack_public_url.rstrip('/')}/join#{code}"
    return CreatedInvite(
        id=row.id,
        note=row.note,
        created_at=row.created_at,
        expires_at=row.expires_at,
        status="open",
        code=code,
        url=url,
    )


@router.delete("/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(invite_id: int, session: Session) -> None:
    await session.execute(
        update(InviteRow)
        .where(InviteRow.id == invite_id, InviteRow.used_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    await session.commit()

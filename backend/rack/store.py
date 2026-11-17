"""Shared DB helpers: per-user profile rows and state, the global app_state store, and the
owner-scoped lookups every route uses (v2.1: every personal query names its user)."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from rack.models import AppStateRow, DesignerRow, ProfileRow, UserRow, UserStateRow
from rack.profile import Profile

ACTIVE_FOR = timedelta(days=30)  # users seen within this are scored and searched for


async def get_profile_row(session: AsyncSession, user_id: int) -> ProfileRow:
    row = await session.scalar(select(ProfileRow).where(ProfileRow.user_id == user_id))
    if row is None:
        row = ProfileRow(user_id=user_id, data=Profile().model_dump(mode="json"), version=1)
        session.add(row)
        await session.flush()
    return row


async def load_profile(session: AsyncSession, user_id: int) -> tuple[Profile, int]:
    row = await get_profile_row(session, user_id)
    return Profile.model_validate(row.data), row.version


async def bump_version(session: AsyncSession, user_id: int) -> int:
    """Anything that changes a user's ranking (profile, designers, taste, feedback, hidden)
    calls this; the worker rescores that user."""
    row = await get_profile_row(session, user_id)
    row.version += 1
    row.updated_at = datetime.now(UTC)
    return row.version


async def load_designers(session: AsyncSession, user_id: int) -> dict[str, str]:
    rows = (
        await session.execute(
            select(DesignerRow).where(DesignerRow.user_id == user_id).order_by(DesignerRow.id)
        )
    ).scalars()
    return {r.name: r.weight for r in rows}


async def get_owned[T](session: AsyncSession, model: type[T], row_id: int, user_id: int) -> T:
    """The row with this id if it belongs to `user_id`, else 404 (never 403: ids don't leak)."""
    row = await session.get(model, row_id)
    if row is None or getattr(row, "user_id") != user_id:  # noqa: B009 - any owned model
        raise HTTPException(404)
    return row


async def active_user_ids(session: AsyncSession, now: datetime | None = None) -> list[int]:
    """Enabled users seen in the last 30 days, plus the owner always (worker scope)."""
    since = (now or datetime.now(UTC)) - ACTIVE_FOR
    rows = await session.execute(
        select(UserRow.id)
        .where(
            UserRow.disabled_at.is_(None),
            or_(UserRow.role == "owner", UserRow.last_active_at >= since),
        )
        .order_by(UserRow.id)
    )
    return list(rows.scalars())


async def user_role(session: AsyncSession, user_id: int) -> str | None:
    return await session.scalar(select(UserRow.role).where(UserRow.id == user_id))


async def get_state(session: AsyncSession, key: str) -> dict[str, Any]:
    row = await session.get(AppStateRow, key)
    return dict(row.value) if row else {}


async def set_state(session: AsyncSession, key: str, value: dict[str, Any]) -> None:
    row = await session.get(AppStateRow, key)
    if row is None:
        session.add(AppStateRow(key=key, value=value))
    else:
        row.value = value


async def mark_listings_changed(session: AsyncSession) -> None:
    """Listings, photos or prices changed: every user's scores are due (friends' throttled)."""
    state = await get_state(session, "scoring")
    await set_state(session, "scoring", {**state, "changed_at": datetime.now(UTC).isoformat()})


async def active_users(session: AsyncSession, now: datetime | None = None) -> list[tuple[int, str]]:
    """(id, role) of the users the worker works for: see `active_user_ids`."""
    since = (now or datetime.now(UTC)) - ACTIVE_FOR
    rows = await session.execute(
        select(UserRow.id, UserRow.role)
        .where(
            UserRow.disabled_at.is_(None),
            or_(UserRow.role == "owner", UserRow.last_active_at >= since),
        )
        .order_by(UserRow.id)
    )
    return [(int(i), str(r)) for i, r in rows.all()]


async def get_user_state(session: AsyncSession, user_id: int, key: str) -> dict[str, Any]:
    row = await session.get(UserStateRow, (user_id, key))
    return dict(row.value) if row else {}


async def set_user_state(
    session: AsyncSession, user_id: int, key: str, value: dict[str, Any]
) -> None:
    row = await session.get(UserStateRow, (user_id, key))
    if row is None:
        session.add(UserStateRow(user_id=user_id, key=key, value=value))
    else:
        row.value = value

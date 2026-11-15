"""Shared DB helpers for the profile row and the app_state key/value store."""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rack.models import AppStateRow, DesignerRow, ProfileRow
from rack.profile import Profile

PROFILE_ID = 1


async def get_profile_row(session: AsyncSession) -> ProfileRow:
    row = await session.get(ProfileRow, PROFILE_ID)
    if row is None:
        row = ProfileRow(id=PROFILE_ID, data=Profile().model_dump(mode="json"), version=1)
        session.add(row)
        await session.flush()
    return row


async def load_profile(session: AsyncSession) -> tuple[Profile, int]:
    row = await get_profile_row(session)
    return Profile.model_validate(row.data), row.version


async def bump_version(session: AsyncSession) -> int:
    """Anything that changes ranking (profile, designers, taste, feedback, hidden) calls this."""
    row = await get_profile_row(session)
    row.version += 1
    row.updated_at = datetime.now(UTC)
    return row.version


async def load_designers(session: AsyncSession) -> dict[str, str]:
    rows = (await session.execute(select(DesignerRow).order_by(DesignerRow.id))).scalars()
    return {r.name: r.weight for r in rows}


async def get_state(session: AsyncSession, key: str) -> dict[str, Any]:
    row = await session.get(AppStateRow, key)
    return dict(row.value) if row else {}


async def set_state(session: AsyncSession, key: str, value: dict[str, Any]) -> None:
    row = await session.get(AppStateRow, key)
    if row is None:
        session.add(AppStateRow(key=key, value=value))
    else:
        row.value = value

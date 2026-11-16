"""Send a notification once per key, on every configured channel."""

import logging
from collections.abc import Sequence
from typing import Any

from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from rack.config import Settings
from rack.models import NotificationRow
from rack.notify.base import Channel, Notification, NotifyError
from rack.notify.ntfy import NtfyChannel
from rack.notify.telegram import TelegramChannel

log = logging.getLogger(__name__)


def build_channels(settings: Settings) -> list[Channel]:
    channels: list[Channel] = [
        NtfyChannel(settings.ntfy_url, settings.ntfy_topic, settings.ntfy_token),
        TelegramChannel(settings.telegram_bot_token, settings.telegram_chat_id),
    ]
    return [c for c in channels if c.configured]


async def send_all(channels: Sequence[Channel], n: Notification) -> dict[str, str]:
    results: dict[str, str] = {}
    for ch in channels:
        try:
            await ch.send(n)
            results[ch.name] = "ok"
        except NotifyError as exc:
            log.warning("notify via %s failed: %s", ch.name, exc)
            results[ch.name] = str(exc)
    return results


async def notify_once(
    session: AsyncSession,
    channels: Sequence[Channel],
    *,
    key: str,
    kind: str,
    n: Notification,
    listing_id: int | None = None,
) -> bool:
    """Claim `key`, then send. Returns False if it was already sent (or nothing could send).

    If every channel fails, the claim is released so a later run can retry.
    """
    if not channels:
        return False
    values: dict[str, Any] = {
        "key": key[:200],
        "kind": kind,
        "listing_id": listing_id,
        "title": n.title,
        "body": n.body,
        "url": n.url,
    }
    claimed = (
        await session.execute(
            insert(NotificationRow)
            .values(**values)
            .on_conflict_do_nothing(index_elements=[NotificationRow.key])
            .returning(NotificationRow.id)
        )
    ).scalar_one_or_none()
    if claimed is None:
        return False
    await session.commit()  # claim first, so a crash mid-send can't cause a duplicate later

    results = await send_all(channels, n)
    if not any(v == "ok" for v in results.values()):
        await session.execute(delete(NotificationRow).where(NotificationRow.id == claimed))
        await session.commit()
        return False
    row = await session.get(NotificationRow, claimed)
    if row is not None:
        row.channels = results
    await session.commit()
    return True

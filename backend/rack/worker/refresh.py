"""Source refresh: run queries against every adapter, isolating failures per source."""

import logging
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.ingest import record_error, record_not_configured, record_success, upsert_listings
from rack.sources.base import SearchQuery, SourceAdapter, SourceNotConfigured

log = logging.getLogger(__name__)


async def refresh_source(
    adapter: SourceAdapter, queries: Sequence[SearchQuery], session: AsyncSession
) -> int:
    """Run all queries for one adapter. Never raises; returns number of listings stored."""
    total = 0
    for query in queries:
        try:
            listings = await adapter.search(query)
        except SourceNotConfigured as exc:
            await record_not_configured(session, adapter.name, str(exc))
            await session.commit()
            return total
        except Exception as exc:  # noqa: BLE001 - one broken source must never break the rest
            log.warning("source %s failed on %r: %s", adapter.name, query.text, exc)
            await session.rollback()
            await record_error(session, adapter.name, f"{type(exc).__name__}: {exc}")
            await session.commit()
            continue
        await upsert_listings(session, listings)
        await record_success(session, adapter.name, len(listings))
        await session.commit()
        total += len(listings)
    return total


async def refresh_all(
    adapters: Sequence[SourceAdapter],
    queries: Sequence[SearchQuery],
    sessions: async_sessionmaker[AsyncSession],
) -> dict[str, int]:
    results: dict[str, int] = {}
    for adapter in adapters:
        async with sessions() as session:
            results[adapter.name] = await refresh_source(adapter, queries, session)
    return results

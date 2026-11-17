"""Live searches ("search the marketplaces now", v2.1 step 4b).

One request at a time, oldest first. Each source is asked once, side by side, through the
worker's shared adapters, so the crawler's rules hold: one request in flight per source, its
minimum gap (>= 10 s on Vinted and Grailed), honest UA, no evasion. Results become ordinary
shared listings; the request row lists what each source found, updated as each one finishes.
"""

import asyncio
import json
import logging
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.ingest import record_error, record_success, upsert_listings
from rack.models import SearchRequestRow
from rack.sources.base import Category, SearchQuery, SourceAdapter, SourceNotConfigured
from rack.sources.registry import SOURCE_NAMES
from rack.store import mark_listings_changed
from rack.worker.hunts import count_ebay_search

log = logging.getLogger(__name__)
STALE_RUNNING = timedelta(minutes=10)
KEEP_FINISHED = timedelta(days=1)  # queries are personal: don't keep them around
PER_RUN = 5


async def _claim(sessions: async_sessionmaker[AsyncSession], now: datetime) -> int | None:
    async with sessions() as s:
        row = (
            await s.execute(
                select(SearchRequestRow)
                .where(SearchRequestRow.status == "queued")
                .order_by(SearchRequestRow.created_at, SearchRequestRow.id)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
        ).scalar_one_or_none()
        if row is None:
            return None
        row.status, row.started_at = "running", now
        await s.commit()
        return row.id


async def _one_source(
    sessions: async_sessionmaker[AsyncSession],
    adapter: SourceAdapter,
    request_id: int,
    user_id: int,
    q: SearchQuery,
) -> None:
    async with sessions() as s:
        try:
            if adapter.name == "ebay":
                await count_ebay_search(s, user_id)
                await s.commit()
            listings = await adapter.search(q)
        except SourceNotConfigured:
            result: object = "not set up"
            ids: list[int] = []
        except Exception as exc:  # noqa: BLE001 - one source failing never stops the others
            log.warning("live search %s on %s failed: %s", request_id, adapter.name, exc)
            await s.rollback()
            await record_error(s, adapter.name, f"{type(exc).__name__}: {exc}")
            await s.commit()
            result, ids = "failed", []
        else:
            ids = await upsert_listings(s, listings)
            await record_success(s, adapter.name, len(listings))
            result = len(ids)
        # append atomically: the other sources update the same row at the same time
        await s.execute(
            text(
                "UPDATE search_requests SET listing_ids = listing_ids || CAST(:ids AS jsonb), "
                "results = results || jsonb_build_object(CAST(:src AS text), CAST(:res AS jsonb)) "
                "WHERE id = :id"
            ),
            {
                "ids": _json(ids),
                "src": adapter.name,
                "res": _json(result),
                "id": request_id,
            },
        )
        await s.commit()


def _json(v: object) -> str:
    return json.dumps(v)


async def run_live_searches(
    sessions: async_sessionmaker[AsyncSession],
    adapters: Mapping[str, SourceAdapter],
    now: datetime | None = None,
) -> int:
    """Runs queued live searches (up to PER_RUN); returns how many ran."""
    now = now or datetime.now(UTC)
    async with sessions() as s:  # a crash mid-run leaves "running": give up on it
        await s.execute(
            update(SearchRequestRow)
            .where(
                SearchRequestRow.status == "running",
                SearchRequestRow.started_at < now - STALE_RUNNING,
            )
            .values(status="error", finished_at=now)
        )
        await s.execute(
            delete(SearchRequestRow).where(SearchRequestRow.created_at < now - KEEP_FINISHED)
        )
        await s.commit()
    ran = 0
    for _ in range(PER_RUN):
        request_id = await _claim(sessions, now)
        if request_id is None:
            break
        async with sessions() as s:
            row = await s.get(SearchRequestRow, request_id)
            assert row is not None
            q = SearchQuery(
                text=row.query,
                category=Category(row.category),
                max_price_gbp=row.max_price_gbp,
                limit=50,
            )
            user_id = row.user_id
        sources = [adapters[n] for n in SOURCE_NAMES if n in adapters]
        await asyncio.gather(*(_one_source(sessions, a, request_id, user_id, q) for a in sources))
        async with sessions() as s:
            row = await s.get(SearchRequestRow, request_id)
            if row is not None:
                failed = all(v in ("failed", "not set up") for v in (row.results or {}).values())
                row.status = "error" if failed and row.results else "done"
                row.finished_at = datetime.now(UTC)
            await mark_listings_changed(s)  # new listings: score them for everyone
            await s.commit()
        log.info("live search %s: %s", request_id, row.results if row else "gone")
        ran += 1
    return ran

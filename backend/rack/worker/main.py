"""Worker process: APScheduler running source refreshes, embeddings and rescoring."""

import asyncio
import contextlib
import logging
import signal
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from rack.config import get_settings
from rack.db import sessionmaker
from rack.embeddings.clip import ClipEmbedder
from rack.ingest import record_check
from rack.models import AdjacentDesignerRow, TasteItemRow
from rack.ranking.planner import PlannerInput, all_queries, fallback, next_batch
from rack.sources.base import SearchQuery
from rack.sources.http import RateLimitedClient
from rack.sources.recheck import BLOCKED_SOURCES, check
from rack.sources.registry import build_adapters
from rack.store import get_state, load_designers, load_profile, set_state
from rack.worker.refresh import refresh_all
from rack.worker.taste import assign_clusters, embed_listings, embed_taste, rescore

log = logging.getLogger("rack.worker")


async def plan_queries() -> list[SearchQuery]:
    settings = get_settings()
    async with sessionmaker()() as s:
        profile, _ = await load_profile(s)
        designers = await load_designers(s)
        adjacent: dict[str, list[str]] = {}
        for row in (await s.execute(select(AdjacentDesignerRow))).scalars():
            adjacent.setdefault(row.designer, []).append(row.adjacent)
        wish = (
            (
                await s.execute(
                    select(TasteItemRow.text).where(
                        TasteItemRow.kind == "wishlist",
                        TasteItemRow.text.is_not(None),
                        TasteItemRow.image_path.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        queries = all_queries(PlannerInput(profile, designers, adjacent, [str(w) for w in wish]))
        if not queries:
            return fallback(settings.seed_queries)
        state = await get_state(s, "planner")
        batch, cursor = next_batch(
            queries, int(state.get("cursor", 0)), settings.rack_queries_per_refresh
        )
        await set_state(s, "planner", {"cursor": cursor, "total": len(queries)})
        await s.commit()
        return batch


async def run_refresh() -> None:
    settings = get_settings()
    adapters = build_adapters(settings)
    queries = await plan_queries()
    log.info("refresh: %d queries (%s)", len(queries), ", ".join(q.text for q in queries))
    try:
        results = await refresh_all(adapters, queries, sessionmaker())
        log.info("refresh done: %s", results)
        async with sessionmaker()() as s:
            await set_state(s, "refresh", {"at": datetime.now(UTC).isoformat(), "results": results})
            await s.commit()
    finally:
        for a in adapters:
            close = getattr(a, "aclose", None)
            if close:
                await close()


async def recheck_blocked() -> None:
    for name, url in BLOCKED_SOURCES.items():
        blocked, detail = await check(url)
        log.info("recheck %s: %s", name, detail)
        async with sessionmaker()() as s:
            await record_check(s, name, blocked=blocked, detail=detail)
            await s.commit()


class EmbedAndScore:
    def __init__(self) -> None:
        settings = get_settings()
        self.settings = settings
        self.embedder = ClipEmbedder(settings.clip_model, settings.clip_pretrained)
        self.images: dict[str, RateLimitedClient] = {}

    async def fetch(self, url: str) -> bytes:
        """One request in flight per image host, RATE_IMAGES seconds apart."""
        host = urlsplit(url).hostname or ""
        if host not in self.images:
            self.images[host] = RateLimitedClient(
                min_interval=self.settings.rate_images, jitter=0.3
            )
        resp = await self.images[host].get(url)
        resp.raise_for_status()
        return resp.content

    async def run(self) -> None:
        sessions = sessionmaker()
        try:
            await embed_taste(sessions, self.embedder, self.settings.uploads_dir)
            await embed_listings(
                sessions,
                self.embedder,
                self.fetch,
                images_per_listing=self.settings.rack_embed_images_per_listing,
            )
            await assign_clusters(sessions)
            await rescore(sessions, self.embedder)
        except Exception:
            log.exception("embed/score run failed")


async def first_refresh_at(minutes: int) -> datetime:
    """Restarts don't re-hit the sources: wait out the rest of the interval since the last run."""
    now = datetime.now(UTC)
    async with sessionmaker()() as s:
        last = (await get_state(s, "refresh")).get("at")
    if not last:
        return now
    return max(now, datetime.fromisoformat(last) + timedelta(minutes=minutes))


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = get_settings()
    scheduler = AsyncIOScheduler(timezone="UTC")
    now = datetime.now(UTC)
    scheduler.add_job(
        run_refresh,
        "interval",
        minutes=settings.rack_refresh_minutes,
        id="refresh",
        max_instances=1,
        coalesce=True,
        next_run_time=await first_refresh_at(settings.rack_refresh_minutes),
    )
    scheduler.add_job(
        EmbedAndScore().run,
        "interval",
        seconds=settings.rack_score_seconds,
        id="embed_score",
        max_instances=1,
        coalesce=True,
        next_run_time=now,
    )
    scheduler.add_job(
        recheck_blocked,
        "interval",
        hours=24,
        id="recheck_blocked",
        max_instances=1,
        coalesce=True,
        next_run_time=now,
    )
    scheduler.start()
    log.info("worker started; refresh every %s min", settings.rack_refresh_minutes)

    stop = asyncio.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):  # Windows dev
            asyncio.get_running_loop().add_signal_handler(sig, stop.set)
    await stop.wait()
    scheduler.shutdown()


if __name__ == "__main__":
    asyncio.run(main())

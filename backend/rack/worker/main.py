"""Worker process: APScheduler running source refreshes, embeddings and rescoring."""

import asyncio
import contextlib
import logging
import signal
from datetime import UTC, datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from rack.config import get_settings
from rack.db import sessionmaker
from rack.embeddings.clip import ClipEmbedder
from rack.models import AdjacentDesignerRow, TasteItemRow
from rack.ranking.planner import PlannerInput, all_queries, fallback, next_batch
from rack.sources.base import SearchQuery
from rack.sources.http import RateLimitedClient
from rack.sources.registry import build_adapters
from rack.store import get_state, load_designers, load_profile, set_state
from rack.worker.refresh import refresh_all
from rack.worker.taste import embed_listings, embed_taste, rescore

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
    finally:
        for a in adapters:
            close = getattr(a, "aclose", None)
            if close:
                await close()


class EmbedAndScore:
    def __init__(self) -> None:
        settings = get_settings()
        self.settings = settings
        self.embedder = ClipEmbedder(settings.clip_model, settings.clip_pretrained)
        self.images = RateLimitedClient(min_interval=settings.rate_images, jitter=0.3)

    async def fetch(self, url: str) -> bytes:
        resp = await self.images.get(url)
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
            await rescore(sessions, self.embedder)
        except Exception:
            log.exception("embed/score run failed")


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
        next_run_time=now,  # run once at startup, then on the interval
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

"""Worker process: APScheduler running source refreshes (later: embeddings, hunts, price drops)."""

import asyncio
import contextlib
import logging
import signal
from datetime import UTC, datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from rack.config import get_settings
from rack.db import sessionmaker
from rack.sources.base import SearchQuery
from rack.sources.registry import build_adapters
from rack.worker.refresh import refresh_all

log = logging.getLogger("rack.worker")


async def run_refresh() -> None:
    settings = get_settings()
    adapters = build_adapters(settings)
    queries = [SearchQuery(text=q) for q in settings.seed_queries]
    try:
        results = await refresh_all(adapters, queries, sessionmaker())
        log.info("refresh done: %s", results)
    finally:
        for a in adapters:
            close = getattr(a, "aclose", None)
            if close:
                await close()


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = get_settings()
    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(
        run_refresh,
        "interval",
        minutes=settings.rack_refresh_minutes,
        id="refresh",
        max_instances=1,
        coalesce=True,
        next_run_time=datetime.now(UTC),  # run once at startup, then on the interval
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

"""Worker process: APScheduler running source refreshes, embeddings, rescoring and paid sources."""

import asyncio
import contextlib
import logging
import signal
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from rack.config import get_settings
from rack.db import sessionmaker
from rack.embeddings.clip import ClipEmbedder
from rack.ingest import record_check, record_error, record_success, upsert_listings
from rack.models import AdjacentDesignerRow, TasteItemRow
from rack.notify.dispatch import build_channels
from rack.ranking.planner import PlannerInput, all_queries, fallback, next_batch
from rack.sources.base import SearchQuery, SourceError
from rack.sources.http import RateLimitedClient
from rack.sources.recheck import BLOCKED_SOURCES, check
from rack.sources.vestiaire import VestiaireApifyAdapter, parse_items
from rack.store import get_state, load_designers, load_profile, set_state
from rack.worker.adapters import shared_adapters
from rack.worker.hunts import run_due_hunts
from rack.worker.price_drops import check_saved_prices
from rack.worker.refresh import refresh_all
from rack.worker.taste import assign_clusters, embed_listings, embed_taste, rescore

log = logging.getLogger("rack.worker")
_refresh_lock = asyncio.Lock()


def _now() -> datetime:
    return datetime.now(UTC)


async def plan_queries(state_key: str = "planner", size: int | None = None) -> list[SearchQuery]:
    """Next `size` queries from the taste profile, rotating through them via a stored cursor."""
    settings = get_settings()
    size = size or settings.rack_queries_per_refresh
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
            return fallback(settings.seed_queries)[:size]
        state = await get_state(s, state_key)
        batch, cursor = next_batch(queries, int(state.get("cursor", 0)), size)
        await set_state(s, state_key, {"cursor": cursor, "total": len(queries)})
        await s.commit()
        return batch


async def _update_state(key: str, **values: Any) -> None:
    async with sessionmaker()() as s:
        state = await get_state(s, key)
        await set_state(s, key, {**state, **values})
        await s.commit()


async def run_refresh() -> None:
    """Search every free source with the next batch of planned queries (one run at a time)."""
    if _refresh_lock.locked():
        log.info("refresh already running; skipped")
        return
    async with _refresh_lock:
        adapters = list(shared_adapters().values())
        await _update_state("refresh", running=True, started_at=_now().isoformat())
        results: dict[str, int] = {}
        try:
            queries = await plan_queries()
            log.info("refresh: %d queries (%s)", len(queries), ", ".join(q.text for q in queries))
            results = await refresh_all(adapters, queries, sessionmaker())
            log.info("refresh done: %s", results)
        finally:
            await _update_state("refresh", running=False, at=_now().isoformat(), results=results)


async def run_vestiaire() -> None:
    """Paid Apify actor: a few queries on a slow schedule, under a monthly result cap."""
    settings = get_settings()
    if not settings.apify_token:
        return
    month = _now().strftime("%Y-%m")
    async with sessionmaker()() as s:
        usage = await get_state(s, "vestiaire_usage")
    used = int(usage.get("results", 0)) if usage.get("month") == month else 0
    cap = settings.vestiaire_monthly_result_cap
    if used >= cap:
        async with sessionmaker()() as s:
            await record_error(
                s,
                "vestiaire",
                f"Monthly Apify result cap reached ({used}/{cap}); "
                "raise VESTIAIRE_MONTHLY_RESULT_CAP to continue",
            )
            await s.commit()
        return

    queries = await plan_queries("vestiaire_planner", settings.vestiaire_queries_per_run)
    adapter = VestiaireApifyAdapter(settings.apify_token, enrich=settings.vestiaire_enrich)
    try:
        for q in queries:
            remaining = cap - used
            if remaining <= 0:
                break
            adapter.max_results = min(settings.vestiaire_max_results, remaining)
            try:
                rows = await adapter.run_actor(q)
            except SourceError as exc:
                async with sessionmaker()() as s:
                    await record_error(s, "vestiaire", str(exc))
                    await s.commit()
                break  # don't keep paying for failing runs
            used += len(rows)  # Apify bills every returned row, even ones Rack filters out
            listings = parse_items(rows)
            async with sessionmaker()() as s:
                await upsert_listings(s, listings)
                await record_success(s, "vestiaire", len(listings))
                await set_state(s, "vestiaire_usage", {"month": month, "results": used})
                await s.commit()
            log.info(
                "vestiaire %r: %d rows, %d kept (%d/%d this month)",
                q.text,
                len(rows),
                len(listings),
                used,
                cap,
            )
    finally:
        await adapter.aclose()
        await _update_state("vestiaire_run", at=_now().isoformat())


async def recheck_blocked() -> None:
    settings = get_settings()
    for name, url in BLOCKED_SOURCES.items():
        if name == "vestiaire" and settings.apify_token:
            continue  # served by the Apify actor instead
        blocked, detail = await check(url)
        log.info("recheck %s: %s", name, detail)
        async with sessionmaker()() as s:
            await record_check(s, name, blocked=blocked, detail=detail)
            await s.commit()
    await _update_state("recheck", at=_now().isoformat())


async def run_hunts() -> None:
    try:
        await run_due_hunts(sessionmaker(), shared_adapters(), build_channels(get_settings()))
    except Exception:
        log.exception("hunts run failed")


async def run_price_checks() -> None:
    settings = get_settings()
    try:
        n = await check_saved_prices(
            sessionmaker(), shared_adapters(), build_channels(settings), settings
        )
        if n:
            log.info("price drops: %d alerts sent", n)
    except Exception:
        log.exception("price check failed")


class EmbedAndScore:
    def __init__(self) -> None:
        settings = get_settings()
        self.settings = settings
        self.embedder = ClipEmbedder(settings.clip_model, settings.clip_pretrained)
        self.images: dict[str, RateLimitedClient] = {}
        self._lock = asyncio.Lock()

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
        if self._lock.locked():
            return
        async with self._lock:
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


class ManualRefresh:
    """Runs a refresh when the app's Refresh button asked for one (see api/refresh.py)."""

    def __init__(self, embed: EmbedAndScore) -> None:
        self.embed = embed

    async def run(self) -> None:
        async with sessionmaker()() as s:
            request = await get_state(s, "refresh_request")
            done = await get_state(s, "refresh")
        asked = request.get("at")
        started = done.get("started_at")
        if not asked or (started and started >= asked) or _refresh_lock.locked():
            return
        log.info("manual refresh requested at %s", asked)
        await run_refresh()
        await self.embed.run()


async def resume_at(state_key: str, every: timedelta) -> datetime:
    """Restarts don't re-hit sources: wait out the rest of the interval since the last run."""
    async with sessionmaker()() as s:
        last = (await get_state(s, state_key)).get("at")
    if not last:
        return _now()
    return max(_now(), datetime.fromisoformat(last) + every)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    # httpx logs full request URLs at INFO; Telegram's contains the bot token.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    settings = get_settings()
    scheduler = AsyncIOScheduler(timezone="UTC")
    now = _now()
    embed = EmbedAndScore()
    refresh_every = timedelta(minutes=settings.rack_refresh_minutes)
    vestiaire_every = timedelta(hours=settings.vestiaire_refresh_hours)
    jobs: list[tuple[Any, timedelta, str, datetime]] = [
        (run_refresh, refresh_every, "refresh", await resume_at("refresh", refresh_every)),
        (embed.run, timedelta(seconds=settings.rack_score_seconds), "embed_score", now),
        (ManualRefresh(embed).run, timedelta(seconds=10), "manual_refresh", now),
        (run_hunts, timedelta(minutes=1), "hunts", now),
        (run_price_checks, timedelta(minutes=30), "price_drops", now),
        (
            recheck_blocked,
            timedelta(days=1),
            "recheck_blocked",
            await resume_at("recheck", timedelta(days=1)),
        ),
        (
            run_vestiaire,
            vestiaire_every,
            "vestiaire",
            await resume_at("vestiaire_run", vestiaire_every),
        ),
    ]
    for func, every, job_id, first in jobs:
        scheduler.add_job(
            func,
            "interval",
            seconds=every.total_seconds(),
            id=job_id,
            max_instances=1,
            coalesce=True,
            next_run_time=first,
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

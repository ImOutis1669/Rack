"""Worker process: APScheduler running source refreshes, embeddings, rescoring and paid sources."""

import asyncio
import contextlib
import logging
import signal
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from urllib.parse import urlsplit

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from rack.config import get_settings
from rack.db import sessionmaker
from rack.embeddings.clip import ClipEmbedder
from rack.embeddings.images import (
    MAX_BYTES,
    ImageError,
    is_listing_image_host,
    pinned_request,
    resolve_public,
)
from rack.ingest import record_check, record_error, record_success, upsert_listings
from rack.models import AdjacentDesignerRow, TasteItemRow
from rack.notify.dispatch import build_channels
from rack.pricing.fx import fetch_rates, set_live_rates
from rack.privacy import purge_ebay
from rack.ranking.planner import PlannerInput, all_queries, fallback, next_batch
from rack.sources.base import SearchQuery, SourceError
from rack.sources.ebay import EbayAdapter
from rack.sources.grailed import GrailedAdapter
from rack.sources.http import RateLimitedClient
from rack.sources.recheck import BLOCKED_SOURCES, check
from rack.sources.vestiaire import VestiaireApifyAdapter, parse_items
from rack.store import get_state, load_designers, load_profile, set_state
from rack.thumbs import prune
from rack.worker.adapters import shared_adapters
from rack.worker.ebay_details import fetch_ebay_details
from rack.worker.hunts import run_due_hunts
from rack.worker.llm_job import llm_rerank, make_client
from rack.worker.price_drops import check_saved_prices
from rack.worker.refresh import refresh_all
from rack.worker.resale import refresh_estimates
from rack.worker.sold import embed_sold, fetch_sold
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


async def run_refresh(size: int | None = None) -> None:
    """Search every free source with the next batch of planned queries (one run at a time)."""
    if _refresh_lock.locked():
        log.info("refresh already running; skipped")
        return
    async with _refresh_lock:
        adapters = list(shared_adapters().values())
        await _update_state("refresh", running=True, started_at=_now().isoformat())
        results: dict[str, int] = {}
        try:
            queries = await plan_queries(size=size)
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


async def update_fx() -> None:
    """Daily ECB rates; conversions fall back to static rates if this fails."""
    try:
        date, rates = await fetch_rates()
    except Exception as exc:  # noqa: BLE001 - static fallbacks keep working
        log.warning("FX update failed: %s", exc)
        return
    set_live_rates(rates)
    async with sessionmaker()() as s:
        await set_state(
            s,
            "fx",
            {
                "date": date,
                "rates": {k: str(v) for k, v in rates.items()},
                "at": _now().isoformat(),
            },
        )
        await s.commit()
    log.info(
        "FX rates updated (%s): 1 USD = £%s, 1 EUR = £%s", date, rates.get("USD"), rates.get("EUR")
    )


async def load_fx() -> None:
    async with sessionmaker()() as s:
        fx = await get_state(s, "fx")
    if fx.get("rates"):
        set_live_rates({k: Decimal(v) for k, v in fx["rates"].items()})


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
        await run_due_hunts(
            sessionmaker(), shared_adapters(), build_channels(get_settings(), sessionmaker())
        )
    except Exception:
        log.exception("hunts run failed")


async def run_price_checks() -> None:
    settings = get_settings()
    try:
        n = await check_saved_prices(
            sessionmaker(), shared_adapters(), build_channels(settings, sessionmaker()), settings
        )
        if n:
            log.info("price drops: %d alerts sent", n)
    except Exception:
        log.exception("price check failed")


async def purge_ebay_listings() -> None:
    """Keep "I do not persist eBay data" true: drop eBay listings that are gone or stale."""
    try:
        async with sessionmaker()() as s:
            n = await purge_ebay(s, get_settings().rack_ebay_retention_days, _now())
            await s.commit()
        if n:
            log.info("eBay retention: deleted %d listings", n)
    except Exception:
        log.exception("eBay retention purge failed")


def _ebay() -> EbayAdapter | None:
    adapter = shared_adapters().get("ebay")
    return adapter if isinstance(adapter, EbayAdapter) and adapter.configured else None


async def run_ebay_details() -> None:
    """Size/brand/department for new eBay listings (search results don't have them)."""
    adapter = _ebay()
    if adapter is None:
        return
    settings = get_settings()
    try:
        n = await fetch_ebay_details(
            sessionmaker(),
            adapter,
            daily_cap=settings.rack_ebay_details_daily_cap,
            batch=settings.rack_ebay_details_batch,
            now=_now(),
        )
        if n:
            log.info("eBay details: looked up %d listings", n)
    except Exception:
        log.exception("eBay details failed")


async def prune_thumbnails() -> None:
    """Keep the thumbnail cache within its age and size limits."""
    settings = get_settings()
    try:
        n = await asyncio.to_thread(
            prune,
            settings.rack_data_dir / "thumbs",
            max_bytes=settings.rack_thumbs_max_mb * 1024 * 1024,
            max_age_s=settings.rack_thumbs_max_age_days * 86400,
        )
        if n:
            log.info("thumbnails: pruned %d", n)
    except Exception:
        log.exception("thumbnail prune failed")


async def run_sold_prices() -> None:
    """Grailed sold prices for branded wardrobe items, once a day each (5c)."""
    adapter = shared_adapters().get("grailed")
    if not isinstance(adapter, GrailedAdapter):
        return
    try:
        n = await fetch_sold(sessionmaker(), adapter, _now())
        if n:
            log.info("sold prices: %d new Grailed sales", n)
    except Exception:
        log.exception("sold prices failed")


async def run_resale_estimates() -> None:
    """Wardrobe resale estimates (5b): new photos/brands promptly, everything every 6 h."""
    try:
        n = await refresh_estimates(sessionmaker(), _now())
        if n:
            log.info("resale estimates: %d wardrobe items", n)
    except Exception:
        log.exception("resale estimates failed")


async def save_ebay_usage() -> None:
    """Persist today's eBay call counts for the health panel (and across restarts)."""
    adapter = _ebay()
    if adapter is None:
        return
    async with sessionmaker()() as s:
        await set_state(s, "ebay_usage", dict(adapter.usage))
        await s.commit()


async def load_ebay_usage() -> None:
    adapter = _ebay()
    if adapter is None:
        return
    async with sessionmaker()() as s:
        adapter.restore_usage(await get_state(s, "ebay_usage"))


class EmbedAndScore:
    def __init__(self) -> None:
        settings = get_settings()
        self.settings = settings
        self.embedder = ClipEmbedder(settings.clip_model, settings.clip_pretrained)
        self.images: dict[str, RateLimitedClient] = {}
        self._lock = asyncio.Lock()
        self.llm = make_client(settings) if settings.llm_enabled else None

    async def fetch(self, url: str) -> bytes:
        """One request in flight per image host, RATE_IMAGES seconds apart.

        Listing photo URLs are third-party data: only https marketplace CDNs on public addresses,
        connected to the address we checked, and no redirects.
        """
        if not is_listing_image_host(url):
            raise ImageError(f"refusing image host {urlsplit(url).hostname!r}")
        ip = await resolve_public(url)
        pinned, headers, ext = pinned_request(url, ip)
        host = urlsplit(url).hostname or ""
        if host not in self.images:
            self.images[host] = RateLimitedClient(
                min_interval=self.settings.rate_images, jitter=0.3
            )
        resp = await self.images[host].get(
            pinned, headers=headers, extensions=ext, follow_redirects=False
        )
        if resp.status_code != 200:
            raise ImageError(f"image fetch HTTP {resp.status_code}")
        if len(resp.content) > MAX_BYTES:
            raise ImageError("image larger than 10 MB")
        return resp.content

    async def run(self) -> int:
        """Returns how many listing photos were embedded (0 when idle or already running)."""
        if self._lock.locked():
            return 0
        async with self._lock:
            sessions = sessionmaker()
            n = 0
            try:
                await embed_taste(sessions, self.embedder, self.settings.uploads_dir)
                n = await embed_listings(
                    sessions,
                    self.embedder,
                    self.fetch,
                    images_per_listing=self.settings.rack_embed_images_per_listing,
                )
                await embed_sold(sessions, self.embedder, self.fetch)
                await assign_clusters(sessions)
                await rescore(sessions, self.embedder)
                if self.llm is not None:
                    await llm_rerank(sessions, self.settings, self.llm)
            except Exception:
                log.exception("embed/score run failed")
            return n


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
        await run_refresh(get_settings().rack_manual_queries)
        # A run embeds up to 200 photos; go straight on to the next batch rather than waiting
        # for the scheduled pass, so new results show up as soon as possible.
        for _ in range(4):
            if not await self.embed.run():
                break


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
    await load_fx()
    await load_ebay_usage()
    refresh_every = timedelta(minutes=settings.rack_refresh_minutes)
    vestiaire_every = timedelta(hours=settings.vestiaire_refresh_hours)
    jobs: list[tuple[Any, timedelta, str, datetime]] = [
        (run_refresh, refresh_every, "refresh", await resume_at("refresh", refresh_every)),
        (embed.run, timedelta(seconds=settings.rack_score_seconds), "embed_score", now),
        (ManualRefresh(embed).run, timedelta(seconds=10), "manual_refresh", now),
        (update_fx, timedelta(hours=24), "fx", await resume_at("fx", timedelta(hours=24))),
        (run_hunts, timedelta(minutes=1), "hunts", now),
        (run_price_checks, timedelta(minutes=30), "price_drops", now),
        (purge_ebay_listings, timedelta(hours=1), "ebay_retention", now),
        (run_ebay_details, timedelta(minutes=2), "ebay_details", now + timedelta(seconds=30)),
        (save_ebay_usage, timedelta(minutes=1), "ebay_usage", now + timedelta(seconds=45)),
        (run_resale_estimates, timedelta(minutes=2), "resale", now + timedelta(seconds=60)),
        (run_sold_prices, timedelta(minutes=10), "sold_prices", now + timedelta(seconds=90)),
        (prune_thumbnails, timedelta(hours=1), "thumbs_prune", now + timedelta(minutes=5)),
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

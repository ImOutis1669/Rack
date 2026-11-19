"""Worker process: APScheduler running source refreshes, embeddings, rescoring, hunts and prices."""

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
from sqlalchemy.ext.asyncio import AsyncSession

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
from rack.models import AdjacentDesignerRow, TasteItemRow, UserRow, UserStateRow
from rack.pricing.fx import fetch_rates, set_live_rates
from rack.privacy import purge_ebay
from rack.ranking.planner import (
    PlannerInput,
    all_queries,
    fallback,
    merge_plans,
    next_batch,
    tailored_batch,
    tailored_streams,
)
from rack.sources.base import SearchQuery
from rack.sources.ebay import EbayAdapter
from rack.sources.grailed import GrailedAdapter
from rack.sources.http import RateLimitedClient
from rack.store import (
    active_users,
    get_state,
    get_user_state,
    load_designers,
    load_profile,
    set_state,
    set_user_state,
)
from rack.thumbs import prune
from rack.worker.adapters import shared_adapters
from rack.worker.ebay_details import fetch_ebay_details
from rack.worker.hunts import count_ebay_search, run_due_hunts
from rack.worker.live_search import run_live_searches
from rack.worker.llm_job import llm_rerank, make_client
from rack.worker.price_drops import check_saved_prices
from rack.worker.refresh import refresh_all
from rack.worker.resale import refresh_estimates
from rack.worker.sold import embed_sold, fetch_sold
from rack.worker.taste import assign_clusters, embed_listings, embed_taste, rescore
from rack.worker.vinted_import import run_vinted_imports

log = logging.getLogger("rack.worker")
_refresh_lock = asyncio.Lock()


def _now() -> datetime:
    return datetime.now(UTC)


async def planner_input(s: AsyncSession, uid: int) -> PlannerInput:
    """One user's taste, as the query planner reads it."""
    profile, _ = await load_profile(s, uid)
    designers = await load_designers(s, uid)
    adjacent: dict[str, list[str]] = {}
    for row in (
        await s.execute(select(AdjacentDesignerRow).where(AdjacentDesignerRow.user_id == uid))
    ).scalars():
        adjacent.setdefault(row.designer, []).append(row.adjacent)
    wish = (
        (
            await s.execute(
                select(TasteItemRow.text).where(
                    TasteItemRow.user_id == uid,
                    TasteItemRow.kind == "wishlist",
                    TasteItemRow.text.is_not(None),
                    TasteItemRow.image_path.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    return PlannerInput(profile, designers, adjacent, [str(w) for w in wish])


async def user_queries(s: AsyncSession, uid: int) -> list[SearchQuery]:
    """Every search one user's taste profile implies."""
    return all_queries(await planner_input(s, uid))


async def plan_queries(state_key: str = "planner", size: int | None = None) -> list[SearchQuery]:
    """Next `size` queries from every active user's taste, merged into one rotation and walked
    through with a stored cursor (same batch size and rate limits as one user)."""
    settings = get_settings()
    size = size or settings.rack_queries_per_refresh
    async with sessionmaker()() as s:
        users = await active_users(s)
        plans = [await user_queries(s, uid) for uid, _ in users]
        share = settings.rack_owner_rotation_share
        queries = merge_plans(plans, [share if role == "owner" else 1 for _, role in users])
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


async def _update_user_state(uid: int, key: str, **values: Any) -> None:
    async with sessionmaker()() as s:
        state = await get_user_state(s, uid, key)
        await set_user_state(s, uid, key, {**state, **values})
        await s.commit()


async def tailored_queries(uid: int, size: int) -> list[SearchQuery]:
    """The next `size` searches from one user's own taste, most-wanted first (the Refresh
    button). Their stream cursors live in their user state, so each refresh moves on."""
    async with sessionmaker()() as s:
        streams = tailored_streams(await planner_input(s, uid))
        state = await get_user_state(s, uid, "refresh")
        batch, cursors = tailored_batch(streams, state.get("cursors") or {}, size)
        await set_user_state(s, uid, "refresh", {**state, "cursors": cursors})
        await s.commit()
    return batch or fallback(get_settings().seed_queries)[:size]


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


async def run_hunts() -> None:
    try:
        await run_due_hunts(sessionmaker(), shared_adapters(), get_settings())
    except Exception:
        log.exception("hunts run failed")


async def run_imports() -> None:
    """Vinted likes people imported from their data export, one item per run."""
    try:
        await run_vinted_imports(sessionmaker(), shared_adapters())
    except Exception:
        log.exception("vinted import failed")


async def run_live() -> None:
    """Live searches people asked for in the app (search the marketplaces now)."""
    try:
        n = await run_live_searches(sessionmaker(), shared_adapters())
        if n:
            log.info("live searches: %d run", n)
    except Exception:
        log.exception("live searches failed")


async def run_price_checks() -> None:
    settings = get_settings()
    try:
        n = await check_saved_prices(sessionmaker(), shared_adapters(), settings)
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
        n = await fetch_sold(
            sessionmaker(), adapter, _now(), friend_items=get_settings().rack_friend_sold_items
        )
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
        self.prioritise: set[int] = set()  # users to score on the next run (just refreshed)
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
                due = set(self.prioritise)
                await rescore(sessions, self.embedder, unthrottled=due)
                self.prioritise -= due
                if self.llm is not None:
                    await llm_rerank(sessions, self.settings, self.llm)
            except Exception:
                log.exception("embed/score run failed")
            return n


async def run_user_refresh(uid: int, size: int) -> dict[str, int]:
    """One person's Refresh: their own next searches on every source, at the same rate limits
    and never alongside another refresh. Their eBay searches count towards their usage."""
    async with _refresh_lock:
        await _update_user_state(uid, "refresh", running=True, started_at=_now().isoformat())
        results: dict[str, int] = {}
        try:
            adapters = list(shared_adapters().values())
            queries = await tailored_queries(uid, size)
            log.info(
                "refresh for user %d: %d queries (%s)",
                uid,
                len(queries),
                ", ".join(q.text for q in queries),
            )
            if any(a.name == "ebay" for a in adapters):
                async with sessionmaker()() as s:
                    for _ in queries:
                        await count_ebay_search(s, uid)
                    await s.commit()
            results = await refresh_all(adapters, queries, sessionmaker())
            log.info("refresh for user %d done: %s", uid, results)
        finally:
            await _update_user_state(
                uid, "refresh", running=False, at=_now().isoformat(), results=results
            )
        return results


async def next_refresh_request() -> tuple[int, str] | None:
    """(user id, role) whose Refresh request has waited longest (enabled accounts only)."""
    async with sessionmaker()() as s:
        rows = (
            await s.execute(
                select(UserStateRow.user_id, UserStateRow.value, UserRow.role)
                .join(UserRow, UserRow.id == UserStateRow.user_id)
                .where(UserStateRow.key == "refresh", UserRow.disabled_at.is_(None))
            )
        ).all()
    waiting = [
        (str(v["requested_at"]), int(uid), str(role))
        for uid, v, role in rows
        if v.get("requested_at")
        and (not v.get("started_at") or str(v["requested_at"]) > str(v["started_at"]))
    ]
    if not waiting:
        return None
    _, uid, role = min(waiting)
    return uid, role


class ManualRefresh:
    """Runs a person's refresh when their Refresh button asked for one (see api/refresh.py)."""

    def __init__(self, embed: EmbedAndScore) -> None:
        self.embed = embed

    async def run(self) -> None:
        if _refresh_lock.locked():
            return
        asker = await next_refresh_request()
        if asker is None:
            return
        uid, role = asker
        settings = get_settings()
        size = (
            settings.rack_manual_queries if role == "owner" else settings.rack_friend_manual_queries
        )
        log.info("manual refresh requested by user %d", uid)
        await run_user_refresh(uid, size)
        self.embed.prioritise.add(uid)  # score their new results now, whatever their role
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
    jobs: list[tuple[Any, timedelta, str, datetime]] = [
        (run_refresh, refresh_every, "refresh", await resume_at("refresh", refresh_every)),
        (embed.run, timedelta(seconds=settings.rack_score_seconds), "embed_score", now),
        (ManualRefresh(embed).run, timedelta(seconds=10), "manual_refresh", now),
        (update_fx, timedelta(hours=24), "fx", await resume_at("fx", timedelta(hours=24))),
        (run_hunts, timedelta(minutes=1), "hunts", now),
        (run_live, timedelta(seconds=5), "live_search", now),
        (run_imports, timedelta(seconds=10), "vinted_import", now + timedelta(seconds=20)),
        (run_price_checks, timedelta(minutes=30), "price_drops", now),
        (purge_ebay_listings, timedelta(hours=1), "ebay_retention", now),
        (run_ebay_details, timedelta(minutes=2), "ebay_details", now + timedelta(seconds=30)),
        (save_ebay_usage, timedelta(minutes=1), "ebay_usage", now + timedelta(seconds=45)),
        (run_resale_estimates, timedelta(minutes=2), "resale", now + timedelta(seconds=60)),
        (run_sold_prices, timedelta(minutes=10), "sold_prices", now + timedelta(seconds=90)),
        (prune_thumbnails, timedelta(hours=1), "thumbs_prune", now + timedelta(minutes=5)),
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

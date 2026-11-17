"""Grailed sold prices for wardrobe estimates and trends (5c).

Once a day per branded wardrobe item: one sold-index query (brand + category, last 180 days),
stored as item data only. Their cover photos are embedded like listing photos so estimates can
compare them with the item's photo.
"""

import asyncio
import logging
import re
from datetime import datetime, timedelta

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.embeddings.clip import Embedder
from rack.embeddings.images import for_embedding
from rack.models import SoldListingRow, TasteItemRow, UserRow
from rack.pricing.resale import item_brand, item_category, item_label
from rack.sources.base import SourceError
from rack.sources.grailed import GrailedAdapter
from rack.store import load_designers
from rack.worker.taste import MAX_ATTEMPTS, Fetch

log = logging.getLogger(__name__)
CHECK_EVERY = timedelta(hours=24)
KEEP_SALES = timedelta(days=200)
# One query per 30-day slice of the last 180 days: popular brands sell hundreds of items a week,
# so a single query would only reach back a few days and no trend could be computed.
SLICE = timedelta(days=30)
SLICES = 6
SALES_PER_SLICE = 40
STOPWORDS = {"and", "the", "with", "for", "size", "new", "used", "mens", "men", "x"}


def label_words(item: TasteItemRow, brand: str) -> list[str]:
    """Words from the item's label that help find similar sales (not the brand itself)."""
    text = item_label(item).lower()
    brand_words = set(re.findall(r"[a-z0-9]+", brand.lower()))
    out: list[str] = []
    for w in re.findall(r"[a-z][a-z0-9]+", text):
        if w not in brand_words and w not in STOPWORDS and w not in out:
            out.append(w)
    return out[:6]


async def _friend_allowance(s: AsyncSession, cap: int | None) -> tuple[set[int], set[int]] | None:
    """(friend user ids, wardrobe item ids within their cap), or None when there is no cap."""
    if cap is None:
        return None
    ranked = (
        select(
            TasteItemRow.id,
            TasteItemRow.user_id,
            func.row_number()
            .over(partition_by=TasteItemRow.user_id, order_by=TasteItemRow.id)
            .label("n"),
        )
        .join(UserRow, UserRow.id == TasteItemRow.user_id)
        .where(UserRow.role == "friend", TasteItemRow.kind == "wardrobe")
        .subquery()
    )
    rows = (await s.execute(select(ranked.c.id, ranked.c.user_id, ranked.c.n))).all()
    return {u for _, u, _ in rows}, {i for i, _, n in rows if n <= cap}


async def fetch_sold(
    sessions: async_sessionmaker[AsyncSession],
    adapter: GrailedAdapter,
    now: datetime,
    friend_items: int | None = None,
) -> int:
    """Query recent sales for wardrobe items that are due. Returns how many sales were new.

    Friends' items count against Grailed's patience too: only each friend's first
    `friend_items` wardrobe items (oldest first) get sold-price checks."""
    new = 0
    async with sessions() as s:
        designers: dict[int, list[str]] = {}
        allowed = await _friend_allowance(s, friend_items)
        due = (
            (
                await s.execute(
                    select(TasteItemRow).where(
                        TasteItemRow.kind == "wardrobe",
                        TasteItemRow.embedding.is_not(None),
                        or_(
                            TasteItemRow.sold_checked_at.is_(None),
                            TasteItemRow.sold_checked_at < now - CHECK_EVERY,
                        ),
                    )
                )
            )
            .scalars()
            .all()
        )
        for item in due:
            if allowed is not None and item.user_id in allowed[0] and item.id not in allowed[1]:
                continue  # over this friend's cap
            if item.user_id not in designers:
                designers[item.user_id] = list(await load_designers(s, item.user_id))
            brand = item_brand(item, designers[item.user_id])
            if not brand:
                continue  # nothing to search for until it has a brand
            item.sold_checked_at = now
            words = label_words(item, brand)
            sales = []
            try:
                for i in range(SLICES):
                    until = now - SLICE * i
                    sales += await adapter.search_sold(
                        brand, item_category(item), until - SLICE, until, SALES_PER_SLICE, words
                    )
            except SourceError as exc:  # keep what the earlier slices found
                log.warning("Grailed sold search failed for item %s: %s", item.id, exc)
            for sale in sales:
                result = await s.execute(
                    insert(SoldListingRow)
                    .values(
                        source="grailed",
                        source_id=sale.source_id,
                        title=sale.title,
                        brand=sale.brand,
                        category=sale.category.value,
                        size=sale.size,
                        sold_price_gbp=sale.sold_price_gbp,
                        shipping_gbp=sale.shipping_gbp,
                        sold_at=sale.sold_at,
                        image_url=sale.image_url,
                        fetched_at=now,
                    )
                    .on_conflict_do_nothing(constraint="uq_sold_source")
                    .returning(SoldListingRow.id)
                )
                new += len(result.all())
            item.estimate_at = None  # re-estimate with the new sales
            await s.commit()
        await s.execute(delete(SoldListingRow).where(SoldListingRow.sold_at < now - KEEP_SALES))
        await s.commit()
    return new


async def embed_sold(
    sessions: async_sessionmaker[AsyncSession], embedder: Embedder, fetch: Fetch, limit: int = 100
) -> int:
    """Embed sold items' cover photos. When any were added, wardrobe estimates are re-run."""
    done = 0
    async with sessions() as s:
        rows = (
            (
                await s.execute(
                    select(SoldListingRow)
                    .where(
                        SoldListingRow.embedding.is_(None),
                        SoldListingRow.image_url.is_not(None),
                        SoldListingRow.embed_attempts < MAX_ATTEMPTS,
                    )
                    .order_by(SoldListingRow.sold_at.desc())
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )
        if not rows:
            return 0
        bodies = await asyncio.gather(
            *(fetch(str(r.image_url)) for r in rows), return_exceptions=True
        )
        ready = []
        for row, body in zip(rows, bodies, strict=True):
            row.embed_attempts += 1
            if isinstance(body, BaseException):
                log.info("sold photo fetch failed %s: %s", row.image_url, body)
                continue
            try:
                ready.append((row, for_embedding(body)))
            except Exception as exc:  # noqa: BLE001 - attempts cap stops retry loops
                log.info("sold photo unreadable %s: %s", row.image_url, exc)
        if ready:
            vectors = await asyncio.to_thread(embedder.embed_images, [img for _, img in ready])
            for (row, _), vec in zip(ready, vectors, strict=True):
                row.embedding = [float(x) for x in vec]
            done = len(ready)
            await s.execute(
                update(TasteItemRow)
                .where(TasteItemRow.kind == "wardrobe", TasteItemRow.embedding.is_not(None))
                .values(estimate_at=None)
            )
        await s.commit()
    return done

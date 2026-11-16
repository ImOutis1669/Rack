"""Estimated resale value of a wardrobe item from comparable listings Rack has collected (5b).

Comparables: same brand, same category (when the item's label says), and a similar photo (CLIP).
Sold first (5c): when there are at least MIN_SOLD similar Grailed sales in the last 90 days, the
estimate is their median *sold* price. Otherwise it falls back to the median *asking* price of
live listings, which leans high. The sold-price trend comes from the same comparable sales.
Thresholds are educated guesses for CLIP ViT-B-32; tune them.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from statistics import median
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from rack.models import (
    EstimateSnapshotRow,
    ListingImageRow,
    ListingRow,
    ListingScoreRow,
    SoldListingRow,
    TasteItemRow,
)
from rack.parsing.categories import infer_category
from rack.pricing.trend import compute_trend
from rack.ranking.brands import is_style_reference, match_designer
from rack.sources.base import Category

# CLIP cosine, your photo vs a listing's best photo. Home photos score lower than shop photos: on
# a real Gucci belt (2026-11-16) the true matches were 0.64-0.70 and the first wrong item
# (sunglasses) 0.647, so 0.65. Tune as more wardrobe items get estimates.
MIN_SIMILARITY = 0.65
MAX_COMPARABLES = 15
MIN_COMPARABLES = 3  # below this there's no estimate
NEAREST_IMAGES = 600  # photos fetched from the vector index before brand/category filtering
MIN_SOLD = 5  # similar sales in the last 90 days needed for a sold-price estimate
SOLD_WINDOW = timedelta(days=90)
TREND_HISTORY = timedelta(days=180)

Confidence = Literal["high", "medium", "low"]


@dataclass(frozen=True)
class Comparable:
    listing_id: int
    similarity: float
    price_gbp: Decimal


@dataclass(frozen=True)
class Estimate:
    value_gbp: Decimal | None  # None: not enough comparables
    count: int
    comparables: list[Comparable]


def confidence(count: int) -> Confidence | None:
    if count >= 10:
        return "high"
    if count >= 5:
        return "medium"
    if count >= MIN_COMPARABLES:
        return "low"
    return None


def estimate_from(candidates: Sequence[Comparable]) -> Estimate:
    """Closest matches above the similarity bar; their median price (pure, for tests)."""
    close = sorted(
        (c for c in candidates if c.similarity >= MIN_SIMILARITY),
        key=lambda c: c.similarity,
        reverse=True,
    )[:MAX_COMPARABLES]
    if len(close) < MIN_COMPARABLES:
        return Estimate(None, len(close), close)
    mid = Decimal(str(median(c.price_gbp for c in close)))
    return Estimate(mid.quantize(Decimal("0.01"), ROUND_HALF_UP), len(close), close)


def item_brand(item: TasteItemRow, designers: Sequence[str]) -> str | None:
    """The item's brand, else a designer from your list named in its label."""
    if item.brand and item.brand.strip():
        return item.brand.strip()
    label = " ".join(x for x in (item.text, item.note) if x)
    return match_designer(None, label, list(designers)) if label else None


def item_category(item: TasteItemRow) -> Category:
    return infer_category(" ".join(x for x in (item.text, item.note) if x))


def same_brand(brand: str, listing_brand: str | None, title: str) -> bool:
    return match_designer(listing_brand, title, [brand]) is not None and not (
        not listing_brand and is_style_reference(title, brand)
    )


async def candidates_for(session: AsyncSession, item: TasteItemRow, brand: str) -> list[Comparable]:
    """Same-brand, same-category listings near the item's photo, best photo per listing."""
    if item.embedding is None:
        return []
    distance = ListingImageRow.embedding.cosine_distance(item.embedding).label("d")
    nearest = (
        select(ListingImageRow.listing_id, distance)
        .where(ListingImageRow.embedding.is_not(None))
        .order_by(distance)
        .limit(NEAREST_IMAGES)
        .subquery()
    )
    rows = (
        await session.execute(
            select(
                ListingRow.id,
                ListingRow.brand,
                ListingRow.title,
                ListingRow.price_gbp,
                ListingScoreRow.category,
                func.min(nearest.c.d),
            )
            .join(nearest, nearest.c.listing_id == ListingRow.id)
            .outerjoin(ListingScoreRow, ListingScoreRow.listing_id == ListingRow.id)
            .where(ListingRow.price_gbp.is_not(None), ListingRow.excluded.is_(None))
            .group_by(ListingRow.id, ListingScoreRow.category)
        )
    ).all()
    category = item_category(item)
    out: list[Comparable] = []
    for lid, lbrand, title, price, cat, dist in rows:
        if lid == item.listing_id or not same_brand(brand, lbrand, title):
            continue
        if category != Category.ANY and cat and cat != category.value:
            continue
        out.append(Comparable(lid, round(1.0 - float(dist), 4), Decimal(price)))
    return out


async def sold_candidates_for(
    session: AsyncSession, item: TasteItemRow, brand: str, now: datetime
) -> list[tuple[Comparable, datetime]]:
    """Same-brand, same-category sales from the last 180 days whose photo is close to the item's."""
    if item.embedding is None:
        return []
    distance = SoldListingRow.embedding.cosine_distance(item.embedding).label("d")
    rows = (
        await session.execute(
            select(SoldListingRow, distance)
            .where(
                SoldListingRow.embedding.is_not(None),
                SoldListingRow.sold_at > now - TREND_HISTORY,
            )
            .order_by(distance)
            .limit(NEAREST_IMAGES)
        )
    ).all()
    category = item_category(item)
    out: list[tuple[Comparable, datetime]] = []
    for sold, dist in rows:
        sim = round(1.0 - float(dist), 4)
        if sim < MIN_SIMILARITY or not same_brand(brand, sold.brand, sold.title):
            continue
        if category != Category.ANY and sold.category not in ("any", category.value):
            continue
        out.append((Comparable(sold.id, sim, Decimal(sold.sold_price_gbp)), sold.sold_at))
    return out


async def _snapshot(session: AsyncSession, item: TasteItemRow, now: datetime) -> None:
    if item.estimate_gbp is None or item.estimate_count is None or not item.estimate_kind:
        return
    values = {
        "taste_item_id": item.id,
        "day": now.date(),
        "estimate_gbp": item.estimate_gbp,
        "count": item.estimate_count,
        "kind": item.estimate_kind,
    }
    ins = insert(EstimateSnapshotRow).values(**values)
    await session.execute(
        ins.on_conflict_do_update(
            constraint="uq_snapshot_day",
            set_={k: ins.excluded[k] for k in ("estimate_gbp", "count", "kind")},
        )
    )


async def estimate_item(
    session: AsyncSession, item: TasteItemRow, designers: Sequence[str], now: datetime
) -> Estimate | None:
    """Recompute and store the item's estimate. None when it can't have one (no photo/brand)."""
    item.estimate_at = now
    brand = item_brand(item, designers)
    if item.embedding is None or not brand:
        item.estimate_gbp, item.estimate_count, item.estimate_basis = None, None, None
        item.estimate_kind, item.trend = None, None
        return None
    sold = await sold_candidates_for(session, item, brand, now)
    recent = [c for c, at in sold if at > now - SOLD_WINDOW]
    sold_est = estimate_from(recent)
    if sold_est.value_gbp is not None and sold_est.count >= MIN_SOLD:
        est, kind = sold_est, "sold"
    else:
        est, kind = estimate_from(await candidates_for(session, item, brand)), "asking"
    item.estimate_gbp = est.value_gbp
    item.estimate_count = est.count
    item.estimate_kind = kind if est.value_gbp is not None else None
    basis: dict[str, Any] = {
        "brand": brand,
        "category": item_category(item).value,
        "kind": kind,
        "comparables": [[c.listing_id, c.similarity] for c in est.comparables],
    }
    item.estimate_basis = basis
    item.trend = compute_trend([(at, c.price_gbp) for c, at in sold], now) if sold else None
    await _snapshot(session, item, now)
    return est

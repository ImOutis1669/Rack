"""Feed and source-health endpoints.

sort=best (default): score order, re-ranked with MMR for variety plus an exploration share.
Other sorts use keyset pagination. Hard-filtered listings never appear in any sort.
"""

import base64
import json
import random
from collections.abc import Sequence
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Select, and_, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from rack.api.auth import require_session
from rack.config import get_settings
from rack.db import get_session
from rack.models import (
    FeedbackRow,
    ListingImageRow,
    ListingRow,
    ListingScoreRow,
    SavedRow,
    SeenRow,
    SourceHealthRow,
)
from rack.pricing.history import first_prices, price_cut
from rack.pricing.landed import estimate
from rack.ranking.mmr import interleave_exploration, mmr
from rack.ranking.vectors import as_matrix
from rack.schemas import BuyLink, FeedPage, LandedOut, ListingOut, SellerOut, SourceHealthOut
from rack.sources.base import Category
from rack.sources.registry import SOURCE_NAMES
from rack.store import load_profile

router = APIRouter(prefix="/api", tags=["feed"], dependencies=[Depends(require_session)])

Sort = Literal["best", "newest", "price_asc", "price_desc"]
MMR_HEAD = 300
MMR_LAMBDA = 0.7
BEST_POOL = 3000


def to_out(
    row: ListingRow,
    score: ListingScoreRow | None = None,
    feedback: int | None = None,
    saved: SavedRow | None = None,
    copies: Sequence[ListingRow] = (),
    first_price: Decimal | None = None,
) -> ListingOut:
    settings = get_settings()
    landed = estimate(
        source=row.source,
        price_gbp=row.price_gbp,
        shipping_gbp=row.shipping_cost_gbp,
        country=row.country,
        location=row.location,
        duty_rate=Decimal(str(settings.landed_duty_rate)),
        handling_fee_gbp=Decimal(str(settings.landed_handling_fee_gbp)),
    )
    seller = (
        SellerOut(name=row.seller_name, rating=row.seller_rating, count=row.seller_count)
        if row.seller_name or row.seller_rating is not None
        else None
    )
    return ListingOut(
        id=row.id,
        source=row.source,
        source_id=row.source_id,
        url=row.url,
        title=row.title,
        brand=row.brand,
        price=row.price,
        currency=row.currency,
        price_gbp=row.price_gbp,
        shipping_cost_gbp=row.shipping_cost_gbp,
        size=row.size,
        condition=row.condition,
        images=[i.url for i in row.images],
        seller=seller,
        listed_at=row.listed_at,
        first_seen_at=row.first_seen_at,
        country=row.country,
        score=score.score if score else None,
        why=score.why if score else None,
        category=score.category if score else None,
        measurements=dict(score.measurements) if score else {},
        feedback=feedback,
        saved=saved is not None,
        price_gbp_at_save=saved.price_gbp_at_save if saved else None,
        was_price_gbp=price_cut(first_price, row.price_gbp),
        landed=LandedOut(**{k: v for k, v in vars(landed).items() if k != "item_gbp"})
        if landed
        else None,
        buy_links=[
            BuyLink(source=r.source, url=r.url, price_gbp=r.price_gbp, size=r.size)
            for r in ([row, *copies] if copies else [row])
        ],
    )


async def hydrate(session: AsyncSession, rows: Sequence[ListingRow]) -> list[ListingOut]:
    """Attach score/why, your vote and saved state to listing rows (keeps order)."""
    ids = [r.id for r in rows]
    if not ids:
        return []
    scores = {
        s.listing_id: s
        for s in (
            await session.execute(
                select(ListingScoreRow).where(ListingScoreRow.listing_id.in_(ids))
            )
        ).scalars()
    }
    votes = dict(
        (
            await session.execute(
                select(FeedbackRow.listing_id, FeedbackRow.value).where(
                    FeedbackRow.listing_id.in_(ids)
                )
            )
        ).all()
    )
    saved = {
        s.listing_id: s
        for s in (
            await session.execute(select(SavedRow).where(SavedRow.listing_id.in_(ids)))
        ).scalars()
    }
    firsts = await first_prices(session, ids)
    # other listings of the same item (cross-listed / reposted), cheapest first
    cluster_ids = {r.cluster_id for r in rows if r.cluster_id is not None}
    copies: dict[int, list[ListingRow]] = {}
    if cluster_ids:
        others = (
            await session.execute(
                select(ListingRow)
                .where(ListingRow.cluster_id.in_(cluster_ids), ListingRow.active.is_(True))
                .order_by(ListingRow.price_gbp.asc().nulls_last(), ListingRow.id)
            )
        ).scalars()
        for o in others:
            copies.setdefault(o.cluster_id or 0, []).append(o)
    return [
        to_out(
            r,
            scores.get(r.id),
            votes.get(r.id),
            saved.get(r.id),
            [c for c in copies.get(r.cluster_id or -1, []) if c.id != r.id],
            firsts.get(r.id),
        )
        for r in rows
    ]


def encode_cursor(values: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(values).encode()).decode()


def decode_cursor(cursor: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(base64.urlsafe_b64decode(cursor.encode()))
    return data


def _apply_cursor(stmt: Select[Any], sort: Sort, cursor: str) -> Select[Any]:
    c = decode_cursor(cursor)
    cid = int(c["id"])
    if sort == "newest":
        key = ListingRow.first_seen_at
        val = datetime.fromisoformat(str(c["k"]))
        return stmt.where(or_(key < val, and_(key == val, ListingRow.id < cid)))
    pval = Decimal(str(c["k"]))
    if sort == "price_asc":
        return stmt.where(
            or_(
                ListingRow.price_gbp > pval, and_(ListingRow.price_gbp == pval, ListingRow.id > cid)
            )
        )
    return stmt.where(
        or_(ListingRow.price_gbp < pval, and_(ListingRow.price_gbp == pval, ListingRow.id < cid))
    )


def best_order(
    ids: list[int], scores: list[float], embs: dict[int, list[float]], exploration: float, seed: int
) -> list[int]:
    """MMR over the top of the score list, then interleave mid-band items for exploration."""
    head = ids[:MMR_HEAD]
    mat = as_matrix([embs.get(i) or [0.0] * 512 for i in head])
    order = [head[j] for j in mmr(scores[: len(head)], mat, MMR_LAMBDA)]
    n = len(ids)
    mid = ids[int(n * 0.3) : int(n * 0.7)] if n >= 20 else []
    mixed = interleave_exploration(order, mid, exploration, seed)
    out = list(dict.fromkeys(mixed + ids[MMR_HEAD:]))
    return out


@router.get("/feed", response_model=FeedPage)
async def feed(
    session: Annotated[AsyncSession, Depends(get_session)],
    sort: Sort = "best",
    source: Annotated[list[str] | None, Query()] = None,
    category: Category | None = None,
    brand: Annotated[str | None, Query(max_length=100)] = None,
    min_price: Decimal | None = None,
    max_price: Decimal | None = None,
    new_since: datetime | None = None,
    hide_seen_before: datetime | None = None,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> FeedPage:
    stmt = (
        select(ListingRow)
        .outerjoin(ListingScoreRow, ListingScoreRow.listing_id == ListingRow.id)
        .where(
            ListingRow.active.is_(True),
            ListingScoreRow.filtered_reason.is_(None),
            # one card per cluster: only its representative (cheapest copy)
            or_(ListingRow.cluster_id.is_(None), ListingRow.cluster_id == ListingRow.id),
        )
    )
    if source:
        stmt = stmt.where(ListingRow.source.in_(source))
    if category and category != Category.ANY:
        stmt = stmt.where(ListingScoreRow.category == category.value)
    if brand:
        stmt = stmt.where(ListingRow.brand.ilike(f"%{brand.strip()}%"))
    if min_price is not None:
        stmt = stmt.where(ListingRow.price_gbp >= min_price)
    if max_price is not None:
        stmt = stmt.where(ListingRow.price_gbp <= max_price)
    if new_since is not None:
        stmt = stmt.where(ListingRow.first_seen_at > new_since)
    if hide_seen_before is not None:
        stmt = stmt.where(
            ~exists().where(SeenRow.listing_id == ListingRow.id, SeenRow.seen_at < hide_seen_before)
        )

    if sort == "best":
        return await _best_page(session, stmt, cursor, limit)

    if sort != "newest":
        stmt = stmt.where(ListingRow.price_gbp.is_not(None))
    if cursor:
        stmt = _apply_cursor(stmt, sort, cursor)
    if sort == "newest":
        stmt = stmt.order_by(ListingRow.first_seen_at.desc(), ListingRow.id.desc())
    elif sort == "price_asc":
        stmt = stmt.order_by(ListingRow.price_gbp.asc(), ListingRow.id.asc())
    else:
        stmt = stmt.order_by(ListingRow.price_gbp.desc(), ListingRow.id.desc())

    rows = (await session.execute(stmt.limit(limit + 1))).scalars().all()
    page, more = rows[:limit], len(rows) > limit
    next_cursor = None
    if more and page:
        last = page[-1]
        k = last.first_seen_at.isoformat() if sort == "newest" else str(last.price_gbp)
        next_cursor = encode_cursor({"k": k, "id": last.id})
    return FeedPage(items=await hydrate(session, page), next_cursor=next_cursor)


async def _best_page(
    session: AsyncSession, stmt: Select[Any], cursor: str | None, limit: int
) -> FeedPage:
    c = decode_cursor(cursor) if cursor else {}
    offset = int(c.get("o", 0))
    seed = int(c.get("s", random.randrange(1 << 30)))

    ranked = (
        await session.execute(
            stmt.with_only_columns(ListingRow.id, ListingScoreRow.score)
            .where(ListingScoreRow.score.is_not(None))
            .order_by(ListingScoreRow.score.desc(), ListingRow.id.desc())
            .limit(BEST_POOL)
        )
    ).all()
    ids = [i for i, _ in ranked]
    scores = [float(s) for _, s in ranked]
    head = ids[:MMR_HEAD]
    embs = {
        lid: list(e)
        for lid, e in (
            await session.execute(
                select(ListingImageRow.listing_id, ListingImageRow.embedding).where(
                    ListingImageRow.listing_id.in_(head),
                    ListingImageRow.position == 0,
                    ListingImageRow.embedding.is_not(None),
                )
            )
        ).all()
        if e is not None
    }
    profile, _ = await load_profile(session)
    order = best_order(ids, scores, embs, profile.exploration, seed)
    # Not scored yet (the worker scores within a minute or so): newest, after the scored ones.
    unscored = (
        await session.execute(
            stmt.with_only_columns(ListingRow.id)
            .where(ListingScoreRow.listing_id.is_(None))
            .order_by(ListingRow.first_seen_at.desc(), ListingRow.id.desc())
            .limit(BEST_POOL)
        )
    ).scalars()
    order += list(unscored)
    page_ids = order[offset : offset + limit]
    rows = {
        r.id: r
        for r in (
            await session.execute(select(ListingRow).where(ListingRow.id.in_(page_ids)))
        ).scalars()
    }
    page = [rows[i] for i in page_ids if i in rows]
    more = offset + limit < len(order)
    next_cursor = encode_cursor({"o": offset + limit, "s": seed}) if more else None
    return FeedPage(items=await hydrate(session, page), next_cursor=next_cursor)


def health_status(row: SourceHealthRow | None) -> str:
    if row is None:
        return "never_run"
    if not row.configured:
        return "not_configured"
    if row.blocked:
        return "blocked"
    if row.consecutive_errors >= 3:
        return "down"
    if row.consecutive_errors > 0:
        return "degraded"
    return "ok" if row.last_success_at else "never_run"


@router.get("/sources/health", response_model=list[SourceHealthOut])
async def sources_health(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[SourceHealthOut]:
    rows = {r.source: r for r in (await session.execute(select(SourceHealthRow))).scalars()}
    out: list[SourceHealthOut] = []
    for name in SOURCE_NAMES:
        row = rows.get(name)
        out.append(
            SourceHealthOut(
                source=name,
                configured=row.configured if row else False,
                last_success_at=row.last_success_at if row else None,
                last_error_at=row.last_error_at if row else None,
                last_error=row.last_error if row else None,
                error_count=row.error_count if row else 0,
                consecutive_errors=row.consecutive_errors if row else 0,
                last_result_count=row.last_result_count if row else None,
                blocked=row.blocked if row else False,
                last_check_at=row.last_check_at if row else None,
                status=health_status(row),
            )
        )
    return out

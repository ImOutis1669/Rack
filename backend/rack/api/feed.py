"""Feed and source-health endpoints. Phase 1: newest/price ordering; ranking arrives in Phase 2."""

import base64
import json
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Select, and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from rack.api.auth import require_session
from rack.db import get_session
from rack.models import ListingRow, SourceHealthRow
from rack.schemas import BuyLink, FeedPage, ListingOut, SellerOut, SourceHealthOut
from rack.sources.registry import SOURCE_NAMES

router = APIRouter(prefix="/api", tags=["feed"], dependencies=[Depends(require_session)])

Sort = Literal["newest", "price_asc", "price_desc"]


def to_out(row: ListingRow) -> ListingOut:
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
        buy_links=[BuyLink(source=row.source, url=row.url, price_gbp=row.price_gbp)],
    )


def encode_cursor(values: dict[str, str | int]) -> str:
    return base64.urlsafe_b64encode(json.dumps(values).encode()).decode()


def decode_cursor(cursor: str) -> dict[str, str | int]:
    data: dict[str, str | int] = json.loads(base64.urlsafe_b64decode(cursor.encode()))
    return data


def _apply_cursor(stmt: Select[ListingRow], sort: Sort, cursor: str) -> Select[ListingRow]:
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


@router.get("/feed", response_model=FeedPage)
async def feed(
    session: Annotated[AsyncSession, Depends(get_session)],
    sort: Sort = "newest",
    source: Annotated[list[str] | None, Query()] = None,
    min_price: Decimal | None = None,
    max_price: Decimal | None = None,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> FeedPage:
    stmt = select(ListingRow).where(ListingRow.active.is_(True))
    if source:
        stmt = stmt.where(ListingRow.source.in_(source))
    if min_price is not None:
        stmt = stmt.where(ListingRow.price_gbp >= min_price)
    if max_price is not None:
        stmt = stmt.where(ListingRow.price_gbp <= max_price)
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
    return FeedPage(items=[to_out(r) for r in page], next_cursor=next_cursor)


def health_status(row: SourceHealthRow | None) -> str:
    if row is None:
        return "never_run"
    if not row.configured:
        return "not_configured"
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
                status=health_status(row),
            )
        )
    return out

"""Search across all sources (v2.1 step 4b).

- `GET /api/search`: instant, over every listing Rack already has (shared), ranked by text
  match. Your hidden sellers/brands, excluded designers and bought items still apply; budget,
  size and banned-word rules don't (you're asking for it by name).
- `POST /api/search/live`: ask eBay, Vinted and Grailed now. The worker runs it once per
  source through the crawler's shared rate-limited clients; `GET /api/search/live/{id}` shows
  progress and what it found.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from rack.api.auth import User, require_user
from rack.api.feed import bought_listing, decode_cursor, encode_cursor, hydrate
from rack.config import Settings, get_settings
from rack.db import get_session
from rack.models import HiddenRow, ListingRow, ListingScoreRow, SearchRequestRow
from rack.ranking.brands import normalize as normalize_name
from rack.schemas import ListingOut
from rack.search import WORD_SIMILARITY, clean_query, matches, relevance
from rack.sources.base import Category
from rack.sources.registry import SOURCE_NAMES

router = APIRouter(prefix="/api/search", tags=["search"], dependencies=[Depends(require_user)])
Session = Annotated[AsyncSession, Depends(get_session)]
Config = Annotated[Settings, Depends(get_settings)]
Sort = Literal["best", "newest", "price_asc", "price_desc"]
HIDDEN_REASONS = ("hidden_seller", "hidden_brand", "excluded_designer")
STALE_RUNNING = timedelta(minutes=10)


class SearchPage(BaseModel):
    items: list[ListingOut]
    next_cursor: str | None


def _query(raw: str) -> str:
    q = clean_query(raw)
    if not q:
        raise HTTPException(422, "Type at least 2 letters or numbers")
    return q


@router.get("")
async def search(
    session: Session,
    user: User,
    q: Annotated[str, Query(max_length=200)],
    sort: Sort = "best",
    source: Annotated[list[str] | None, Query()] = None,
    category: Category | None = None,
    size: Annotated[str | None, Query(max_length=30)] = None,
    condition: Annotated[str | None, Query(max_length=30)] = None,
    min_price: Annotated[Decimal | None, Query(ge=0)] = None,
    max_price: Annotated[Decimal | None, Query(ge=0)] = None,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=60)] = 30,
) -> SearchPage:
    query = _query(q)
    # SET LOCAL takes no parameters; the value is a constant from this module
    await session.execute(
        text(f"SET LOCAL pg_trgm.word_similarity_threshold = {WORD_SIMILARITY:.2f}")
    )
    mine = and_(ListingScoreRow.listing_id == ListingRow.id, ListingScoreRow.user_id == user.id)
    stmt = (
        select(ListingRow)
        .outerjoin(ListingScoreRow, mine)
        .where(
            matches(query),
            ListingRow.active.is_(True),
            ListingRow.excluded.is_(None),
            or_(ListingRow.cluster_id.is_(None), ListingRow.cluster_id == ListingRow.id),
            ~bought_listing(user.id),
            or_(
                ListingScoreRow.filtered_reason.is_(None),
                ListingScoreRow.filtered_reason.not_in(HIDDEN_REASONS),
            ),
        )
    )
    if source:
        stmt = stmt.where(ListingRow.source.in_([s for s in source if s in SOURCE_NAMES]))
    if category and category != Category.ANY:
        stmt = stmt.where(ListingScoreRow.category == category.value)
    if size and size.strip():
        stmt = stmt.where(ListingRow.size.ilike(f"%{_like(size)}%", escape="\\"))
    if condition and condition.strip():
        stmt = stmt.where(ListingRow.condition.ilike(f"%{_like(condition)}%", escape="\\"))
    if min_price is not None:
        stmt = stmt.where(ListingRow.price_gbp >= min_price)
    if max_price is not None:
        stmt = stmt.where(ListingRow.price_gbp <= max_price)

    if sort == "best":
        stmt = stmt.order_by(
            relevance(query).desc(),
            ListingScoreRow.score.desc().nulls_last(),
            ListingRow.id.desc(),
        )
    elif sort == "newest":
        stmt = stmt.order_by(ListingRow.first_seen_at.desc(), ListingRow.id.desc())
    elif sort == "price_asc":
        stmt = stmt.order_by(ListingRow.price_gbp.asc().nulls_last(), ListingRow.id.asc())
    else:
        stmt = stmt.order_by(ListingRow.price_gbp.desc().nulls_last(), ListingRow.id.desc())

    offset = _offset(cursor)
    rows = (await session.execute(stmt.offset(offset).limit(limit + 1))).scalars().all()
    page, more = list(rows[:limit]), len(rows) > limit
    page = await _not_hidden(session, user.id, page)
    next_cursor = encode_cursor({"o": offset + limit}) if more else None
    return SearchPage(items=await hydrate(session, page, user.id), next_cursor=next_cursor)


def _like(s: str) -> str:
    return s.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _offset(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        return max(0, min(int(decode_cursor(cursor).get("o", 0)), 10_000))
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(422, "Bad cursor") from exc


async def _not_hidden(
    session: AsyncSession, user_id: int, rows: list[ListingRow]
) -> list[ListingRow]:
    """Listings you haven't got a score for yet (e.g. a live search's results) skip the SQL
    check, so apply your hidden sellers and brands here too."""
    hidden = (
        await session.execute(
            select(HiddenRow.kind, HiddenRow.value).where(HiddenRow.user_id == user_id)
        )
    ).all()
    if not hidden:
        return rows
    sellers = {normalize_name(v) for k, v in hidden if k == "seller"}
    brands = {normalize_name(v) for k, v in hidden if k == "brand"}
    return [
        r
        for r in rows
        if normalize_name(r.seller_name or "") not in sellers
        and normalize_name(r.brand or "") not in brands
    ]


# --- live: ask the marketplaces now ---


class LiveIn(BaseModel):
    q: str = Field(max_length=200)
    category: Category = Category.ANY
    max_price_gbp: Decimal | None = Field(default=None, ge=0, le=100_000)


class LiveOut(BaseModel):
    id: int
    query: str
    status: str  # queued | running | done | error
    results: dict[str, Any]  # source -> number found, or an error message
    created_at: datetime
    finished_at: datetime | None
    items: list[ListingOut] = []


async def _live_out(session: AsyncSession, row: SearchRequestRow, user_id: int) -> LiveOut:
    ids = [int(i) for i in (row.listing_ids or [])][:300]
    items: list[ListingOut] = []
    if ids:
        found = {
            r.id: r
            for r in (
                await session.execute(
                    select(ListingRow).where(
                        ListingRow.id.in_(ids),
                        ListingRow.active.is_(True),
                        ListingRow.excluded.is_(None),
                        ~bought_listing(user_id),
                    )
                )
            ).scalars()
        }
        rows = await _not_hidden(session, user_id, [found[i] for i in ids if i in found])
        items = await hydrate(session, rows, user_id)
    return LiveOut(
        id=row.id,
        query=row.query,
        status=row.status,
        results=dict(row.results or {}),
        created_at=row.created_at,
        finished_at=row.finished_at,
        items=items,
    )


@router.post("/live", status_code=status.HTTP_202_ACCEPTED)
async def live_search(
    body: LiveIn, user: User, session: Session, settings: Config, response: Response
) -> LiveOut:
    """Queue a live search. One at a time per person; friends wait longer between them (the
    marketplaces' patience is shared), and the queue is short."""
    query = _query(body.q)
    now = datetime.now(UTC)
    pending = await session.scalar(
        select(SearchRequestRow.id).where(
            SearchRequestRow.user_id == user.id,
            SearchRequestRow.status.in_(("queued", "running")),
            SearchRequestRow.created_at > now - STALE_RUNNING,
        )
    )
    if pending is not None:
        raise HTTPException(409, "Your last live search is still running")
    wait = timedelta(
        seconds=settings.rack_live_search_owner_seconds
        if user.is_owner
        else settings.rack_live_search_friend_seconds
    )
    last = await session.scalar(
        select(func.max(SearchRequestRow.created_at)).where(SearchRequestRow.user_id == user.id)
    )
    if last is not None and last + wait > now:
        retry = int((last + wait - now).total_seconds()) + 1
        response.headers["Retry-After"] = str(retry)
        raise HTTPException(429, f"Try again in {retry} s", headers={"Retry-After": str(retry)})
    queued = await session.scalar(
        select(func.count(SearchRequestRow.id)).where(SearchRequestRow.status == "queued")
    )
    if (queued or 0) >= settings.rack_live_search_queue:
        raise HTTPException(429, "Rack is busy searching; try again in a minute")
    row = SearchRequestRow(
        user_id=user.id,
        query=query,
        category=body.category.value,
        max_price_gbp=body.max_price_gbp,
        created_at=now,
    )
    session.add(row)
    await session.commit()
    return await _live_out(session, row, user.id)


@router.get("/live/{request_id}")
async def live_status(request_id: int, user: User, session: Session) -> LiveOut:
    row = await session.get(SearchRequestRow, request_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(404)
    return await _live_out(session, row, user.id)

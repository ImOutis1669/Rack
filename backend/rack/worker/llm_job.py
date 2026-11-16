"""Worker job for the optional LLM re-rank (see rack/ranking/llm.py)."""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.config import Settings
from rack.models import ListingRow, ListingScoreRow, TasteItemRow
from rack.ranking.llm import Candidate, MessagesClient, adjusted_score, judge, taste_summary
from rack.store import get_state, load_designers, load_profile, set_state

log = logging.getLogger(__name__)


async def _profile_text(s: AsyncSession) -> str:
    profile, _ = await load_profile(s)
    designers = await load_designers(s)
    taste = (await s.execute(select(TasteItemRow))).scalars().all()
    wishlist = [t.text or t.note or "" for t in taste if t.kind == "wishlist"]
    wardrobe = [t.text or t.note or "" for t in taste if t.kind == "wardrobe"]
    m = profile.measurements
    return taste_summary(
        profile.context,
        designers,
        [w for w in wishlist if w],
        [w for w in wardrobe if w],
        {
            "inseam_min_cm": m.inseam_min_cm,
            "sleeve_min_cm": m.sleeve_min_cm,
            "length_min_cm": m.length_min_cm,
        },
        {str(k): v for k, v in profile.sizes.items()},
    )


async def llm_rerank(
    sessions: async_sessionmaker[AsyncSession], settings: Settings, client: MessagesClient
) -> int:
    """Judge the not-yet-judged part of the feed's top N. Returns verdicts stored."""
    now = datetime.now(UTC)
    today = now.date().isoformat()
    async with sessions() as s:
        usage = await get_state(s, "llm_usage")
        calls = int(usage.get("calls", 0)) if usage.get("date") == today else 0
        if calls >= settings.llm_daily_call_cap:
            return 0
        stale = now - timedelta(days=settings.llm_verdict_days)
        top = (
            await s.execute(
                select(ListingRow, ListingScoreRow)
                .join(ListingScoreRow, ListingScoreRow.listing_id == ListingRow.id)
                .where(
                    ListingRow.active.is_(True),
                    ListingScoreRow.filtered_reason.is_(None),
                    or_(ListingRow.cluster_id.is_(None), ListingRow.cluster_id == ListingRow.id),
                )
                .order_by(ListingScoreRow.score.desc())
                .limit(settings.llm_top_n)
            )
        ).all()
        todo = [(r, sc) for r, sc in top if sc.llm_at is None or sc.llm_at < stale]
        if not todo:
            return 0
        candidates = [
            Candidate(
                id=r.id,
                title=r.title,
                brand=r.brand,
                price_gbp=float(r.price_gbp) if r.price_gbp is not None else None,
                size=r.size,
                condition=r.condition,
                measurements={k: float(v) for k, v in (sc.measurements or {}).items()},
                image_url=r.images[0].url if r.images else None,
            )
            for r, sc in todo
        ]
        profile_text = await _profile_text(s)
        await set_state(s, "llm_usage", {"date": today, "calls": calls + 1})
        await s.commit()  # count the call even if it fails, so a broken setup can't loop

        verdicts = await judge(client, settings.llm_model, profile_text, candidates)
        by_id = {sc.listing_id: sc for _, sc in todo}
        for v in verdicts:
            sc = by_id.get(v.id)
            if sc is None:
                continue
            base = float((sc.components or {}).get("base", sc.score))
            sc.llm_score, sc.llm_why, sc.llm_at = v.score, v.why, now
            sc.score = round(adjusted_score(base, v.score, settings.llm_weight), 5)
            template = (sc.why or "").split(" · ", 1)[-1] if sc.why and " · " in sc.why else sc.why
            sc.why = f"{v.why} · {template}" if template else v.why
        await s.commit()
        log.info(
            "LLM re-rank: %d verdicts (%d/%d calls today)",
            len(verdicts),
            calls + 1,
            settings.llm_daily_call_cap,
        )
        return len(verdicts)


def make_client(settings: Settings) -> Any:
    import anthropic

    # The SDK also reads ANTHROPIC_API_KEY (or an `ant auth login` profile) from the environment.
    return anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key or None)

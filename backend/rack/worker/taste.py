"""Worker jobs for Phase 2: compute embeddings, then rescore every active listing."""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
from PIL import Image
from sqlalchemy import and_, exists, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.config import get_settings
from rack.embeddings.clip import Embedder
from rack.embeddings.images import for_embedding
from rack.embeddings.phash import phash
from rack.models import (
    FeedbackRow,
    HiddenRow,
    ListingImageRow,
    ListingRow,
    ListingScoreRow,
    SavedRow,
    TasteItemRow,
)
from rack.pricing.history import first_prices
from rack.ranking.brands import normalize as normalize_name
from rack.ranking.dedupe import clusters
from rack.ranking.explain import explain
from rack.ranking.filters import Hidden
from rack.ranking.llm import adjusted_score
from rack.ranking.scoring import ListingFeatures, TasteContext, score_all
from rack.ranking.vectors import as_matrix, normalize, rocchio
from rack.store import get_state, load_designers, load_profile, set_state

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
Fetch = Callable[[str], Awaitable[bytes]]


async def _mark_dirty(session: AsyncSession) -> None:
    state = await get_state(session, "scoring")
    state["dirty"] = True
    await set_state(session, "scoring", state)


async def embed_taste(
    sessions: async_sessionmaker[AsyncSession], embedder: Embedder, uploads_dir: Path
) -> int:
    changed = 0
    async with sessions() as s:
        items = (
            (
                await s.execute(
                    select(TasteItemRow).where(
                        TasteItemRow.embedding.is_(None),
                        TasteItemRow.image_path.is_not(None),
                        TasteItemRow.embed_attempts < MAX_ATTEMPTS,
                    )
                )
            )
            .scalars()
            .all()
        )
        for it in items:
            it.embed_attempts += 1
            try:
                data = (uploads_dir / str(it.image_path)).read_bytes()
                img = for_embedding(data)
                emb = await asyncio.to_thread(embedder.embed_images, [img])
                it.embedding = emb[0].tolist()
                it.embed_error = None
                changed += 1
            except Exception as exc:  # noqa: BLE001 - recorded on the row, shown in the UI
                it.embed_error = f"{type(exc).__name__}: {exc}"[:500]
                log.warning("taste item %s embed failed: %s", it.id, exc)

        texts = (
            (
                await s.execute(
                    select(TasteItemRow).where(
                        TasteItemRow.text.is_not(None), TasteItemRow.text_embedding.is_(None)
                    )
                )
            )
            .scalars()
            .all()
        )
        texts = [t for t in texts if (t.text or "").strip()]
        if texts:
            embs = await asyncio.to_thread(embedder.embed_texts, [str(t.text) for t in texts])
            for t, e in zip(texts, embs, strict=True):
                t.text_embedding = e.tolist()
            changed += len(texts)
        if changed:
            await _mark_dirty(s)
        await s.commit()
    return changed


async def embed_listings(
    sessions: async_sessionmaker[AsyncSession],
    embedder: Embedder,
    fetch: Fetch,
    *,
    images_per_listing: int = 1,
    max_images: int = 200,
    batch: int = 16,
) -> int:
    """Embed pending listing images (reusing cached embeddings by URL hash) and titles."""
    changed = 0
    async with sessions() as s:
        pending = (
            (
                await s.execute(
                    select(ListingImageRow)
                    .join(ListingRow, ListingRow.id == ListingImageRow.listing_id)
                    .where(
                        ListingRow.active.is_(True),
                        ListingImageRow.position < images_per_listing,
                        or_(
                            ListingImageRow.embedding.is_(None),
                            # first photos also need a pHash for cross-listing dedupe
                            and_(ListingImageRow.position == 0, ListingImageRow.phash.is_(None)),
                        ),
                        ListingImageRow.embed_attempts < MAX_ATTEMPTS,
                    )
                    .order_by(ListingRow.last_seen_at.desc())
                    .limit(max_images)
                )
            )
            .scalars()
            .all()
        )

        todo: list[tuple[ListingImageRow, Image.Image]] = []
        to_fetch: list[ListingImageRow] = []
        for row in pending:
            row.embed_attempts += 1
            cached = (
                await s.execute(
                    select(ListingImageRow.embedding, ListingImageRow.phash)
                    .where(
                        ListingImageRow.url_hash == row.url_hash,
                        ListingImageRow.embedding.is_not(None),
                        ListingImageRow.phash.is_not(None),
                    )
                    .limit(1)
                )
            ).first()
            if cached is not None and cached[0] is not None:
                row.embedding = [float(x) for x in cached[0]]
                row.phash = cached[1]
                changed += 1
                continue
            to_fetch.append(row)

        # `fetch` keeps one request in flight per image host, so different CDNs run side by side.
        bodies = await asyncio.gather(*(fetch(r.url) for r in to_fetch), return_exceptions=True)
        for row, body in zip(to_fetch, bodies, strict=True):
            try:
                if isinstance(body, BaseException):
                    raise body
                img = for_embedding(body)
                if row.position == 0:
                    row.phash = phash(img)
                if row.embedding is None:
                    todo.append((row, img))
                else:
                    changed += 1
            except Exception as exc:  # noqa: BLE001 - attempts cap stops retry loops
                log.info("image fetch failed %s: %s", row.url, exc)
            if len(todo) >= batch:
                changed += await _flush(embedder, todo)
        changed += await _flush(embedder, todo)

        listings = (
            (
                await s.execute(
                    select(ListingRow)
                    .where(ListingRow.active.is_(True), ListingRow.text_embedding.is_(None))
                    .limit(512)
                )
            )
            .scalars()
            .all()
        )
        for i in range(0, len(listings), 64):
            chunk = listings[i : i + 64]
            texts = [f"{r.brand or ''} {r.title}".strip() for r in chunk]
            embs = await asyncio.to_thread(embedder.embed_texts, texts)
            for r, e in zip(chunk, embs, strict=True):
                r.text_embedding = e.tolist()
            changed += len(chunk)
        if changed:
            await _mark_dirty(s)
        await s.commit()
    return changed


async def _flush(embedder: Embedder, todo: list[tuple[ListingImageRow, Image.Image]]) -> int:
    if not todo:
        return 0
    embs = await asyncio.to_thread(embedder.embed_images, [img for _, img in todo])
    for (row, _), e in zip(todo, embs, strict=True):
        row.embedding = e.tolist()
    n = len(todo)
    todo.clear()
    return n


async def assign_clusters(sessions: async_sessionmaker[AsyncSession]) -> int:
    """Group listings whose first photos show the same item. Returns count of clustered listings."""
    async with sessions() as s:
        rows = (
            await s.execute(
                select(
                    ListingRow.id,
                    ListingRow.price_gbp,
                    ListingRow.brand,
                    ListingRow.title,
                    ListingRow.cluster_id,
                    ListingImageRow.phash,
                    ListingImageRow.embedding,
                )
                .join(ListingImageRow, ListingImageRow.listing_id == ListingRow.id)
                .where(
                    ListingRow.active.is_(True),
                    ListingImageRow.position == 0,
                    ListingImageRow.phash.is_not(None),
                    ListingImageRow.embedding.is_not(None),
                )
            )
        ).all()
        current = {r.id: r.cluster_id for r in rows}
        mapping = clusters(
            [r.id for r in rows],
            [str(r.phash) for r in rows],
            as_matrix([list(r.embedding) for r in rows]),
            [float(r.price_gbp) if r.price_gbp is not None else None for r in rows],
            [r.brand for r in rows],
            [r.title for r in rows],
        )
        changed = [lid for lid in current if current[lid] != mapping.get(lid)]
        for lid in changed:
            await s.execute(
                update(ListingRow).where(ListingRow.id == lid).values(cluster_id=mapping.get(lid))
            )
        # listings that lost their photo/hash data drop out of any cluster
        await s.execute(
            update(ListingRow)
            .where(ListingRow.cluster_id.is_not(None), ListingRow.id.not_in(list(current) or [0]))
            .values(cluster_id=None)
        )
        await s.commit()
        if changed:
            log.info(
                "dedupe: %d listings changed cluster (%d clustered)", len(changed), len(mapping)
            )
        return len(mapping)


async def rescore(
    sessions: async_sessionmaker[AsyncSession],
    embedder: Embedder | None,
    *,
    force: bool = False,
) -> int | None:
    """Score all active listings if anything changed. Returns count, or None if skipped."""
    async with sessions() as s:
        profile, version = await load_profile(s)
        state = await get_state(s, "scoring")
        unscored = (
            await s.execute(
                select(
                    exists().where(
                        ListingRow.active.is_(True),
                        ~exists().where(ListingScoreRow.listing_id == ListingRow.id),
                    )
                )
            )
        ).scalar()
        if not (force or unscored or state.get("dirty") or state.get("version") != version):
            return None

        designers = await load_designers(s)
        taste = (await s.execute(select(TasteItemRow))).scalars().all()
        img_items = [t for t in taste if t.embedding is not None]
        txt_items = [t for t in taste if t.text_embedding is not None]
        taste_images = as_matrix([list(t.embedding) for t in img_items])  # type: ignore[arg-type]
        labels = [t.text or t.note or f"{t.kind} piece" for t in img_items]

        text_vecs = [list(t.text_embedding) for t in txt_items]  # type: ignore[arg-type]
        text_labels = [str(t.text) for t in txt_items]
        if profile.context.strip() and embedder is not None:
            ctx_emb = await asyncio.to_thread(embedder.embed_texts, [profile.context.strip()])
            text_vecs.append(ctx_emb[0].tolist())
            text_labels.append(_short(profile.context))
        text_queries = as_matrix(text_vecs)

        votes = (
            await s.execute(
                select(FeedbackRow.listing_id, FeedbackRow.value, ListingImageRow.embedding)
                .join(ListingImageRow, ListingImageRow.listing_id == FeedbackRow.listing_id)
                .where(ListingImageRow.position == 0, ListingImageRow.embedding.is_not(None))
            )
        ).all()
        # Saving counts as a like, unless that listing has an explicit 👍/👎 (which wins).
        voted = {lid for lid, _, _ in votes}
        saves = (
            await s.execute(
                select(SavedRow.listing_id, ListingImageRow.embedding)
                .join(ListingImageRow, ListingImageRow.listing_id == SavedRow.listing_id)
                .where(ListingImageRow.position == 0, ListingImageRow.embedding.is_not(None))
            )
        ).all()
        liked = as_matrix(
            [list(e) for _, v, e in votes if v > 0 and e is not None]
            + [list(e) for lid, e in saves if lid not in voted and e is not None]
        )
        disliked = as_matrix([list(e) for _, v, e in votes if v < 0 and e is not None])
        centroid = normalize(taste_images.mean(axis=0)) if len(taste_images) else None
        pref = rocchio(centroid, liked, disliked)

        hidden = Hidden()
        for h in (await s.execute(select(HiddenRow))).scalars():
            (hidden.sellers if h.kind == "seller" else hidden.brands).add(normalize_name(h.value))

        ctx = TasteContext(
            profile=profile,
            designers=designers,
            taste_images=taste_images,
            taste_labels=labels,
            text_queries=text_queries,
            text_labels=text_labels,
            pref=pref,
            hidden=hidden,
        )

        rows = (
            (await s.execute(select(ListingRow).where(ListingRow.active.is_(True)))).scalars().all()
        )
        firsts = {k: float(v) for k, v in (await first_prices(s)).items()}
        feats = [
            ListingFeatures(
                id=r.id,
                title=r.title,
                description=r.description,
                brand=r.brand,
                seller=r.seller_name,
                price_gbp=float(r.price_gbp) if r.price_gbp is not None else None,
                size=r.size,
                image_embs=as_matrix(
                    [list(i.embedding) for i in r.images if i.embedding is not None]
                ),
                first_price_gbp=firsts.get(r.id),
                text_emb=(
                    normalize(np.asarray(r.text_embedding, dtype=np.float32))
                    if r.text_embedding is not None
                    else None
                ),
            )
            for r in rows
        ]
        results = await asyncio.to_thread(score_all, feats, ctx)

        now = datetime.now(UTC)
        settings = get_settings()
        fresh_after = now - timedelta(days=settings.llm_verdict_days)
        verdicts = {
            lid: (llm, why)
            for lid, llm, why, at in (
                await s.execute(
                    select(
                        ListingScoreRow.listing_id,
                        ListingScoreRow.llm_score,
                        ListingScoreRow.llm_why,
                        ListingScoreRow.llm_at,
                    ).where(ListingScoreRow.llm_score.is_not(None))
                )
            ).all()
            if at and at > fresh_after
        }
        values = [
            {
                "listing_id": res.listing_id,
                "score": round(
                    adjusted_score(
                        res.score,
                        verdicts.get(res.listing_id, (None, None))[0],
                        settings.llm_weight,
                    ),
                    5,
                ),
                "components": {**res.components, "base": res.score},
                "why": _why(
                    explain(res.components, res.details, profile.weights),
                    verdicts.get(res.listing_id, (None, None))[1],
                ),
                "category": res.category.value,
                "measurements": res.measurements,
                "filtered_reason": res.filtered_reason,
                "profile_version": version,
                "computed_at": now,
            }
            for res in results
        ]
        for i in range(0, len(values), 500):
            ins = insert(ListingScoreRow).values(values[i : i + 500])
            await s.execute(
                ins.on_conflict_do_update(
                    index_elements=[ListingScoreRow.listing_id],
                    set_={c: ins.excluded[c] for c in values[0] if c != "listing_id"},
                )
            )
        await set_state(s, "scoring", {"version": version, "dirty": False, "at": now.isoformat()})
        await s.commit()
        log.info("rescored %d listings (profile v%d)", len(values), version)
        return len(values)


def _why(template: str, llm_why: str | None) -> str:
    return f"{llm_why} · {template}" if llm_why else template


def _short(s: str, n: int = 40) -> str:
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1] + "…"

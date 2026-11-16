"""Score listings against the taste profile. Pure numpy; the worker feeds it rows.

score = Σ wᵢ·cᵢ / Σ wᵢ   over visual, text, feedback, deal, fit (components that exist)
      + w_brand · brand        (a bonus only: an unknown brand adds 0, never subtracts)
      − w_knockoff · knockoff

Every component is in [0, 1]. Missing deal/fit data is neutral (0.5). Visual/text are left out
entirely when you have no wardrobe/wishlist images / text yet; feedback when you have no votes.
"""

from dataclasses import dataclass, field
from statistics import median
from typing import Any

import numpy as np

from rack.parsing.categories import infer_category, size_matches
from rack.parsing.measurements import ParsedMeasurements, parse_measurements
from rack.profile import BRAND_AFFINITY, Profile
from rack.ranking.brands import match_designer, mentions_style_of
from rack.ranking.filters import Hidden, hard_filter, measurement_gaps
from rack.ranking.vectors import Mat, Vec, calibrate
from rack.sources.base import Category

# Cosine bands for calibration (CLIP ViT-B-32). Tunable; see CLAUDE.md.
VISUAL_BAND = (0.55, 0.90)  # image ↔ image
TEXT_BAND = (0.75, 0.95)  # text ↔ text
CROSS_BAND = (0.18, 0.32)  # text ↔ image
FEEDBACK_BAND = (0.45, 0.85)

PRICE_CUT_MIN = 0.05  # 5%
NEIGHBOURS = 15
NEIGHBOUR_MIN_SIM = 0.80
MIN_NEIGHBOURS_FOR_DEAL = 5
KNOCKOFF_SIM = 0.90
KNOCKOFF_PRICE_RATIO = 0.35
MIN_NEIGHBOURS_FOR_KNOCKOFF = 3


@dataclass
class ListingFeatures:
    id: int
    title: str
    description: str | None
    brand: str | None
    seller: str | None
    price_gbp: float | None
    size: str | None
    image_embs: Mat  # (k, d), possibly empty
    text_emb: Vec | None
    first_price_gbp: float | None = None  # price when first seen (price history)


@dataclass
class TasteContext:
    profile: Profile
    designers: dict[str, str]  # name -> love|like|curious|exclude
    taste_images: Mat  # (n, d) wardrobe + wishlist image embeddings
    taste_labels: list[str]  # one per taste image
    text_queries: Mat  # (m, d) context + wishlist text embeddings
    text_labels: list[str]
    pref: Vec | None = None  # Rocchio preference vector (None = no feedback yet)
    hidden: Hidden = field(default_factory=Hidden)


@dataclass
class ScoreResult:
    listing_id: int
    score: float
    components: dict[str, float]
    details: dict[str, Any]
    category: Category
    measurements: dict[str, float]
    filtered_reason: str | None


def _visual(images: Mat, ctx: TasteContext) -> tuple[float | None, float, int]:
    """(calibrated visual, raw, index of best taste item). None if not computable."""
    if len(ctx.taste_images) == 0:
        return None, 0.0, -1
    if len(images) == 0:
        return 0.0, 0.0, -1
    sims = (images @ ctx.taste_images.T).max(axis=0)  # best listing image per taste item
    top = np.sort(sims)[::-1][:3]
    raw = float(0.6 * top[0] + 0.4 * top.mean())
    return calibrate(raw, *VISUAL_BAND), raw, int(np.argmax(sims))


def _text(f: ListingFeatures, ctx: TasteContext) -> tuple[float | None, int]:
    if len(ctx.text_queries) == 0:
        return None, -1
    best, idx = 0.0, -1
    if f.text_emb is not None:
        s = ctx.text_queries @ f.text_emb
        i = int(np.argmax(s))
        c = calibrate(float(s[i]), *TEXT_BAND)
        if c > best:
            best, idx = c, i
    if len(f.image_embs):
        s2 = (ctx.text_queries @ f.image_embs.T).max(axis=1)
        i = int(np.argmax(s2))
        c = calibrate(float(s2[i]), *CROSS_BAND)
        if c > best:
            best, idx = c, i
    return best, idx


def _fit(
    m: ParsedMeasurements, size: str | None, category: Category, profile: Profile
) -> tuple[float, dict[str, float]]:
    parts: list[float] = []
    gaps = measurement_gaps(m, profile, category)
    tol = max(profile.measurements.tolerance_cm, 0.1)
    for gap in gaps.values():
        parts.append(1.0 if gap <= 0 else max(0.0, 1.0 - gap / tol))
    sm = size_matches(size, profile.sizes.get(category, []))
    if sm is not None:
        parts.append(1.0 if sm else 0.25)
    return (sum(parts) / len(parts) if parts else 0.5), gaps


def _neighbour_stats(
    first: Mat, prices: list[float | None], designer_matched: list[bool]
) -> tuple[list[float | None], list[float | None]]:
    """Per listing: median price of its visual neighbours, and of designer-matched lookalikes."""
    n = len(first)
    med: list[float | None] = [None] * n
    dmed: list[float | None] = [None] * n
    if n < 2:
        return med, dmed
    chunk = 512
    for start in range(0, n, chunk):
        sims = first[start : start + chunk] @ first.T
        for r in range(sims.shape[0]):
            i = start + r
            row = sims[r]
            row[i] = -1.0
            k = min(NEIGHBOURS, n - 1)
            idx = np.argpartition(-row, k - 1)[:k]
            near = [j for j in idx if row[j] >= NEIGHBOUR_MIN_SIM and prices[j] is not None]
            if len(near) >= MIN_NEIGHBOURS_FOR_DEAL:
                med[i] = float(median(prices[j] for j in near))
            look = [j for j in near if row[j] >= KNOCKOFF_SIM and designer_matched[j]]
            if len(look) >= MIN_NEIGHBOURS_FOR_KNOCKOFF:
                dmed[i] = float(median(prices[j] for j in look))
    return med, dmed


def score_all(listings: list[ListingFeatures], ctx: TasteContext) -> list[ScoreResult]:
    profile, w = ctx.profile, ctx.profile.weights
    names = list(ctx.designers)
    positive = [n for n, wt in ctx.designers.items() if wt != "exclude"]

    designers = [match_designer(f.brand, f.title, names) for f in listings]
    matched = [d is not None and ctx.designers[d] != "exclude" for d in designers]

    with_img = [i for i, f in enumerate(listings) if len(f.image_embs)]
    first = (
        np.stack([listings[i].image_embs[0] for i in with_img])
        if with_img
        else np.zeros((0, 1), dtype=np.float32)
    )
    med_sub, dmed_sub = _neighbour_stats(
        first, [listings[i].price_gbp for i in with_img], [matched[i] for i in with_img]
    )
    medians: dict[int, float | None] = dict(zip(with_img, med_sub, strict=True))
    dmedians: dict[int, float | None] = dict(zip(with_img, dmed_sub, strict=True))

    results: list[ScoreResult] = []
    for i, f in enumerate(listings):
        category = infer_category(f.title)
        m = parse_measurements(f"{f.title}\n{f.description or ''}")
        designer = designers[i]
        weight = ctx.designers.get(designer) if designer else None
        reason = hard_filter(
            title=f.title,
            description=f.description,
            brand=f.brand,
            seller=f.seller,
            price_gbp=f.price_gbp,
            size=f.size,
            category=category,
            designer=designer,
            designer_weight=weight,
            measurements=m,
            profile=profile,
            hidden=ctx.hidden,
        )

        comps: dict[str, float] = {}
        details: dict[str, Any] = {}
        vis, vis_raw, vis_idx = _visual(f.image_embs, ctx)
        if vis is not None:
            comps["visual"] = vis
            if vis_idx >= 0:
                details["visual_label"] = ctx.taste_labels[vis_idx]
        txt, txt_idx = _text(f, ctx)
        if txt is not None:
            comps["text"] = txt
            if txt_idx >= 0:
                details["text_label"] = ctx.text_labels[txt_idx]
        if ctx.pref is not None:
            fb = (
                calibrate(float((f.image_embs @ ctx.pref).max()), *FEEDBACK_BAND)
                if len(f.image_embs)
                else 0.0
            )
            comps["feedback"] = fb

        med = medians.get(i)
        if med and f.price_gbp is not None:
            rel = (med - f.price_gbp) / med
            comps["deal"] = 0.5 + 0.5 * max(-1.0, min(1.0, rel))
            details["median_gbp"] = round(med, 2)
        else:
            comps["deal"] = 0.5
        # the seller has cut the price since we first saw it: a motivated seller, a better deal
        orig = f.first_price_gbp
        if orig and f.price_gbp is not None and orig > 0:
            cut = (orig - f.price_gbp) / orig
            if cut >= PRICE_CUT_MIN:
                comps["deal"] = min(1.0, comps["deal"] + min(cut, 0.5) * 0.5)
                details["was_gbp"] = round(orig, 2)

        fit, gaps = _fit(m, f.size, category, profile)
        comps["fit"] = fit
        if gaps:
            details["fit_gaps"] = {k: round(v, 1) for k, v in gaps.items()}

        brand = BRAND_AFFINITY.get(weight or "", 0.0)
        comps["brand"] = brand
        if designer and brand:
            details["designer"] = designer
            details["designer_weight"] = weight

        knock = 0.0
        style_of = mentions_style_of(f.title, positive)
        dmed = dmedians.get(i)
        if style_of:
            knock = 1.0
            details["knockoff"] = f"“{style_of} style” listing"
        elif (
            not matched[i]
            and dmed
            and f.price_gbp is not None
            and f.price_gbp < KNOCKOFF_PRICE_RATIO * dmed
        ):
            knock = 0.5
            details["knockoff"] = "near-identical to designer pieces at a fraction of the price"
        comps["knockoff"] = knock

        weights = {
            "visual": w.visual,
            "text": w.text,
            "feedback": w.feedback,
            "deal": w.deal,
            "fit": w.fit,
        }
        present = {k: wt for k, wt in weights.items() if k in comps and wt > 0}
        total = sum(present.values())
        base = sum(wt * comps[k] for k, wt in present.items()) / total if total else 0.0
        score = base + w.brand * brand - w.knockoff_penalty * knock
        details["vis_raw"] = round(vis_raw, 4)

        results.append(
            ScoreResult(
                listing_id=f.id,
                score=round(score, 5),
                components={k: round(v, 4) for k, v in comps.items()},
                details=details,
                category=category,
                measurements=m.as_dict(),
                filtered_reason=reason,
            )
        )
    return results

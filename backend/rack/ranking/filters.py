"""Hard filters: a listing that fails one never reaches the feed. Returns a short reason code."""

from dataclasses import dataclass, field

from rack.parsing.categories import size_matches
from rack.parsing.measurements import ParsedMeasurements
from rack.profile import Profile
from rack.ranking.brands import normalize
from rack.sources.base import Category

# Which of your minimums apply to which category. ANY = we don't know, so check all present.
FIT_FIELDS: dict[Category, tuple[str, ...]] = {
    Category.TROUSERS: ("inseam",),
    Category.TOPS: ("sleeve", "p2p", "length"),
    Category.OUTERWEAR: ("sleeve", "p2p", "length"),
    Category.SHOES: (),
    Category.ACCESSORIES: (),  # no measurements
    Category.ANY: ("inseam", "sleeve", "p2p", "length"),
}


@dataclass
class Hidden:
    sellers: set[str] = field(default_factory=set)  # normalised
    brands: set[str] = field(default_factory=set)  # normalised


def banned_keyword(text: str, keywords: list[str]) -> str | None:
    """Whole-word/phrase match on normalised text, so "rep" won't hit "repair" or "prep"."""
    words = f" {normalize(text)} "
    for kw in keywords:
        k = normalize(kw)
        if k and f" {k} " in words:
            return kw
    return None


def measurement_gaps(
    m: ParsedMeasurements, profile: Profile, category: Category
) -> dict[str, float]:
    """Shortfall in cm per measurement (positive = too small/short, or too big for p2p_max)."""
    p = profile.measurements
    gaps: dict[str, float] = {}
    fields = FIT_FIELDS[category]
    checks: list[tuple[str, float | None, float | None]] = [
        ("inseam", m.inseam_cm, p.inseam_min_cm),
        ("sleeve", m.sleeve_cm, p.sleeve_min_cm),
        ("p2p", m.p2p_cm, p.p2p_min_cm),
        ("length", m.length_cm, p.length_min_cm),
    ]
    for name, have, want in checks:
        if name in fields and have is not None and want is not None:
            gaps[name] = want - have
    if "p2p" in fields and m.p2p_cm is not None and p.p2p_max_cm is not None:
        over = m.p2p_cm - p.p2p_max_cm
        gaps["p2p"] = max(gaps.get("p2p", over), over)
    return gaps


def hard_filter(
    *,
    title: str,
    description: str | None,
    brand: str | None,
    seller: str | None,
    price_gbp: float | None,
    size: str | None,
    category: Category,
    designer: str | None,
    designer_weight: str | None,
    measurements: ParsedMeasurements,
    profile: Profile,
    hidden: Hidden,
) -> str | None:
    if seller and normalize(seller) in hidden.sellers:
        return "hidden_seller"
    for b in (brand, designer):
        if b and normalize(b) in hidden.brands:
            return "hidden_brand"
    if designer_weight == "exclude":
        return "excluded_designer"

    if banned_keyword(f"{title} {description or ''}", profile.banned_keywords):
        return "banned_keyword"

    limit = profile.budget.max_for(category)
    if limit is not None and price_gbp is not None and price_gbp > limit:
        return "over_budget"

    tol = profile.measurements.tolerance_cm
    for name, gap in measurement_gaps(measurements, profile, category).items():
        if gap > tol:
            return f"fit_{name}"

    if profile.strict_size and size_matches(size, profile.sizes.get(category, [])) is False:
        return "size_mismatch"
    return None

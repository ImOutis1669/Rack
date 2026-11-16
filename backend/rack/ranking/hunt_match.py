"""Does a listing satisfy a hunt? Pure function so it is easy to test."""

from dataclasses import dataclass, field

from rack.parsing.categories import infer_category, size_matches
from rack.ranking.brands import normalize
from rack.sources.base import Category


@dataclass
class HuntSpec:
    query: str
    category: Category = Category.ANY
    max_price_gbp: float | None = None
    sizes: list[str] = field(default_factory=list)
    strict_size: bool = False  # "Size must match": no size or another size -> skipped
    min_score: float | None = None


def query_terms(query: str) -> list[str]:
    return [w for w in normalize(query).split() if len(w) > 1]


def hunt_matches(
    spec: HuntSpec,
    *,
    title: str,
    brand: str | None,
    description: str | None,
    price_gbp: float | None,
    size: str | None,
    score: float | None = None,
) -> bool:
    """Every query word must appear (marketplace search is fuzzy); filters are strict where known.

    Unknown size / category / score never excludes a listing — better a near-miss alert than a
    silently skipped grail — except with `strict_size`, where only a known, matching size passes.
    """
    text = f" {normalize(f'{brand or ""} {title} {description or ""}')} "
    if not all(f" {t} " in text for t in query_terms(spec.query)):
        return False
    if spec.max_price_gbp is not None and price_gbp is not None and price_gbp > spec.max_price_gbp:
        return False
    if spec.category != Category.ANY:
        cat = infer_category(title)
        if cat not in (Category.ANY, spec.category):
            return False
    if spec.sizes:
        fits = size_matches(size, spec.sizes)
        if fits is False or (spec.strict_size and fits is None):
            return False
    return not (spec.min_score is not None and score is not None and score < spec.min_score)

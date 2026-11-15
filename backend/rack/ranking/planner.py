"""Query planner: turn the taste profile into a rotating list of source searches."""

from dataclasses import dataclass

from rack.profile import Profile
from rack.sources.base import Category, SearchQuery

# Loved designers are searched in each of your categories; the rest only once (category any).
PER_CATEGORY_WEIGHTS = ("love",)


@dataclass
class PlannerInput:
    profile: Profile
    designers: dict[str, str]  # name -> weight
    adjacent: dict[str, list[str]]  # designer -> adjacent designers
    wishlist_texts: list[str]


def all_queries(inp: PlannerInput) -> list[SearchQuery]:
    """Every query the profile implies, interleaved so a rotation window gets a mix."""
    p = inp.profile
    designer_qs: list[SearchQuery] = []
    for name, weight in inp.designers.items():
        if weight == "exclude":
            continue
        if weight in PER_CATEGORY_WEIGHTS and p.categories:
            for cat in p.categories:
                designer_qs.append(
                    SearchQuery(text=name, category=cat, max_price_gbp=p.budget.max_for(cat))
                )
        else:
            designer_qs.append(SearchQuery(text=name, max_price_gbp=p.budget.default_max_gbp))

    wish_qs = [
        SearchQuery(text=t.strip(), max_price_gbp=p.budget.default_max_gbp)
        for t in inp.wishlist_texts
        if t.strip()
    ]

    excluded = {n.lower() for n, wt in inp.designers.items() if wt == "exclude"}
    known = {n.lower() for n in inp.designers}
    adj_names: list[str] = []
    for name, weight in inp.designers.items():
        if weight in ("love", "like"):
            for a in inp.adjacent.get(name, []):
                if a.lower() not in known and a.lower() not in excluded and a not in adj_names:
                    adj_names.append(a)
    adj_qs = [SearchQuery(text=a, max_price_gbp=p.budget.default_max_gbp) for a in adj_names]

    # round-robin: designer, designer, wishlist, adjacent, ...
    out: list[SearchQuery] = []
    streams = [designer_qs, wish_qs, adj_qs]
    pattern = [0, 0, 1, 2]
    idx = [0, 0, 0]
    while any(idx[s] < len(streams[s]) for s in range(3)):
        for s in pattern:
            if idx[s] < len(streams[s]):
                out.append(streams[s][idx[s]])
                idx[s] += 1
    return out


def next_batch(queries: list[SearchQuery], cursor: int, size: int) -> tuple[list[SearchQuery], int]:
    """Take `size` queries starting at `cursor` (wrapping). Returns (batch, new cursor)."""
    if not queries:
        return [], 0
    n = len(queries)
    start = cursor % n
    take = min(size, n)
    batch = [queries[(start + i) % n] for i in range(take)]
    return batch, (start + take) % n


def fallback(seed: list[str]) -> list[SearchQuery]:
    return [SearchQuery(text=q, category=Category.ANY) for q in seed]

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


def merge_plans(plans: list[list[SearchQuery]]) -> list[SearchQuery]:
    """All users' queries as one rotation (v2.1): round-robin across users so everyone's taste
    gets searched, the same search only once (by text and category, keeping the higher price
    cap; no cap wins). More users means each search comes round less often, never more
    requests per refresh."""
    merged: dict[tuple[str, Category], SearchQuery] = {}
    order: list[tuple[str, Category]] = []
    for i in range(max((len(p) for p in plans), default=0)):
        for plan in plans:
            if i >= len(plan):
                continue
            q = plan[i]
            key = (" ".join(q.text.lower().split()), q.category)
            have = merged.get(key)
            if have is None:
                merged[key] = q
                order.append(key)
            elif have.max_price_gbp is not None and (
                q.max_price_gbp is None or q.max_price_gbp > have.max_price_gbp
            ):
                merged[key] = have.model_copy(update={"max_price_gbp": q.max_price_gbp})
    return [merged[k] for k in order]


# The Refresh button (v2.1): only the asking user's own searches, most-wanted first. Each batch
# fills its slots in this order (two for loved designers, one wishlist, one for the rest), and
# each stream keeps its own cursor, so repeated refreshes move on instead of repeating.
TAILORED_SLOTS = ("love", "love", "wish", "more")
TAILORED_STREAMS = ("love", "wish", "more")


def tailored_streams(inp: PlannerInput) -> dict[str, list[SearchQuery]]:
    """One user's searches split by how much they want them: loved designers in each of their
    categories (category-major, so a batch spans designers), wishlist texts, then liked,
    curious and adjacent designers."""
    p = inp.profile
    loved = [n for n, w in inp.designers.items() if w == "love"]
    if p.categories:
        love = [
            SearchQuery(text=n, category=c, max_price_gbp=p.budget.max_for(c))
            for c in p.categories
            for n in loved
        ]
    else:
        love = [SearchQuery(text=n, max_price_gbp=p.budget.default_max_gbp) for n in loved]
    wish = [
        SearchQuery(text=t.strip(), max_price_gbp=p.budget.default_max_gbp)
        for t in inp.wishlist_texts
        if t.strip()
    ]
    known = {n.lower() for n in inp.designers}
    more_names = [n for w in ("like", "curious") for n, wt in inp.designers.items() if wt == w]
    for name, weight in inp.designers.items():
        if weight in ("love", "like"):
            for a in inp.adjacent.get(name, []):
                if a.lower() not in known and a not in more_names:
                    more_names.append(a)
    more = [SearchQuery(text=n, max_price_gbp=p.budget.default_max_gbp) for n in more_names]
    return {"love": love, "wish": wish, "more": more}


def tailored_batch(
    streams: dict[str, list[SearchQuery]], cursors: dict[str, int], size: int
) -> tuple[list[SearchQuery], dict[str, int]]:
    """The next `size` searches for one user. A slot whose stream is empty goes to the next
    stream in TAILORED_STREAMS order; the same search never appears twice in a batch."""
    cur = {k: int(cursors.get(k, 0)) for k in TAILORED_STREAMS}
    used: set[tuple[str, Category]] = set()

    def take(kind: str) -> SearchQuery | None:
        stream = streams.get(kind, [])
        for _ in range(len(stream)):
            i = cur[kind] % len(stream)
            cur[kind] = (i + 1) % len(stream)
            q = stream[i]
            key = (" ".join(q.text.lower().split()), q.category)
            if key not in used:
                used.add(key)
                return q
        return None

    out: list[SearchQuery] = []
    for n in range(size):
        slot = TAILORED_SLOTS[n % len(TAILORED_SLOTS)]
        for kind in (slot, *(k for k in TAILORED_STREAMS if k != slot)):
            if (q := take(kind)) is not None:
                out.append(q)
                break
    return out, cur

"""Cross-listing dedupe: the same item listed twice (other site, repost) becomes one feed card.

A pair is a duplicate when the first photos' pHashes are within HAMMING_MAX bits *and* their CLIP
embeddings agree (cosine ≥ COSINE_MIN). Requiring both avoids merging two different items that
share a stock photo layout, or two photos that are merely similar in style.
"""

import numpy as np

from rack.ranking.brands import normalize
from rack.ranking.vectors import Mat

HAMMING_MAX = 6
COSINE_MIN = 0.96
# A photo hash shared by more listings than this is a placeholder ("no image") or stock shot,
# not one item listed several times, so those listings are never merged.
PLACEHOLDER_MAX = 5
TITLE_OVERLAP_MIN = 0.2  # Jaccard of title words; different items rarely share any words


def same_brand(a: str | None, b: str | None) -> bool:
    """Unknown brand is compatible with anything; two known brands must overlap."""
    na, nb = normalize(a or ""), normalize(b or "")
    return not na or not nb or na in nb or nb in na


def title_overlap(a: str, b: str) -> float:
    wa = {w for w in normalize(a).split() if len(w) > 1}
    wb = {w for w in normalize(b).split() if len(w) > 1}
    return len(wa & wb) / len(wa | wb) if wa and wb else 1.0


def clusters(
    ids: list[int],
    hashes: list[str],
    embs: Mat,
    prices: list[float | None],
    brands: list[str | None] | None = None,
    titles: list[str] | None = None,
) -> dict[int, int]:
    """Map listing id -> representative id (cheapest in its group). Singletons are omitted."""
    brands = brands or [None] * len(ids)
    titles = titles or [""] * len(ids)
    counts: dict[str, int] = {}
    for x in hashes:
        counts[x] = counts.get(x, 0) + 1
    keep = [i for i, x in enumerate(hashes) if counts[x] <= PLACEHOLDER_MAX]
    if len(keep) < len(hashes):
        ids = [ids[i] for i in keep]
        hashes = [hashes[i] for i in keep]
        embs = embs[keep]
        prices = [prices[i] for i in keep]
        brands = [brands[i] for i in keep]
        titles = [titles[i] for i in keep]
    n = len(ids)
    if n < 2:
        return {}
    h = np.array([int(x, 16) for x in hashes], dtype=np.uint64)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    known: dict[int, set[str]] = {i: ({b} if b else set()) for i, b in enumerate(brands)}
    chunk = 1024
    for start in range(0, n, chunk):
        block = h[start : start + chunk]
        dist = np.bitwise_count(block[:, None] ^ h[None, :])
        rows, cols = np.nonzero(dist <= HAMMING_MAX)
        for r, c in zip(rows.tolist(), cols.tolist(), strict=True):
            i = start + r
            if c <= i:
                continue
            if float(embs[i] @ embs[c]) < COSINE_MIN:
                continue
            if title_overlap(titles[i], titles[c]) < TITLE_OVERLAP_MIN:
                continue
            ri, rc = find(i), find(c)
            # check whole groups, so an unbranded copy can't chain two different brands together
            if ri != rc and all(same_brand(x, y) for x in known[ri] for y in known[rc]):
                parent[ri] = rc
                known[rc] |= known.pop(ri)

    groups: dict[int, list[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)
    out: dict[int, int] = {}
    for members in groups.values():
        if len(members) < 2:
            continue
        rep = min(members, key=lambda i: (prices[i] is None, prices[i] or 0.0, ids[i]))
        for i in members:
            out[ids[i]] = ids[rep]
    return out

"""Feed ordering: MMR for diversity, plus an exploration share from the mid-score band."""

import random

import numpy as np

from rack.ranking.vectors import Mat


def mmr(scores: list[float], embs: Mat, lam: float = 0.7, k: int | None = None) -> list[int]:
    """Greedy maximal marginal relevance. Returns indices into `scores`.

    `embs` rows are L2-normalised; an all-zero row (no embedding) is similar to nothing.
    """
    n = len(scores)
    k = n if k is None else min(k, n)
    if n == 0:
        return []
    rel = np.asarray(scores, dtype=np.float32)
    sim = embs @ embs.T if len(embs) else np.zeros((n, n), dtype=np.float32)
    chosen: list[int] = []
    max_sim = np.full(n, 0.0, dtype=np.float32)
    available = np.ones(n, dtype=bool)
    for _ in range(k):
        val = lam * rel - (1 - lam) * max_sim
        val[~available] = -np.inf
        i = int(np.argmax(val))
        chosen.append(i)
        available[i] = False
        max_sim = np.maximum(max_sim, sim[i])
    return chosen


def interleave_exploration(ranked: list[int], pool: list[int], rate: float, seed: int) -> list[int]:
    """Pull a random `pool` item forward into every ~1/rate-th slot.

    A pulled item that also appears later in `ranked` is moved, not duplicated. `rate` 0 returns
    `ranked` unchanged. Deterministic for a given seed, so pagination is stable.
    """
    if rate <= 0 or not pool:
        return list(ranked)
    rng = random.Random(seed)
    head = set(ranked[: max(1, round(1 / rate))])
    extra = [p for p in pool if p not in head]
    rng.shuffle(extra)
    every = max(2, round(1 / rate))
    out: list[int] = []
    for pos, item in enumerate(ranked, start=1):
        out.append(item)
        if pos % (every - 1) == 0 and extra:
            out.append(extra.pop())
    return list(dict.fromkeys(out))

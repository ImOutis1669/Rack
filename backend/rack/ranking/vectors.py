"""Small numpy helpers for embedding maths. All vectors are float32, L2-normalised."""

from collections.abc import Sequence

import numpy as np
import numpy.typing as npt

Vec = npt.NDArray[np.float32]
Mat = npt.NDArray[np.float32]


def as_matrix(rows: Sequence[Sequence[float] | Vec], dim: int = 512) -> Mat:
    if len(rows) == 0:
        return np.zeros((0, dim), dtype=np.float32)
    return normalize_rows(np.asarray(rows, dtype=np.float32))


def normalize_rows(m: Mat) -> Mat:
    norms = np.linalg.norm(m, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return (m / norms).astype(np.float32)


def normalize(v: Vec) -> Vec:
    n = float(np.linalg.norm(v))
    return v if n == 0 else (v / n).astype(np.float32)


def calibrate(x: float, lo: float, hi: float) -> float:
    """Map a raw cosine from the band [lo, hi] onto [0, 1], clipped.

    CLIP cosines live in narrow, modality-specific bands; this makes them comparable.
    """
    if hi <= lo:
        return 0.0
    return float(min(1.0, max(0.0, (x - lo) / (hi - lo))))


def rocchio(
    centroid: Vec | None,
    liked: Mat,
    disliked: Mat,
    alpha: float = 1.0,
    beta: float = 0.75,
    gamma: float = 0.25,
) -> Vec | None:
    """Preference vector p = norm(α·centroid + β·mean(liked) − γ·mean(disliked)).

    Returns None when there is no feedback at all (the component is then left out).
    """
    if len(liked) == 0 and len(disliked) == 0:
        return None
    dim = liked.shape[1] if len(liked) else disliked.shape[1]
    p = np.zeros(dim, dtype=np.float32)
    if centroid is not None:
        p += alpha * centroid
    if len(liked):
        p += beta * liked.mean(axis=0)
    if len(disliked):
        p -= gamma * disliked.mean(axis=0)
    return normalize(p)

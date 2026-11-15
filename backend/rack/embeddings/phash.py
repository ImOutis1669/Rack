"""Perceptual hash (pHash): 64-bit DCT hash of a 32×32 greyscale thumbnail."""

from functools import lru_cache

import numpy as np
import numpy.typing as npt
from PIL import Image

SIZE = 32
LOW = 8


@lru_cache
def _dct_matrix() -> npt.NDArray[np.float64]:
    n = np.arange(SIZE)
    m = np.cos(np.pi * (2 * n[None, :] + 1) * n[:, None] / (2 * SIZE))
    m[0] /= np.sqrt(2)
    out: npt.NDArray[np.float64] = m * np.sqrt(2 / SIZE)
    return out


def phash(img: Image.Image) -> str:
    """16-char hex string; near-identical photos differ in only a few bits."""
    g = np.asarray(img.convert("L").resize((SIZE, SIZE), Image.Resampling.LANCZOS), np.float64)
    d = _dct_matrix()
    low = (d @ g @ d.T)[:LOW, :LOW].ravel()
    bits = low > np.median(low[1:])
    value = 0
    for b in bits:
        value = (value << 1) | int(b)
    return f"{value:016x}"


def hamming(a: str, b: str) -> int:
    return (int(a, 16) ^ int(b, 16)).bit_count()

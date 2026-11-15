"""Deterministic stand-in for CLIP: colour layout for images, hashed words for text."""

import hashlib
import io

import numpy as np
from PIL import Image

from rack.ranking.vectors import Mat, normalize_rows


class FakeEmbedder:
    def embed_images(self, images: list[Image.Image]) -> Mat:
        rows = []
        for img in images:
            px = np.asarray(img.convert("RGB").resize((4, 4)), dtype=np.float32).ravel()
            v = np.zeros(512, dtype=np.float32)
            v[: px.size] = px + 1.0
            rows.append(v)
        return normalize_rows(np.stack(rows)) if rows else np.zeros((0, 512), np.float32)

    def embed_texts(self, texts: list[str]) -> Mat:
        rows = []
        for t in texts:
            v = np.zeros(512, dtype=np.float32)
            for w in t.lower().split():
                v[int(hashlib.md5(w.encode()).hexdigest(), 16) % 512] += 1.0
            rows.append(v + 1e-3)
        return normalize_rows(np.stack(rows)) if rows else np.zeros((0, 512), np.float32)


def png(color: str, size: tuple[int, int] = (32, 32)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()

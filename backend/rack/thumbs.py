"""Small cached WebP thumbnails of listing and wardrobe photos (v1.1 performance).

Tiles show ~180 px wide photos; marketplaces serve originals up to 1600 px and 800 kB. The API
resizes once, caches on disk under RACK_DATA_DIR/thumbs, and the worker prunes the cache by age
(RACK_THUMBS_MAX_AGE_DAYS, 7 by default, the same as the eBay retention) and size.
"""

import hashlib
import io
import os
import time
from pathlib import Path

from PIL import Image, ImageOps

from rack.embeddings.images import open_image

WIDTHS = (480, 960)
QUALITY = 78


def cache_path(root: Path, source: str, width: int) -> Path:
    """Where the thumbnail of `source` (a URL or local file name) at `width` lives."""
    h = hashlib.sha256(source.encode()).hexdigest()
    return root / h[:2] / f"{h}_{width}.webp"


def make_thumb(data: bytes, width: int) -> bytes:
    """WebP no wider than `width` (never upscaled), EXIF-rotated, metadata dropped."""
    img = ImageOps.exif_transpose(open_image(data))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    if img.width > width:
        img = img.resize(
            (width, max(1, round(img.height * width / img.width))), Image.Resampling.LANCZOS
        )
    out = io.BytesIO()
    img.save(out, format="WEBP", quality=QUALITY, method=4)
    return out.getvalue()


def write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def prune(root: Path, *, max_bytes: int, max_age_s: float, now: float | None = None) -> int:
    """Delete thumbnails older than `max_age_s`, then the oldest until under `max_bytes`."""
    if not root.exists():
        return 0
    now = now if now is not None else time.time()
    files = []
    removed = 0
    for p in root.rglob("*.webp"):
        try:
            st = p.stat()
        except FileNotFoundError:
            continue
        if now - st.st_mtime > max_age_s:
            p.unlink(missing_ok=True)
            removed += 1
        else:
            files.append((st.st_mtime, st.st_size, p))
    total = sum(size for _, size, _ in files)
    for _, size, p in sorted(files):  # oldest first
        if total <= max_bytes:
            break
        p.unlink(missing_ok=True)
        total -= size
        removed += 1
    return removed

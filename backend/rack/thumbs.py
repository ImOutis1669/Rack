"""Small cached thumbnails of listing and wardrobe photos (v1.1 performance, v1.2 quality).

Tiles show ~180 px wide photos; marketplaces serve originals up to 1600 px and 800 kB. The API
resizes once, caches on disk under RACK_DATA_DIR/thumbs, and the worker prunes the cache by age
(RACK_THUMBS_MAX_AGE_DAYS, 7 by default, the same as the eBay retention) and size.

Formats (v1.2, measured in docs/perf-v1.2.md): AVIF quality 70 for browsers that accept it
(Safari since iOS 16): about WebP-85 quality for ~13-15% fewer bytes. Others get WebP 85 (was
78). SETTINGS_VERSION is part of every cache name, so changing a setting never serves an old file.
"""

import hashlib
import io
import os
import time
from pathlib import Path
from typing import Literal

from PIL import Image, ImageOps

from rack.embeddings.images import open_image

WIDTHS = (480, 640, 960)  # 640: a 2-column iPhone tile at 3x
Format = Literal["avif", "webp"]
QUALITY: dict[str, int] = {"avif": 70, "webp": 85}
MEDIA_TYPES: dict[str, str] = {"avif": "image/avif", "webp": "image/webp"}
SETTINGS_VERSION = 2  # bump when QUALITY / resampling change


def pick_format(accept: str | None) -> Format:
    """AVIF when the browser says it can show it, else WebP."""
    return "avif" if accept and "image/avif" in accept else "webp"


def cache_path(root: Path, source: str, width: int, fmt: Format = "webp") -> Path:
    """Where the thumbnail of `source` (a URL or local file name) at `width` lives."""
    h = hashlib.sha256(source.encode()).hexdigest()
    return root / h[:2] / f"{h}_{width}_v{SETTINGS_VERSION}.{fmt}"


def make_thumb(data: bytes, width: int, fmt: Format = "webp") -> bytes:
    """AVIF/WebP no wider than `width` (never upscaled), EXIF-rotated, metadata dropped."""
    img = ImageOps.exif_transpose(open_image(data))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    if img.width > width:
        img = img.resize(
            (width, max(1, round(img.height * width / img.width))), Image.Resampling.LANCZOS
        )
    out = io.BytesIO()
    if fmt == "avif":
        img.save(out, format="AVIF", quality=QUALITY["avif"], speed=6)
    else:
        img.save(out, format="WEBP", quality=QUALITY["webp"], method=4)
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
    for p in (*root.rglob("*.webp"), *root.rglob("*.avif")):
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

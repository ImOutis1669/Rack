"""Profile photos (v2.1 step 4): square, metadata-free JPEGs in RACK_DATA_DIR/avatars."""

import io
from pathlib import Path

from PIL import Image, ImageOps

from rack.embeddings.images import open_image

SIDE = 512


def make_avatar(data: bytes) -> bytes:
    """Centre-cropped square JPEG. Applies the EXIF rotation, then drops every bit of metadata
    (GPS, camera) by re-encoding pixels only. Raises ImageError for anything that isn't an
    image (same checks as wardrobe uploads: size cap, decompression-bomb guard)."""
    img = ImageOps.exif_transpose(open_image(data)).convert("RGB")
    img = ImageOps.fit(img, (SIDE, SIDE), method=Image.Resampling.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=88)
    return out.getvalue()


def avatar_path(data_dir: Path, user_id: int) -> Path:
    return data_dir / "avatars" / f"{user_id}.jpg"

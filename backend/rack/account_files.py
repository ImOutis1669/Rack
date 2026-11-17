"""Files that belong to one account: wardrobe/wishlist photos, their cached thumbnails and the
profile photo. Deleting an account removes all of them (rows go by ON DELETE CASCADE)."""

import shutil
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rack.avatars import avatar_path
from rack.config import Settings
from rack.models import TasteItemRow
from rack.thumbs import WIDTHS, cache_path


def _inside(path: Path, root: Path) -> bool:
    return path.resolve().is_relative_to(root.resolve())


async def remove_user_files(session: AsyncSession, settings: Settings, user_id: int) -> int:
    """Deletes the user's uploads, their thumbnails and their profile photo. Call before
    deleting the user row (it reads their taste items). Returns how many files went."""
    uploads = settings.uploads_dir
    thumbs = settings.rack_data_dir / "thumbs"
    paths = (
        await session.execute(
            select(TasteItemRow.image_path).where(
                TasteItemRow.user_id == user_id, TasteItemRow.image_path.is_not(None)
            )
        )
    ).scalars()
    removed = 0
    for rel in paths:
        files = [uploads / str(rel)] + [
            cache_path(thumbs, f"upload:{rel}", w, fmt) for w in WIDTHS for fmt in ("avif", "webp")
        ]
        for f in files:
            if (_inside(f, uploads) or _inside(f, thumbs)) and f.is_file():
                f.unlink()
                removed += 1
    own_dir = uploads / str(user_id)
    if own_dir.is_dir() and _inside(own_dir, uploads) and own_dir.resolve() != uploads.resolve():
        removed += sum(1 for p in own_dir.rglob("*") if p.is_file())
        shutil.rmtree(own_dir)
    avatar = avatar_path(settings.rack_data_dir, user_id)
    if avatar.is_file():
        avatar.unlink()
        removed += 1
    return removed

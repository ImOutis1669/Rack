"""eBay photos: store the full-size (s-l1600) variant instead of the 225 px search thumbnail

Search summaries return each photo as `.../s-l225.jpg`; getItem returns the same photo id as
`s-l1600` (see rack.sources.ebay.full_size_image). Existing rows are rewritten to the full-size
URL (new url_hash; embedding and pHash kept: same photo). A listing that already had both
variants of a photo keeps one row, and positions are renumbered. Cached thumbnails of the old
URLs are deleted (new URLs get new cache files; the browser re-fetches because tile URLs carry
a version from the photo URL).

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-17
"""

import hashlib
from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa
from alembic import op

from rack.config import get_settings

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PATTERN = r"^(https://i\.ebayimg\.com/images/g/[^/]+/)s-l[0-9]+(\.(jpe?g|png|webp))$"
NEW_URL = rf"regexp_replace(i.url, '{PATTERN}', '\1s-l1600\2', 'i')"

EBAY_ROWS = f"""
SELECT i.id, i.listing_id, i.position, i.url, {NEW_URL} AS new_url
FROM listing_images i JOIN listings l ON l.id = i.listing_id
WHERE l.source = 'ebay' AND i.url ~* '{PATTERN}'
"""

# Both variants of one photo on a listing: keep the first by position.
DROP_DUPLICATES = f"""
DELETE FROM listing_images WHERE id IN (
    SELECT id FROM (
        SELECT e.id, row_number() OVER (
            PARTITION BY e.listing_id, e.new_url ORDER BY e.position, e.id
        ) AS rn
        FROM ({EBAY_ROWS}) e
    ) ranked WHERE rn > 1
)
"""

REWRITE = f"""
UPDATE listing_images i
SET url = {NEW_URL},
    url_hash = encode(sha256(convert_to({NEW_URL}, 'UTF8')), 'hex')
FROM listings l
WHERE l.id = i.listing_id AND l.source = 'ebay' AND i.url ~* '{PATTERN}' AND i.url <> {NEW_URL}
"""

RENUMBER = """
UPDATE listing_images i SET position = r.rn - 1
FROM (
    SELECT i2.id, row_number() OVER (PARTITION BY i2.listing_id ORDER BY i2.position, i2.id) AS rn
    FROM listing_images i2 JOIN listings l ON l.id = i2.listing_id
    WHERE l.source = 'ebay'
) r
WHERE i.id = r.id AND i.position <> r.rn - 1
"""


def upgrade() -> None:
    conn = op.get_bind()
    old_urls = [
        row.url
        for row in conn.execute(sa.text(EBAY_ROWS))
        if row.url != row.new_url
    ]
    conn.execute(sa.text(DROP_DUPLICATES))
    conn.execute(sa.text(REWRITE))
    conn.execute(sa.text(RENUMBER))

    # Best effort: the old thumbnails are unreachable now; prune() would drop them in a week.
    root = get_settings().rack_data_dir / "thumbs"
    if root.is_dir():
        for url in old_urls:
            h = hashlib.sha256(url.encode()).hexdigest()
            for f in Path(root, h[:2]).glob(f"{h}_*.webp"):
                f.unlink(missing_ok=True)


def downgrade() -> None:
    # The 225 px variant is never wanted back; nothing to undo.
    pass

"""wardrobe/wishlist items: name, purchase date and category (minimal Wardrobe)

Backfill: `name` from the photo items' label (kept in `note` until now; that note is then
cleared) or from `text`; `purchase_date` from `purchased_at`. `text` is left alone: it's the text
the feed's taste matching reads.

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BACKFILL = """
UPDATE taste_items SET
    name = CASE
        WHEN image_path IS NOT NULL AND text IS NULL THEN note
        ELSE COALESCE(text, note)
    END,
    note = CASE
        WHEN image_path IS NOT NULL AND text IS NULL THEN NULL
        ELSE note
    END,
    purchase_date = (purchased_at AT TIME ZONE 'UTC')::date
"""


def upgrade() -> None:
    op.add_column("taste_items", sa.Column("name", sa.String(300)))
    op.add_column("taste_items", sa.Column("purchase_date", sa.Date()))
    op.add_column("taste_items", sa.Column("category", sa.String(16)))
    op.execute(BACKFILL)


def downgrade() -> None:
    op.execute(
        "UPDATE taste_items SET note = name WHERE image_path IS NOT NULL AND text IS NULL "
        "AND note IS NULL"
    )
    for c in ("category", "purchase_date", "name"):
        op.drop_column("taste_items", c)

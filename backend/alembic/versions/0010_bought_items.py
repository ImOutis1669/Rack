"""wardrobe items bought from a listing ("I bought it")

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "taste_items",
        sa.Column("listing_id", sa.Integer(), sa.ForeignKey("listings.id", ondelete="SET NULL")),
    )
    op.create_index("ix_taste_items_listing_id", "taste_items", ["listing_id"])
    op.add_column("taste_items", sa.Column("source", sa.String(32)))
    op.add_column("taste_items", sa.Column("listing_url", sa.Text()))
    op.add_column("taste_items", sa.Column("brand", sa.String(200)))
    op.add_column("taste_items", sa.Column("size", sa.String(64)))
    op.add_column("taste_items", sa.Column("purchase_price_gbp", sa.Numeric(12, 2)))
    op.add_column("taste_items", sa.Column("purchased_at", sa.DateTime(timezone=True)))
    op.add_column("taste_items", sa.Column("saved_snapshot", postgresql.JSONB()))


def downgrade() -> None:
    op.drop_index("ix_taste_items_listing_id", "taste_items")
    for c in (
        "saved_snapshot",
        "purchased_at",
        "purchase_price_gbp",
        "size",
        "brand",
        "listing_url",
        "source",
        "listing_id",
    ):
        op.drop_column("taste_items", c)

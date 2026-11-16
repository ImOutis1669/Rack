"""Grailed sold prices for estimates and trends (5c), daily estimate snapshots

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sold_listings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("source_id", sa.String(128), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("brand", sa.String(200)),
        sa.Column("category", sa.String(16), nullable=False, server_default="any"),
        sa.Column("size", sa.String(64)),
        sa.Column("sold_price_gbp", sa.Numeric(12, 2), nullable=False),
        sa.Column("shipping_gbp", sa.Numeric(12, 2)),
        sa.Column("sold_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("image_url", sa.Text()),
        sa.Column("embedding", Vector(512)),
        sa.Column("embed_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("source", "source_id", name="uq_sold_source"),
    )
    op.create_index("ix_sold_listings_sold_at", "sold_listings", ["sold_at"])
    op.execute(
        "CREATE INDEX ix_sold_listings_embedding ON sold_listings "
        "USING hnsw (embedding vector_cosine_ops)"
    )
    op.create_table(
        "estimate_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "taste_item_id",
            sa.Integer(),
            sa.ForeignKey("taste_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("estimate_gbp", sa.Numeric(12, 2), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.UniqueConstraint("taste_item_id", "day", name="uq_snapshot_day"),
    )
    op.add_column("taste_items", sa.Column("estimate_kind", sa.String(8)))
    op.add_column("taste_items", sa.Column("sold_checked_at", sa.DateTime(timezone=True)))
    op.add_column("taste_items", sa.Column("trend", postgresql.JSONB()))


def downgrade() -> None:
    for c in ("trend", "sold_checked_at", "estimate_kind"):
        op.drop_column("taste_items", c)
    op.drop_table("estimate_snapshots")
    op.drop_table("sold_listings")

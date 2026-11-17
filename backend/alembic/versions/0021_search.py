"""Search across all sources (v2.1 step 4b): text indexes on listings, live search requests

- `pg_trgm` + a trigram GIN index on lower(brand || ' ' || title): typos and partial words.
- A full-text GIN index on brand, title and description ('simple' config: no stemming, so
  brand names and sizes match as typed).
  Both expressions must stay identical to `rack.search.TRGM_DOC` / `FTS_DOC`.
- `search_requests`: a user's "search the marketplaces now", run by the worker. Deleted a day
  after they finish (queries are personal; recent searches live on the device).

Revision ID: 0021
Revises: 0020
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TRGM_DOC = "lower(coalesce(brand, '') || ' ' || title)"
FTS_DOC = (
    "to_tsvector('simple'::regconfig, coalesce(brand, '') || ' ' || title || ' ' || "
    "coalesce(description, ''))"
)


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(f"CREATE INDEX ix_listings_trgm ON listings USING gin (({TRGM_DOC}) gin_trgm_ops)")
    op.execute(f"CREATE INDEX ix_listings_fts ON listings USING gin (({FTS_DOC}))")
    op.create_table(
        "search_requests",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("query", sa.String(100), nullable=False),
        sa.Column("category", sa.String(16), nullable=False, server_default="any"),
        sa.Column("max_price_gbp", sa.Numeric(12, 2)),
        sa.Column("status", sa.String(8), nullable=False, server_default="queued"),
        sa.Column("results", JSONB, nullable=False, server_default="{}"),  # source -> count/error
        sa.Column("listing_ids", JSONB, nullable=False, server_default="[]"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'done', 'error')", name="ck_search_requests_status"
        ),
    )
    op.create_index("ix_search_requests_status", "search_requests", ["status", "created_at"])


def downgrade() -> None:
    op.drop_table("search_requests")
    op.execute("DROP INDEX IF EXISTS ix_listings_fts")
    op.execute("DROP INDEX IF EXISTS ix_listings_trgm")
    # pg_trgm stays installed: harmless, and other things may use it

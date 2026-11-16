"""price history, web push subscriptions

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "price_observations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "listing_id",
            sa.Integer(),
            sa.ForeignKey("listings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("price_gbp", sa.Numeric(12, 2), nullable=False),
        sa.Column("observed_at", TS, nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_price_obs_listing", "price_observations", ["listing_id", "observed_at"])
    # seed history with what we know today
    op.execute(
        "INSERT INTO price_observations (listing_id, price_gbp, observed_at) "
        "SELECT id, price_gbp, first_seen_at FROM listings WHERE price_gbp IS NOT NULL"
    )
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("endpoint", sa.Text(), nullable=False, unique=True),
        sa.Column("keys", postgresql.JSONB(), nullable=False),
        sa.Column("user_agent", sa.Text()),
        sa.Column("created_at", TS, nullable=False, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("push_subscriptions")
    op.drop_index("ix_price_obs_listing", "price_observations")
    op.drop_table("price_observations")

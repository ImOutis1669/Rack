"""blocked sources, cross-listing clusters

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "source_health",
        sa.Column("blocked", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("source_health", sa.Column("last_check_at", sa.DateTime(timezone=True)))
    op.add_column("listings", sa.Column("cluster_id", sa.Integer()))
    op.create_index("ix_listings_cluster_id", "listings", ["cluster_id"])


def downgrade() -> None:
    op.drop_index("ix_listings_cluster_id", "listings")
    op.drop_column("listings", "cluster_id")
    op.drop_column("source_health", "last_check_at")
    op.drop_column("source_health", "blocked")

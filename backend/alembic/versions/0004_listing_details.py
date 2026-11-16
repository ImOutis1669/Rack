"""when full listing details (all photos, description) were last fetched

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("listings", sa.Column("details_fetched_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("listings", "details_fetched_at")

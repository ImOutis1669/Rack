"""listings.excluded: why a listing is permanently hidden (e.g. eBay getItem says women's)

Searches re-upsert listings as active; an excluded listing stays inactive instead.

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("listings", sa.Column("excluded", sa.String(32)))


def downgrade() -> None:
    op.drop_column("listings", "excluded")

"""Grailed shoe sizes are US sizes: store them as "US 10", not a bare "10"

Rack reads a bare shoe size as UK, so a Grailed US 10 (a UK 9) was matched as a UK 10: "size
must match" hid the right shoes and showed ones a size too small. The adapter now prefixes "US";
this fixes listings and sold items already stored, then marks listings changed so everyone's
feed is re-scored.

Revision ID: 0022
Revises: 0021
Create Date: 2026-11-17
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BARE = r"^([3-9]|1[0-6])(\.5)?$"  # US men's 3-16 (rack.sources.grailed.US_SHOE)


def upgrade() -> None:
    op.execute(
        f"""UPDATE listings SET size = 'US ' || size
        WHERE source = 'grailed' AND raw->>'category' = 'footwear' AND size ~ '{BARE}'"""
    )
    op.execute(
        f"""UPDATE sold_listings SET size = 'US ' || size
        WHERE source = 'grailed' AND category = 'shoes' AND size ~ '{BARE}'"""
    )
    op.execute(
        """INSERT INTO app_state (key, value)
        VALUES ('scoring', jsonb_build_object('changed_at', to_jsonb(now())))
        ON CONFLICT (key) DO UPDATE SET value = app_state.value || EXCLUDED.value"""
    )


def downgrade() -> None:
    for table in ("listings", "sold_listings"):
        op.execute(
            rf"""UPDATE {table} SET size = substr(size, 4)
            WHERE source = 'grailed' AND size ~ '^US \d{{1,2}}(\.5)?$'"""
        )

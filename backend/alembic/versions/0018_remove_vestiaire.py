"""Remove Vestiaire Collective (v1.2: the user keeps eBay, Vinted and Grailed only)

Deletes Vestiaire listings (their photos, scores, votes, saves, seen marks, hunt matches and price
history go with them: ON DELETE CASCADE), its source-health row, the worker state of the Apify job
and the daily recheck, and "vestiaire" from hunts' source lists. Wardrobe items that came from
Vestiaire are the user's own records and are kept (their link to a listing is cleared by the FK).
On 2026-11-17 there were no Vestiaire listings or wardrobe items, so only the health row and the
recheck state actually changed.

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-17
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DELETE FROM listings WHERE source = 'vestiaire'")
    op.execute("DELETE FROM sold_listings WHERE source = 'vestiaire'")
    op.execute("DELETE FROM source_health WHERE source = 'vestiaire'")
    op.execute(
        "DELETE FROM app_state WHERE key IN "
        "('recheck', 'vestiaire_run', 'vestiaire_usage', 'vestiaire_planner')"
    )
    op.execute(
        """
        UPDATE hunts SET sources = (
            SELECT coalesce(jsonb_agg(s), '[]'::jsonb)
            FROM jsonb_array_elements(sources) AS s
            WHERE s <> '"vestiaire"'::jsonb
        )
        WHERE sources ? 'vestiaire'
        """
    )


def downgrade() -> None:
    # Deleted data isn't recreated; the source itself is gone from the code.
    pass

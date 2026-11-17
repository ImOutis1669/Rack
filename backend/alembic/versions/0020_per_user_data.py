"""Per-user data (v2.1 step 2): an owner column on every personal table

Every personal table gets `user_id` (FK users, ON DELETE CASCADE), filled with the owner's id,
and its keys gain the user: votes, saves, seen marks and scores become (user_id, listing_id);
designer names, adjacent pairs, hidden sellers/brands and alert keys are unique per user.
`user_state` holds the per-user part of `app_state` (feed visits, scoring state).

If there is personal data but no account yet (the server is upgraded straight from v2.0), the
owner is created here from RACK_PASSWORD_HASH / RACK_OWNER_USERNAME, exactly as the API would on
the first login. Without a hash the migration stops rather than guess.

Uploaded photos stay where they are (their paths are relative to the uploads folder); new uploads
go to `uploads/<user id>/`.

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-17
"""

import json
import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = (
    "profile",
    "designers",
    "adjacent_designers",
    "taste_items",
    "listing_scores",
    "feedback",
    "saved",
    "seen",
    "hidden",
    "hunts",
    "notifications",
    "push_subscriptions",
)


def _owner_id(conn: sa.Connection) -> int | None:
    owner = conn.execute(sa.text("SELECT id FROM users WHERE role = 'owner'")).scalar()
    if owner is not None:
        return int(owner)
    has_data = any(
        conn.execute(sa.text(f"SELECT EXISTS (SELECT 1 FROM {t})")).scalar() for t in TABLES
    )
    if not has_data:
        return None  # fresh database: nothing to hand over
    from rack.config import get_settings

    s = get_settings()
    if not s.rack_password_hash.startswith("$argon2"):
        raise RuntimeError(
            "There is data but no owner account and RACK_PASSWORD_HASH isn't set: set it in "
            ".env.api (rack hash-password) and run the migration again."
        )
    name = s.rack_owner_username.strip().lower()
    if not re.fullmatch(r"[a-z0-9_.]{3,24}", name):
        name = "owner"
    auth = conn.execute(sa.text("SELECT value FROM app_state WHERE key = 'auth'")).scalar()
    epoch = int((auth if isinstance(auth, dict) else json.loads(auth or "{}")).get("epoch", 0))
    return int(
        conn.execute(
            sa.text(
                "INSERT INTO users (username, display_name, password_hash, role, session_epoch) "
                "VALUES (:u, :u, :h, 'owner', :e) RETURNING id"
            ),
            {"u": name, "h": s.rack_password_hash, "e": epoch},
        ).scalar_one()
    )


def upgrade() -> None:
    conn = op.get_bind()
    owner = _owner_id(conn)

    for t in TABLES:
        op.add_column(t, sa.Column("user_id", sa.Integer, nullable=True))
        if owner is not None:
            conn.execute(sa.text(f"UPDATE {t} SET user_id = :o"), {"o": owner})
        op.alter_column(t, "user_id", nullable=False)
        op.create_foreign_key(f"fk_{t}_user", t, "users", ["user_id"], ["id"], ondelete="CASCADE")

    # one profile per user
    op.create_unique_constraint("uq_profile_user", "profile", ["user_id"])

    # (user_id, listing_id) keys
    for t in ("listing_scores", "feedback", "saved", "seen"):
        op.drop_constraint(f"{t}_pkey", t, type_="primary")
        op.create_primary_key(f"{t}_pkey", t, ["user_id", "listing_id"])
        op.create_index(f"ix_{t}_listing", t, ["listing_id"])  # cascade deletes from listings
    op.drop_index("ix_listing_scores_score", table_name="listing_scores")
    op.create_index("ix_listing_scores_user_score", "listing_scores", ["user_id", "score"])

    op.drop_constraint("designers_name_key", "designers", type_="unique")
    op.create_unique_constraint("uq_designers_user_name", "designers", ["user_id", "name"])
    op.drop_constraint("uq_adjacent_pair", "adjacent_designers", type_="unique")
    op.create_unique_constraint(
        "uq_adjacent_pair", "adjacent_designers", ["user_id", "designer", "adjacent"]
    )
    op.drop_constraint("uq_hidden", "hidden", type_="unique")
    op.create_unique_constraint("uq_hidden", "hidden", ["user_id", "kind", "value"])
    op.drop_constraint("notifications_key_key", "notifications", type_="unique")
    op.create_unique_constraint("uq_notifications_user_key", "notifications", ["user_id", "key"])
    for t in ("taste_items", "hunts", "push_subscriptions", "designers", "hidden"):
        op.create_index(f"ix_{t}_user", t, ["user_id"])

    op.create_table(
        "user_state",
        sa.Column(
            "user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", sa.dialects.postgresql.JSONB, nullable=False, server_default="{}"),
    )
    if owner is not None:
        # the owner's feed visits and scoring state; app_state['scoring'] keeps only the global
        # "listings changed" flag
        conn.execute(
            sa.text(
                "INSERT INTO user_state (user_id, key, value) "
                "SELECT :o, key, value FROM app_state WHERE key IN ('visit', 'scoring')"
            ),
            {"o": owner},
        )
    conn.execute(sa.text("DELETE FROM app_state WHERE key IN ('visit', 'auth')"))
    # global part of the scoring state: when listings last changed (rescore everyone once)
    conn.execute(
        sa.text(
            "UPDATE app_state SET value = jsonb_build_object('changed_at', now()) "
            "WHERE key = 'scoring'"
        )
    )


def downgrade() -> None:
    """Back to one user: keeps the owner's rows only (friends' data can't fit the old keys)."""
    conn = op.get_bind()
    owner = conn.execute(sa.text("SELECT id FROM users WHERE role = 'owner'")).scalar()
    for t in TABLES:
        conn.execute(
            sa.text(f"DELETE FROM {t} WHERE user_id IS DISTINCT FROM :o"), {"o": owner or -1}
        )
    if owner is not None:
        conn.execute(
            sa.text(
                "INSERT INTO app_state (key, value) SELECT key, value FROM user_state "
                "WHERE user_id = :o AND key IN ('visit', 'scoring') "
                "ON CONFLICT (key) DO UPDATE SET value = excluded.value"
            ),
            {"o": owner},
        )
    op.drop_table("user_state")
    for t in ("taste_items", "hunts", "push_subscriptions", "designers", "hidden"):
        op.drop_index(f"ix_{t}_user", table_name=t)
    op.drop_constraint("uq_notifications_user_key", "notifications", type_="unique")
    op.create_unique_constraint("notifications_key_key", "notifications", ["key"])
    op.drop_constraint("uq_hidden", "hidden", type_="unique")
    op.create_unique_constraint("uq_hidden", "hidden", ["kind", "value"])
    op.drop_constraint("uq_adjacent_pair", "adjacent_designers", type_="unique")
    op.create_unique_constraint("uq_adjacent_pair", "adjacent_designers", ["designer", "adjacent"])
    op.drop_constraint("uq_designers_user_name", "designers", type_="unique")
    op.create_unique_constraint("designers_name_key", "designers", ["name"])
    op.drop_index("ix_listing_scores_user_score", table_name="listing_scores")
    op.create_index("ix_listing_scores_score", "listing_scores", ["score"])
    for t in ("listing_scores", "feedback", "saved", "seen"):
        op.drop_index(f"ix_{t}_listing", table_name=t)
        op.drop_constraint(f"{t}_pkey", t, type_="primary")
        op.create_primary_key(f"{t}_pkey", t, ["listing_id"])
    op.drop_constraint("uq_profile_user", "profile", type_="unique")
    for t in TABLES:
        op.drop_constraint(f"fk_{t}_user", t, type_="foreignkey")
        op.drop_column(t, "user_id")

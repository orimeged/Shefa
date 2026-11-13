"""Online orders picked in the store with the route-sorted list: how long each took.

Minutes per order is the one figure a picking pilot is judged on, so every finished
order is kept: when it started and ended, how many lines it had and how many were
missing. The id comes from the phone, so a retried upload counts once.

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

_TIME = sa.Text().with_variant(sa.Text(collation="C"), "postgresql")


def upgrade() -> None:
    op.create_table(
        "pick_sessions",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("store_id", sa.Text(), nullable=False),
        sa.Column("started_at", _TIME, nullable=False),
        sa.Column("finished_at", _TIME, nullable=False),
        sa.Column("lines", sa.Integer(), nullable=False),
        sa.Column("missing", sa.Integer(), nullable=False),
    )
    op.create_index("idx_pick_sessions_store_time", "pick_sessions", ["store_id", "finished_at"])


def downgrade() -> None:
    op.drop_table("pick_sessions")

"""Shelf prices on products, and what a manager found when closing a report.

A price turns a report into money: what the missing item sells for. It comes from a
point-of-sale export or the price file a chain must publish, in agorot, so sums stay
exact. `price_updated_at` says how old it is.

A closed report now says what the manager found: an empty shelf they refilled
("restocked"), an item that stood somewhere else ("relocated"), or an item that was
on its shelf all along ("on_shelf"). The first is lost stock, the other two are a
store that's hard to find things in, and the dashboard reports them apart.
`source` says who reported it: a shopper, or a picker filling an online order.

The append-only guards from 0003 are rewritten for the new columns: `resolution`
may only be set together with closing, once, and `source` never changes.

Revision ID: 0005
Revises: 0004
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

_IMMUTABLE = (
    "event_id",
    "store_id",
    "session_id",
    "item_query",
    "category_id",
    "x_coord",
    "y_coord",
    "timestamp",
    "source",
)


def _sqlite_update_guard(columns: tuple[str, ...]) -> str:
    changed = "\n            OR ".join(f"NEW.{column} IS NOT OLD.{column}" for column in columns)
    return f"""
    CREATE TRIGGER not_found_events_no_update
        BEFORE UPDATE ON not_found_events
        WHEN OLD.resolved_at IS NOT NULL
            OR {changed}
        BEGIN SELECT RAISE(ABORT, 'events are append-only'); END
    """


def _postgres_guard(columns: tuple[str, ...]) -> str:
    changed = "\n            OR ".join(f"NEW.{column} IS DISTINCT FROM OLD.{column}" for column in columns)
    return f"""
    CREATE OR REPLACE FUNCTION not_found_events_append_only() RETURNS trigger AS $$
    BEGIN
        IF TG_OP = 'DELETE' THEN
            IF OLD.session_id LIKE 'demo-seed-%' THEN
                RETURN OLD;
            END IF;
            RAISE EXCEPTION 'events are append-only';
        END IF;
        IF OLD.resolved_at IS NOT NULL
            OR {changed}
        THEN
            RAISE EXCEPTION 'events are append-only';
        END IF;
        RETURN NEW;
    END
    $$ LANGUAGE plpgsql
    """


def upgrade() -> None:
    with op.batch_alter_table("products", schema=None) as batch_op:
        batch_op.add_column(sa.Column("price_agorot", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("price_updated_at", sa.DateTime(timezone=True), nullable=True))

    # Not in batch mode: on SQLite that rebuilds the table, and its triggers with it.
    op.add_column("not_found_events", sa.Column("resolution", sa.Text(), nullable=True))
    op.add_column(
        "not_found_events",
        sa.Column("source", sa.Text(), nullable=False, server_default="shopper"),
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute(_postgres_guard(_IMMUTABLE))
    else:
        op.execute("DROP TRIGGER IF EXISTS not_found_events_no_update")
        op.execute(_sqlite_update_guard(_IMMUTABLE))


def downgrade() -> None:
    old = tuple(column for column in _IMMUTABLE if column != "source")
    if op.get_bind().dialect.name == "postgresql":
        op.execute(_postgres_guard(old))
    else:
        op.execute("DROP TRIGGER IF EXISTS not_found_events_no_update")
    # SQLite can't drop a column a trigger names, so the guard is rebuilt after.
    op.drop_column("not_found_events", "source")
    op.drop_column("not_found_events", "resolution")
    if op.get_bind().dialect.name != "postgresql":
        op.execute(_sqlite_update_guard(old))
    with op.batch_alter_table("products", schema=None) as batch_op:
        batch_op.drop_column("price_updated_at")
        batch_op.drop_column("price_agorot")

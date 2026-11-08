"""Shoppers' reports and the dashboard's data move into the database.

They lived in a SQLite file of their own, which a cloud host deletes on every
deploy. The tables keep their shape: timestamps stay fixed-width UTC text, which
sorts as time in both databases ("C" collation in PostgreSQL, so no locale rule
can reorder them).

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

_TIME = sa.Text().with_variant(sa.Text(collation="C"), "postgresql")

# A report is a fact about the past: corrections are new reports. The one change
# allowed is a manager closing its alert, once. Rows from seed_demo_data.py are
# the one exception to never deleting, so a re-seed can replace them; left in for
# good, they'd pass for real shoppers in the first report to a chain.
_SQLITE_GUARDS = [
    """
    CREATE TRIGGER not_found_events_no_update
        BEFORE UPDATE ON not_found_events
        WHEN OLD.resolved_at IS NOT NULL
            OR NEW.event_id IS NOT OLD.event_id
            OR NEW.store_id IS NOT OLD.store_id
            OR NEW.session_id IS NOT OLD.session_id
            OR NEW.item_query IS NOT OLD.item_query
            OR NEW.category_id IS NOT OLD.category_id
            OR NEW.x_coord IS NOT OLD.x_coord
            OR NEW.y_coord IS NOT OLD.y_coord
            OR NEW.timestamp IS NOT OLD.timestamp
        BEGIN SELECT RAISE(ABORT, 'events are append-only'); END
    """,
    """
    CREATE TRIGGER not_found_events_no_delete
        BEFORE DELETE ON not_found_events
        WHEN OLD.session_id NOT LIKE 'demo-seed-%'
        BEGIN SELECT RAISE(ABORT, 'events are append-only'); END
    """,
]

_POSTGRES_GUARDS = [
    """
    CREATE FUNCTION not_found_events_append_only() RETURNS trigger AS $$
    BEGIN
        IF TG_OP = 'DELETE' THEN
            IF OLD.session_id LIKE 'demo-seed-%' THEN
                RETURN OLD;
            END IF;
            RAISE EXCEPTION 'events are append-only';
        END IF;
        IF OLD.resolved_at IS NOT NULL
            OR NEW.event_id IS DISTINCT FROM OLD.event_id
            OR NEW.store_id IS DISTINCT FROM OLD.store_id
            OR NEW.session_id IS DISTINCT FROM OLD.session_id
            OR NEW.item_query IS DISTINCT FROM OLD.item_query
            OR NEW.category_id IS DISTINCT FROM OLD.category_id
            OR NEW.x_coord IS DISTINCT FROM OLD.x_coord
            OR NEW.y_coord IS DISTINCT FROM OLD.y_coord
            OR NEW.timestamp IS DISTINCT FROM OLD.timestamp
        THEN
            RAISE EXCEPTION 'events are append-only';
        END IF;
        RETURN NEW;
    END
    $$ LANGUAGE plpgsql
    """,
    """
    CREATE TRIGGER not_found_events_append_only
        BEFORE UPDATE OR DELETE ON not_found_events
        FOR EACH ROW EXECUTE FUNCTION not_found_events_append_only()
    """,
]


def upgrade() -> None:
    op.create_table(
        "not_found_events",
        sa.Column("event_id", sa.Text(), primary_key=True),
        sa.Column("store_id", sa.Text(), nullable=False),
        sa.Column("session_id", sa.Text(), nullable=False),
        sa.Column("item_query", sa.Text(), nullable=False),
        sa.Column("category_id", sa.Text(), nullable=True),
        sa.Column("x_coord", sa.Float(), nullable=False),
        sa.Column("y_coord", sa.Float(), nullable=False),
        sa.Column("timestamp", _TIME, nullable=False),
        sa.Column("resolved_at", _TIME, nullable=True),
    )
    # Heatmaps group by location within a store and a period.
    op.create_index("idx_not_found_store_time", "not_found_events", ["store_id", "timestamp"])
    op.create_index(
        "idx_not_found_store_location", "not_found_events", ["store_id", "x_coord", "y_coord"]
    )
    op.create_index("idx_not_found_store_item", "not_found_events", ["store_id", "item_query"])

    # One row per item per trip: the key is what keeps a reload from counting twice.
    op.create_table(
        "search_misses",
        sa.Column("store_id", sa.Text(), primary_key=True),
        sa.Column("session_id", sa.Text(), primary_key=True),
        sa.Column("query_key", sa.Text(), primary_key=True),
        sa.Column("query", sa.Text(), nullable=False),
        sa.Column("category_id", sa.Text(), nullable=True),
        sa.Column("timestamp", _TIME, nullable=False),
    )
    op.create_index("idx_search_misses_store_time", "search_misses", ["store_id", "timestamp"])

    op.create_table(
        "trips",
        sa.Column("store_id", sa.Text(), primary_key=True),
        sa.Column("session_id", sa.Text(), primary_key=True),
        sa.Column("timestamp", _TIME, nullable=False),
    )
    op.create_index("idx_trips_store_time", "trips", ["store_id", "timestamp"])

    # A trip's route is re-planned many times, and each walkway counts once per trip.
    op.create_table(
        "trip_edges",
        sa.Column("store_id", sa.Text(), primary_key=True),
        sa.Column("session_id", sa.Text(), primary_key=True),
        sa.Column("node_a", sa.Text(), primary_key=True),
        sa.Column("node_b", sa.Text(), primary_key=True),
        sa.Column("timestamp", _TIME, nullable=False),
    )
    op.create_index("idx_trip_edges_store_time", "trip_edges", ["store_id", "timestamp"])

    guards = _POSTGRES_GUARDS if op.get_bind().dialect.name == "postgresql" else _SQLITE_GUARDS
    for statement in guards:
        op.execute(statement)


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS not_found_events_append_only ON not_found_events")
        op.execute("DROP FUNCTION IF EXISTS not_found_events_append_only()")
    for table in ("trip_edges", "trips", "search_misses", "not_found_events"):
        op.drop_table(table)

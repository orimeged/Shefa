"""Shoppers' reports and the dashboard's data, declared for the schema.

The stores query them in plain SQL. These declarations are what Alembic compares
the migrations against, so `alembic revision --autogenerate` never offers to
drop them.
"""

from sqlalchemy import Column, Float, Index, Table, Text

from app.repositories.inventory_tables import Base

# Fixed-width UTC text sorts as time, with no locale rule in PostgreSQL to reorder it.
TIME = Text().with_variant(Text(collation="C"), "postgresql")

not_found_events = Table(
    "not_found_events",
    Base.metadata,
    Column("event_id", Text, primary_key=True),
    Column("store_id", Text, nullable=False),
    Column("session_id", Text, nullable=False),
    Column("item_query", Text, nullable=False),
    Column("category_id", Text, nullable=True),
    Column("x_coord", Float, nullable=False),
    Column("y_coord", Float, nullable=False),
    Column("timestamp", TIME, nullable=False),
    Column("resolved_at", TIME, nullable=True),
    Index("idx_not_found_store_time", "store_id", "timestamp"),
    Index("idx_not_found_store_location", "store_id", "x_coord", "y_coord"),
    Index("idx_not_found_store_item", "store_id", "item_query"),
)

search_misses = Table(
    "search_misses",
    Base.metadata,
    Column("store_id", Text, primary_key=True),
    Column("session_id", Text, primary_key=True),
    Column("query_key", Text, primary_key=True),
    Column("query", Text, nullable=False),
    Column("category_id", Text, nullable=True),
    Column("timestamp", TIME, nullable=False),
    Index("idx_search_misses_store_time", "store_id", "timestamp"),
)

trips = Table(
    "trips",
    Base.metadata,
    Column("store_id", Text, primary_key=True),
    Column("session_id", Text, primary_key=True),
    Column("timestamp", TIME, nullable=False),
    Index("idx_trips_store_time", "store_id", "timestamp"),
)

trip_edges = Table(
    "trip_edges",
    Base.metadata,
    Column("store_id", Text, primary_key=True),
    Column("session_id", Text, primary_key=True),
    Column("node_a", Text, primary_key=True),
    Column("node_b", Text, primary_key=True),
    Column("timestamp", TIME, nullable=False),
    Index("idx_trip_edges_store_time", "store_id", "timestamp"),
)

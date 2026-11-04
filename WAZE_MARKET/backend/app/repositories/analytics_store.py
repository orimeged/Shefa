"""Shoppers' searches and trips for the dashboard, in the app's database beside their reports."""

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import Connection, Engine, text

from app.domain.analytics import (
    CategoryTally,
    CountPair,
    DashboardCounts,
    HeatPoint,
    MissTally,
    RouteTrip,
    SearchMiss,
    edge_key,
)
from app.domain.events import ALERT_THRESHOLD
from app.repositories.event_store import DEMO_SESSION_PREFIX, TIMESTAMP_FORMAT

_WEEK = timedelta(days=7)
# Half a metre: closer than a phone can place someone, so reports there are one spot.
_HEAT_CELLS_PER_METRE = 2

# A key per row is what keeps a page reloaded in the aisle, or an item both
# searched for and added, from counting twice.
_INSERT_MISS = text(
    """
    INSERT INTO search_misses (store_id, session_id, query_key, query, category_id, timestamp)
    VALUES (:store_id, :session_id, :query_key, :query, :category_id, :timestamp)
    ON CONFLICT DO NOTHING
    """
)
_INSERT_TRIP = text(
    """
    INSERT INTO trips (store_id, session_id, timestamp)
    VALUES (:store_id, :session_id, :timestamp)
    ON CONFLICT DO NOTHING
    """
)
_INSERT_EDGE = text(
    """
    INSERT INTO trip_edges (store_id, session_id, node_a, node_b, timestamp)
    VALUES (:store_id, :session_id, :node_a, :node_b, :timestamp)
    ON CONFLICT DO NOTHING
    """
)
_TABLES = ("search_misses", "trips", "trip_edges")


def _text(moment: datetime) -> str:
    """Always UTC: the format says so, and only the same zone sorts as time."""
    return moment.astimezone(UTC).strftime(TIMESTAMP_FORMAT)


def _miss_row(miss: SearchMiss) -> dict[str, Any]:
    return {
        "store_id": miss.store_id,
        "session_id": miss.session_id,
        "query_key": miss.query_key,
        "query": miss.query,
        "category_id": miss.category_id,
        "timestamp": _text(miss.timestamp),
    }


def _trip_row(trip: RouteTrip) -> dict[str, Any]:
    return {"store_id": trip.store_id, "session_id": trip.session_id, "timestamp": _text(trip.timestamp)}


def _edge_rows(trip: RouteTrip) -> list[dict[str, Any]]:
    rows = []
    for edge in trip.edges:
        node_a, node_b = edge_key(*edge)
        rows.append({**_trip_row(trip), "node_a": node_a, "node_b": node_b})
    return rows


class SqlAnalyticsStore:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def record_misses(self, misses: Sequence[SearchMiss]) -> None:
        if misses:
            with self._engine.begin() as connection:
                connection.execute(_INSERT_MISS, [_miss_row(miss) for miss in misses])

    def record_trip(self, trip: RouteTrip) -> None:
        with self._engine.begin() as connection:
            connection.execute(_INSERT_TRIP, _trip_row(trip))
            edges = _edge_rows(trip)
            if edges:
                connection.execute(_INSERT_EDGE, edges)

    def replace_demo_data(
        self, misses: Sequence[SearchMiss], trips: Sequence[RouteTrip]
    ) -> None:
        """Swaps the last demo seed's rows, in one transaction. Real shoppers' rows aren't touched."""
        tagged = (*misses, *trips)
        if not all(row.session_id.startswith(DEMO_SESSION_PREFIX) for row in tagged):
            raise ValueError(f"demo rows need a session id starting {DEMO_SESSION_PREFIX}")
        edges = [row for trip in trips for row in _edge_rows(trip)]
        with self._engine.begin() as connection:
            for table in _TABLES:
                connection.execute(
                    text(f"DELETE FROM {table} WHERE session_id LIKE :demo"),
                    {"demo": f"{DEMO_SESSION_PREFIX}%"},
                )
            for statement, rows in (
                (_INSERT_MISS, [_miss_row(miss) for miss in misses]),
                (_INSERT_TRIP, [_trip_row(trip) for trip in trips]),
                (_INSERT_EDGE, edges),
            ):
                if rows:
                    connection.execute(statement, rows)

    def dashboard_counts(
        self, store_id: str, now: datetime, day_start: datetime
    ) -> DashboardCounts:
        """Today so far against the same hours a week ago, and the last 7 days against the 7 before.

        A day under way compared to a whole one would always look like a slump.
        """
        with self._engine.connect() as connection:
            return DashboardCounts(
                routes_today=CountPair(
                    current=self._count(connection, "trips", store_id, day_start, now),
                    previous=self._count(
                        connection, "trips", store_id, day_start - _WEEK, now - _WEEK
                    ),
                ),
                missing_alerts=CountPair(
                    current=self._alerts_as_of(connection, store_id, now),
                    previous=self._alerts_as_of(connection, store_id, now - _WEEK),
                ),
                unfulfilled_searches=CountPair(
                    current=self._count(connection, "search_misses", store_id, now - _WEEK, now),
                    previous=self._count(
                        connection, "search_misses", store_id, now - 2 * _WEEK, now - _WEEK
                    ),
                ),
            )

    @staticmethod
    def _count(
        connection: Connection, table: str, store_id: str, since: datetime, until: datetime
    ) -> int:
        return connection.execute(
            text(
                f"SELECT COUNT(*) FROM {table} "
                "WHERE store_id = :store AND timestamp >= :since AND timestamp < :until"
            ),
            {"store": store_id, "since": _text(since), "until": _text(until)},
        ).scalar_one()

    @staticmethod
    def _alerts_as_of(connection: Connection, store_id: str, moment: datetime) -> int:
        """How many items stood at the alert threshold at `moment`, with their alert open."""
        return connection.execute(
            text(
                """
                SELECT COUNT(*) FROM (
                    SELECT 1 FROM not_found_events
                    WHERE store_id = :store
                        AND timestamp >= :since
                        AND timestamp < :until
                        AND (resolved_at IS NULL OR resolved_at >= :until)
                    GROUP BY category_id, item_query
                    HAVING COUNT(*) >= :threshold
                ) AS open_alerts
                """
            ),
            {
                "store": store_id,
                "since": _text(moment - _WEEK),
                "until": _text(moment),
                "threshold": ALERT_THRESHOLD,
            },
        ).scalar_one()

    def top_misses(self, store_id: str, since: datetime, limit: int) -> list[MissTally]:
        """Each word's spelling and department as they were last searched for."""
        with self._engine.connect() as connection:
            rows = connection.execute(
                text(
                    """
                    SELECT query, category_id, times FROM (
                        SELECT query, category_id, query_key,
                            COUNT(*) OVER (PARTITION BY query_key) AS times,
                            MAX(timestamp) OVER (PARTITION BY query_key) AS latest,
                            ROW_NUMBER() OVER (
                                PARTITION BY query_key ORDER BY timestamp DESC, session_id
                            ) AS recency
                        FROM search_misses
                        WHERE store_id = :store AND timestamp >= :since
                    ) AS ranked
                    WHERE recency = 1
                    ORDER BY times DESC, latest DESC, query_key
                    LIMIT :limit
                    """
                ),
                {"store": store_id, "since": _text(since), "limit": limit},
            ).all()
        return [MissTally(query=query, category_id=category_id, times=times) for query, category_id, times in rows]

    def misses_by_category(self, store_id: str, since: datetime) -> list[CategoryTally]:
        with self._engine.connect() as connection:
            rows = connection.execute(
                text(
                    """
                    SELECT category_id, COUNT(*)
                    FROM search_misses
                    WHERE store_id = :store AND timestamp >= :since
                    GROUP BY category_id
                    ORDER BY COUNT(*) DESC, category_id
                    """
                ),
                {"store": store_id, "since": _text(since)},
            ).all()
        return [CategoryTally(category_id=category_id, times=times) for category_id, times in rows]

    def heat_points(self, store_id: str, since: datetime) -> list[HeatPoint]:
        """Open reports only: heat on a shelf that was restocked would send a manager to a full shelf."""
        with self._engine.connect() as connection:
            rows = connection.execute(
                text(
                    """
                    SELECT x, y, COUNT(*) AS reports FROM (
                        SELECT ROUND(x_coord * :cells) / :cells AS x,
                               ROUND(y_coord * :cells) / :cells AS y
                        FROM not_found_events
                        WHERE store_id = :store AND timestamp >= :since AND resolved_at IS NULL
                    ) AS cells
                    GROUP BY x, y
                    ORDER BY reports DESC, x, y
                    """
                ),
                # A float, so neither database divides as integers.
                {"cells": float(_HEAT_CELLS_PER_METRE), "store": store_id, "since": _text(since)},
            ).all()
        return [HeatPoint(x=x, y=y, count=count) for x, y, count in rows]

    def edge_traffic(self, store_id: str, since: datetime) -> dict[tuple[str, str], int]:
        with self._engine.connect() as connection:
            rows = connection.execute(
                text(
                    """
                    SELECT node_a, node_b, COUNT(*)
                    FROM trip_edges
                    WHERE store_id = :store AND timestamp >= :since
                    GROUP BY node_a, node_b
                    """
                ),
                {"store": store_id, "since": _text(since)},
            ).all()
        return {(node_a, node_b): trips for node_a, node_b, trips in rows}

    def trip_count(self, store_id: str, since: datetime, until: datetime) -> int:
        with self._engine.connect() as connection:
            return self._count(connection, "trips", store_id, since, until)

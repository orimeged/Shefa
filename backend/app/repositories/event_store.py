"""Shoppers' "not found" reports, in the app's database.

What a shopper reported never changes. The one thing that can still happen to a
report is a manager closing its alert, once, by setting `resolved_at`. Triggers
from migration 0003 hold that line for anything that writes to the table.
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Engine, text

from app.domain.events import RESTOCKED, NotFoundEvent, NotFoundTally, ReportRecord, Resolution

# Marks a made-up report from seed_demo_data.py, so it can't pass for a real one.
DEMO_SESSION_PREFIX = "demo-seed-"

# Fixed width and always UTC, so text order is time order in either database.
TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"

_INSERT = text(
    """
    INSERT INTO not_found_events (
        event_id, store_id, session_id, item_query,
        category_id, x_coord, y_coord, timestamp, source,
        resolved_at, resolution
    ) VALUES (
        :event_id, :store_id, :session_id, :item_query,
        :category_id, :x_coord, :y_coord, :timestamp, :source,
        :resolved_at, :resolution
    )
    ON CONFLICT (event_id) DO NOTHING
    """
)


def _time(text_value: str | None) -> datetime | None:
    return datetime.fromisoformat(text_value) if text_value else None


def _row(event: NotFoundEvent) -> dict[str, Any]:
    return {
        "event_id": str(event.event_id),
        "store_id": event.store_id,
        "session_id": event.session_id,
        "item_query": event.item_query,
        "category_id": event.category_id,
        "x_coord": event.x_coord,
        "y_coord": event.y_coord,
        "timestamp": event.timestamp.strftime(TIMESTAMP_FORMAT),
        "source": event.source,
        "resolved_at": None,
        "resolution": None,
    }


class SqlEventStore:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def append(self, event: NotFoundEvent) -> bool:
        with self._engine.begin() as connection:
            return connection.execute(_INSERT, _row(event)).rowcount == 1

    def tally_not_found(self, store_id: str, since: datetime) -> list[NotFoundTally]:
        with self._engine.connect() as connection:
            rows = connection.execute(
                text(
                    """
                    SELECT category_id, item_query, COUNT(*), MAX(timestamp)
                    FROM not_found_events
                    WHERE store_id = :store AND timestamp >= :since AND resolved_at IS NULL
                    GROUP BY category_id, item_query
                    ORDER BY COUNT(*) DESC, MAX(timestamp) DESC, item_query
                    """
                ),
                {"store": store_id, "since": since.strftime(TIMESTAMP_FORMAT)},
            ).all()
        return [
            NotFoundTally(
                category_id=category_id,
                item_query=item_query,
                times_reported=times_reported,
                last_reported_at=datetime.fromisoformat(last_reported_at),
            )
            for category_id, item_query, times_reported, last_reported_at in rows
        ]

    def resolve_not_found(
        self,
        store_id: str,
        item_query: str,
        category_id: str | None,
        at: datetime,
        resolution: Resolution = RESTOCKED,
    ) -> int:
        with self._engine.begin() as connection:
            return connection.execute(
                text(
                    """
                    UPDATE not_found_events
                    SET resolved_at = :at, resolution = :resolution
                    WHERE store_id = :store
                        AND item_query = :item
                        AND category_id IS NOT DISTINCT FROM :category
                        AND resolved_at IS NULL
                    """
                ),
                {
                    "at": at.strftime(TIMESTAMP_FORMAT),
                    "resolution": resolution,
                    "store": store_id,
                    "item": item_query,
                    "category": category_id,
                },
            ).rowcount

    def open_reports(self, store_id: str, item_query: str, category_id: str | None, since: datetime) -> int:
        """An item's reports still open since `since`: what its alert stands at."""
        with self._engine.connect() as connection:
            return connection.execute(
                text(
                    """
                    SELECT COUNT(*) FROM not_found_events
                    WHERE store_id = :store
                        AND item_query = :item
                        AND category_id IS NOT DISTINCT FROM :category
                        AND timestamp >= :since
                        AND resolved_at IS NULL
                    """
                ),
                {"store": store_id, "item": item_query, "category": category_id, "since": since.strftime(TIMESTAMP_FORMAT)},
            ).scalar_one()

    def report_records(self, store_id: str, since: datetime) -> list[ReportRecord]:
        with self._engine.connect() as connection:
            rows = connection.execute(
                text(
                    """
                    SELECT item_query, category_id, timestamp, resolved_at, resolution, source
                    FROM not_found_events
                    WHERE store_id = :store AND timestamp >= :since
                    ORDER BY timestamp, event_id
                    """
                ),
                {"store": store_id, "since": since.strftime(TIMESTAMP_FORMAT)},
            ).all()
        return [
            ReportRecord(
                item_query=item_query,
                category_id=category_id,
                timestamp=datetime.fromisoformat(timestamp),
                resolved_at=_time(resolved_at),
                resolution=resolution,
                source=source,
            )
            for item_query, category_id, timestamp, resolved_at, resolution, source in rows
        ]

    def replace_demo_events(
        self,
        events: Sequence[NotFoundEvent],
        closed: Sequence[tuple[NotFoundEvent, datetime, Resolution]] = (),
    ) -> None:
        """Swaps the last demo seed's rows for `events`, in one transaction. Real reports aren't touched.

        `closed` are demo reports a manager already dealt with: when, and what they found.
        """
        every = [*events, *(event for event, _, _ in closed)]
        if not all(event.session_id.startswith(DEMO_SESSION_PREFIX) for event in every):
            raise ValueError(f"demo events need a session id starting {DEMO_SESSION_PREFIX}")
        rows = [_row(event) for event in events] + [
            {**_row(event), "resolved_at": at.astimezone(UTC).strftime(TIMESTAMP_FORMAT), "resolution": resolution}
            for event, at, resolution in closed
        ]
        with self._engine.begin() as connection:
            connection.execute(
                text("DELETE FROM not_found_events WHERE session_id LIKE :demo"),
                {"demo": f"{DEMO_SESSION_PREFIX}%"},
            )
            if rows:
                connection.execute(_INSERT, rows)

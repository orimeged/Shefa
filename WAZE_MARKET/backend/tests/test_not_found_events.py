import sqlite3
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.domain.events import NotFoundEvent, NotFoundReport
from app.repositories.event_store import SqlEventStore
from app.repositories.legacy_events import import_legacy_events
from tests.conftest import database_file, migrated_engine

URL = "/api/events/not-found"
NOW_FOR_RESOLVE = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)


def report(**overrides: object) -> dict[str, object]:
    return {
        "store_id": "demo",
        "session_id": "session-1",
        "item_query": "קטשופ",
        "category_id": "sauces",
        "x_coord": 11.0,
        "y_coord": 8.0,
        **overrides,
    }


def store_at(path: Path) -> SqlEventStore:
    return SqlEventStore(migrated_engine(path))


def rows(settings: Settings) -> list[sqlite3.Row]:
    connection = sqlite3.connect(database_file(settings))
    connection.row_factory = sqlite3.Row
    try:
        return connection.execute("SELECT * FROM not_found_events").fetchall()
    finally:
        connection.close()


def test_stores_an_event(client: TestClient, settings: Settings) -> None:
    response = client.post(URL, json=report())

    assert response.status_code == 201
    assert response.json()["stored"] is True

    row = rows(settings)[0]
    assert row["session_id"] == "session-1"
    assert row["item_query"] == "קטשופ"
    assert (row["x_coord"], row["y_coord"]) == (11.0, 8.0)
    assert UUID(row["event_id"]).version == 4


def test_the_timestamp_is_utc_and_sorts_as_text(client: TestClient, settings: Settings) -> None:
    client.post(URL, json=report(timestamp="2026-01-15T12:30:00+02:00"))

    assert rows(settings)[0]["timestamp"] == "2026-01-15T10:30:00.000000Z"


def test_a_missing_timestamp_is_the_arrival_time(client: TestClient, settings: Settings) -> None:
    before = datetime.now(UTC)

    client.post(URL, json=report())

    stored = datetime.strptime(rows(settings)[0]["timestamp"], "%Y-%m-%dT%H:%M:%S.%fZ")
    assert abs(stored.replace(tzinfo=UTC) - before) < timedelta(seconds=5)


def test_a_retry_counts_once(client: TestClient, settings: Settings) -> None:
    event_id = str(uuid4())

    first = client.post(URL, json=report(event_id=event_id))
    second = client.post(URL, json=report(event_id=event_id))

    assert (first.status_code, second.status_code) == (201, 200)
    assert second.json()["stored"] is False
    assert len(rows(settings)) == 1


def test_a_naive_timestamp_is_refused(client: TestClient) -> None:
    assert client.post(URL, json=report(timestamp="2026-11-01T12:30:00")).status_code == 422


def test_a_broken_phone_clock_cant_write_the_future() -> None:
    now = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
    future = NotFoundReport.model_validate(report(timestamp="2030-01-01T00:00:00Z"))

    assert NotFoundEvent.from_report(future, now).timestamp == now


def test_a_late_report_keeps_when_it_happened() -> None:
    now = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
    earlier = now - timedelta(minutes=40)
    queued = NotFoundReport.model_validate(report(timestamp=earlier.isoformat()))

    assert NotFoundEvent.from_report(queued, now).timestamp == earlier


def test_another_zone_is_converted() -> None:
    israel = timezone(timedelta(hours=3))
    happened = datetime(2026, 7, 1, 15, 0, tzinfo=israel)
    queued = NotFoundReport.model_validate(report(timestamp=happened.isoformat()))

    event = NotFoundEvent.from_report(queued, datetime(2026, 7, 1, 13, 0, tzinfo=UTC))

    assert event.timestamp == datetime(2026, 7, 1, 12, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    "bad",
    [
        {"item_query": ""},
        {"item_query": "   "},
        {"item_query": "x" * 201},
        {"session_id": ""},
        {"event_id": "not-a-uuid"},
        {"extra_field": 1},
    ],
)
def test_bad_reports_are_refused(client: TestClient, bad: dict[str, object]) -> None:
    assert client.post(URL, json=report(**bad)).status_code == 422


def test_infinite_coordinates_are_refused() -> None:
    with pytest.raises(ValueError):
        NotFoundReport.model_validate(report(x_coord=float("inf")))


@pytest.mark.parametrize("coords", [{"x_coord": -1.0}, {"x_coord": 33.0}, {"y_coord": 27.0}])
def test_a_location_off_the_map_is_refused(client: TestClient, coords: dict[str, float]) -> None:
    assert client.post(URL, json=report(**coords)).status_code == 422


def test_an_unknown_store_is_404(client: TestClient) -> None:
    assert client.post(URL, json=report(store_id="nope")).status_code == 404


def test_rows_cant_be_changed_or_deleted(client: TestClient, settings: Settings) -> None:
    client.post(URL, json=report())

    connection = sqlite3.connect(database_file(settings))
    try:
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute("UPDATE not_found_events SET item_query = 'x'")
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute("DELETE FROM not_found_events")
    finally:
        connection.close()


def test_the_table_answers_a_heatmap_query(client: TestClient, settings: Settings) -> None:
    for x, y in [(11.2, 8.3), (11.4, 8.1), (11.1, 8.9), (26.0, 13.0)]:
        client.post(URL, json=report(x_coord=x, y_coord=y))

    connection = sqlite3.connect(database_file(settings))
    try:
        cells = connection.execute(
            """
            SELECT CAST(x_coord AS INTEGER) AS cell_x,
                   CAST(y_coord AS INTEGER) AS cell_y,
                   COUNT(*) AS reports
            FROM not_found_events
            WHERE store_id = ? AND timestamp >= ?
            GROUP BY cell_x, cell_y
            ORDER BY reports DESC
            """,
            ("demo", "2026-01-01T00:00:00.000000Z"),
        ).fetchall()
    finally:
        connection.close()

    assert cells[0] == (11, 8, 3)
    assert cells[1] == (26, 13, 1)


def test_the_heatmap_query_uses_an_index(tmp_path: Path) -> None:
    store = store_at(tmp_path / "events.sqlite3")
    assert store is not None

    connection = sqlite3.connect(tmp_path / "events.sqlite3")
    try:
        plan = connection.execute(
            """
            EXPLAIN QUERY PLAN
            SELECT x_coord, y_coord FROM not_found_events
            WHERE store_id = ? AND timestamp >= ?
            """,
            ("demo", "2026-01-01"),
        ).fetchall()
    finally:
        connection.close()

    assert "USING" in str(plan) and "INDEX" in str(plan)


def test_reopening_keeps_the_data(tmp_path: Path) -> None:
    path = tmp_path / "events.sqlite3"
    event = NotFoundEvent.from_report(NotFoundReport.model_validate(report()))

    assert store_at(path).append(event) is True
    assert store_at(path).append(event) is False


def old_events_file(path: Path, *, with_resolved_at: bool = True) -> None:
    """Reports in their own file, as they were kept before moving into the database."""
    resolved = "resolved_at TEXT," if with_resolved_at else ""
    connection = sqlite3.connect(path)
    connection.executescript(
        f"""
        CREATE TABLE not_found_events (
            event_id    TEXT PRIMARY KEY,
            store_id    TEXT NOT NULL,
            session_id  TEXT NOT NULL,
            item_query  TEXT NOT NULL,
            category_id TEXT,
            x_coord     REAL NOT NULL,
            y_coord     REAL NOT NULL,
            {resolved}
            timestamp   TEXT NOT NULL
        );
        CREATE TABLE trips (store_id TEXT, session_id TEXT, timestamp TEXT);
        INSERT INTO not_found_events (
            event_id, store_id, session_id, item_query, category_id, x_coord, y_coord, timestamp
        ) VALUES ('id-1', 'demo', 's', 'חלב', 'dairy', 1.0, 2.0, '2026-11-01T10:00:00.000000Z');
        INSERT INTO trips VALUES ('demo', 's', '2026-11-01T10:00:00.000000Z');
        """
    )
    connection.commit()
    connection.close()


def only_row(path: Path) -> sqlite3.Row:
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    try:
        return connection.execute("SELECT * FROM not_found_events").fetchone()
    finally:
        connection.close()


def try_sql(path: Path, sql: str) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.execute(sql)
    finally:
        connection.close()


def test_an_old_events_file_is_copied_in(tmp_path: Path) -> None:
    old = tmp_path / "events.sqlite3"
    old_events_file(old, with_resolved_at=False)
    path = tmp_path / "app.sqlite3"
    engine = migrated_engine(path)

    assert import_legacy_events(engine, old) == 2

    row = only_row(path)
    assert row["item_query"] == "חלב"
    assert row["resolved_at"] is None


def test_a_copied_report_can_still_close_its_alert(tmp_path: Path) -> None:
    old = tmp_path / "events.sqlite3"
    old_events_file(old)
    engine = migrated_engine(tmp_path / "app.sqlite3")
    import_legacy_events(engine, old)

    assert SqlEventStore(engine).resolve_not_found("demo", "חלב", "dairy", datetime.now(UTC)) == 1


def test_the_copy_happens_once(tmp_path: Path) -> None:
    old = tmp_path / "events.sqlite3"
    old_events_file(old)
    engine = migrated_engine(tmp_path / "app.sqlite3")

    assert import_legacy_events(engine, old) == 2
    assert import_legacy_events(engine, old) == 0


def test_a_database_with_reports_of_its_own_isnt_touched(tmp_path: Path) -> None:
    old = tmp_path / "events.sqlite3"
    old_events_file(old)
    engine = migrated_engine(tmp_path / "app.sqlite3")
    SqlEventStore(engine).append(NotFoundEvent.from_report(NotFoundReport.model_validate(report())))

    assert import_legacy_events(engine, old) == 0


def test_no_old_file_is_nothing_to_do(tmp_path: Path) -> None:
    engine = migrated_engine(tmp_path / "app.sqlite3")

    assert import_legacy_events(engine, tmp_path / "missing.sqlite3") == 0


def test_demo_rows_are_the_one_thing_that_can_be_deleted(tmp_path: Path) -> None:
    path = tmp_path / "app.sqlite3"
    store = store_at(path)
    demo = report(session_id="demo-seed-1")
    store.append(NotFoundEvent.from_report(NotFoundReport.model_validate(demo)))

    connection = sqlite3.connect(path)
    with connection:
        connection.execute("DELETE FROM not_found_events WHERE session_id = 'demo-seed-1'")
    connection.close()

    assert only_row(path) is None


@pytest.mark.parametrize("copied", [False, True])
@pytest.mark.parametrize(
    "column", ["event_id", "store_id", "session_id", "item_query", "category_id", "timestamp"]
)
def test_what_a_shopper_reported_can_never_change(
    tmp_path: Path, column: str, copied: bool
) -> None:
    path = tmp_path / "events.sqlite3"
    store = store_at(path)
    if copied:
        old = tmp_path / "old-events.sqlite3"
        old_events_file(old)
        import_legacy_events(migrated_engine(path), old)
    else:
        store.append(NotFoundEvent.from_report(NotFoundReport.model_validate(report())))

    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        try_sql(path, f"UPDATE not_found_events SET {column} = 'changed'")


@pytest.mark.parametrize("column", ["x_coord", "y_coord"])
def test_a_reported_position_can_never_change(tmp_path: Path, column: str) -> None:
    path = tmp_path / "events.sqlite3"
    store = store_at(path)
    store.append(NotFoundEvent.from_report(NotFoundReport.model_validate(report())))

    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        try_sql(path, f"UPDATE not_found_events SET {column} = 0")


def test_a_closed_alert_stays_closed(tmp_path: Path) -> None:
    path = tmp_path / "events.sqlite3"
    store = store_at(path)
    store.append(NotFoundEvent.from_report(NotFoundReport.model_validate(report())))
    store.resolve_not_found("demo", "קטשופ", "sauces", datetime.now(UTC))

    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        try_sql(path, "UPDATE not_found_events SET resolved_at = NULL")


def test_a_resolved_report_is_kept_for_the_record(tmp_path: Path) -> None:
    path = tmp_path / "events.sqlite3"
    store = store_at(path)
    store.append(NotFoundEvent.from_report(NotFoundReport.model_validate(report())))

    store.resolve_not_found("demo", "קטשופ", "sauces", NOW_FOR_RESOLVE)

    row = only_row(path)
    assert row["item_query"] == "קטשופ"
    assert row["resolved_at"] == "2026-11-01T12:00:00.000000Z"

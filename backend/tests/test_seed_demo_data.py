import random
import sqlite3
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import seed_demo_data
from app.config import Settings
from app.domain.events import NotFoundEvent
from app.domain.models import Store
from app.repositories.event_store import DEMO_SESSION_PREFIX, SqlEventStore
from app.repositories.database import create_database_engine
from app.services.pos_import import read_pos_export
from tests.conftest import ADMIN_TOKEN, database_file, migrated_engine

NOW = datetime(2026, 11, 1, 12, 40, tzinfo=UTC)
PROBLEM_CATEGORIES = {"bakery", "dairy", "produce"}
ALERT_THRESHOLD = 3


@pytest.fixture()
def events(store: Store) -> list[NotFoundEvent]:
    return seed_demo_data.build_events(store, NOW, random.Random(7))


def real_event(store_id: str = "demo") -> NotFoundEvent:
    return NotFoundEvent(
        event_id=uuid4(),
        store_id=store_id,
        session_id="a-real-shopper",
        item_query="קטשופ",
        category_id="sauces",
        x_coord=1.0,
        y_coord=1.0,
        timestamp=NOW,
    )


def rows(path: Path) -> list[tuple[str, str]]:
    connection = sqlite3.connect(path)
    try:
        return connection.execute("SELECT session_id, item_query FROM not_found_events").fetchall()
    finally:
        connection.close()


def test_writes_between_40_and_50_reports(events: list[NotFoundEvent]) -> None:
    assert 40 <= len(events) <= 50


def test_70_percent_land_on_three_categories(events: list[NotFoundEvent]) -> None:
    on_problem = sum(event.category_id in PROBLEM_CATEGORIES for event in events)

    assert on_problem / len(events) == pytest.approx(0.7, abs=0.02)


def test_every_alert_is_in_the_problem_area(events: list[NotFoundEvent]) -> None:
    counts = Counter((event.category_id, event.item_query) for event in events)
    alerts = {category for (category, _), count in counts.items() if count >= ALERT_THRESHOLD}

    assert alerts == PROBLEM_CATEGORIES


def test_reports_span_the_last_three_days(events: list[NotFoundEvent]) -> None:
    ages = [NOW - event.timestamp for event in events]

    assert min(ages) >= timedelta(0)
    assert max(ages) <= timedelta(days=3)
    assert {age.days for age in ages} == {0, 1, 2}


def test_reports_fall_in_opening_hours(events: list[NotFoundEvent]) -> None:
    hours = {event.timestamp.astimezone().hour for event in events}

    assert min(hours) >= seed_demo_data.OPENING_HOUR
    assert max(hours) < seed_demo_data.CLOSING_HOUR


def test_reports_sit_beside_the_items_real_shelf(
    events: list[NotFoundEvent], store: Store
) -> None:
    nodes = {node.id: node for node in store.nodes}
    sections = {section.id: section for section in store.sections}
    zones = {row.display_name: row.zone for row in read_pos_export(seed_demo_data.POS_EXPORT)}
    spread_x, spread_y = seed_demo_data.AISLE_SPREAD_M

    for event in events:
        node = nodes[sections[zones[event.item_query]].node_id]
        assert abs(event.x_coord - node.x) <= spread_x
        assert abs(event.y_coord - node.y) <= spread_y


def test_reports_stay_inside_the_store(events: list[NotFoundEvent], store: Store) -> None:
    for event in events:
        assert 0 <= event.x_coord <= store.width_m
        assert 0 <= event.y_coord <= store.height_m


def test_every_report_is_marked_as_made_up(events: list[NotFoundEvent]) -> None:
    assert all(event.session_id.startswith(DEMO_SESSION_PREFIX) for event in events)
    assert all(event.store_id == "demo" for event in events)


def test_a_second_run_replaces_the_first(
    events: list[NotFoundEvent], store: Store, tmp_path: Path
) -> None:
    path = tmp_path / "events.sqlite3"
    event_store = SqlEventStore(migrated_engine(path))

    event_store.replace_demo_events(events)
    event_store.replace_demo_events(seed_demo_data.build_events(store, NOW, random.Random(8)))

    assert len(rows(path)) == len(events)


def test_real_reports_survive_a_seed_and_a_clear(
    events: list[NotFoundEvent], tmp_path: Path
) -> None:
    path = tmp_path / "events.sqlite3"
    event_store = SqlEventStore(migrated_engine(path))
    event_store.append(real_event())

    event_store.replace_demo_events(events)
    event_store.replace_demo_events([])

    assert rows(path) == [("a-real-shopper", "קטשופ")]


def test_nothing_else_can_be_deleted_afterwards(
    events: list[NotFoundEvent], tmp_path: Path
) -> None:
    path = tmp_path / "events.sqlite3"
    event_store = SqlEventStore(migrated_engine(path))
    event_store.append(real_event())
    event_store.replace_demo_events(events)

    # Demo rows can go, by design. A real shopper's report never can.
    connection = sqlite3.connect(path)
    try:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute("DELETE FROM not_found_events")
    finally:
        connection.close()


def test_a_failed_seed_leaves_the_last_one_in_place(
    events: list[NotFoundEvent], tmp_path: Path
) -> None:
    path = tmp_path / "events.sqlite3"
    event_store = SqlEventStore(migrated_engine(path))
    event_store.replace_demo_events(events)

    with pytest.raises(ValueError, match=DEMO_SESSION_PREFIX):
        event_store.replace_demo_events([real_event()])

    assert len(rows(path)) == len(events)


def test_the_script_seeds_a_database_that_doesnt_exist_yet(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "fresh" / "events.sqlite3"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{path.as_posix()}")

    assert seed_demo_data.main([]) == 0

    closed = (*seed_demo_data.CLOSED_THIS_WEEK, *seed_demo_data.PREVIOUS_WEEK_REPORTS)
    expected = 50 + sum(spec[2] for spec in closed)
    assert len(rows(path)) == expected
    assert ", 50 reports," in capsys.readouterr().out


def test_the_script_clears_what_it_wrote(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "events.sqlite3"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{path.as_posix()}")

    seed_demo_data.main([])
    assert seed_demo_data.main(["--clear"]) == 0

    assert rows(path) == []


def test_the_seed_gives_the_report_a_clear_problem_area(
    client: TestClient, events: list[NotFoundEvent], settings: Settings
) -> None:
    recent = [
        event.model_copy(update={"timestamp": event.timestamp + (datetime.now(UTC) - NOW)})
        for event in events
    ]
    SqlEventStore(migrated_engine(database_file(settings))).replace_demo_events(recent)

    report = client.get(
        "/api/v1/admin/reports/not-found",
        params={"store_id": "demo"},
        headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},
    ).json()

    assert sum(row["times_reported"] for row in report) == len(events)
    top = [row for row in report if row["times_reported"] >= ALERT_THRESHOLD]
    assert {row["category_id"] for row in top} == PROBLEM_CATEGORIES
    assert report[:len(top)] == top
    assert all(row["category_name"] for row in report)


def test_a_new_seed_brings_resolved_demo_alerts_back(
    events: list[NotFoundEvent], tmp_path: Path
) -> None:
    path = tmp_path / "events.sqlite3"
    event_store = SqlEventStore(migrated_engine(path))
    event_store.replace_demo_events(events)
    item = "לחם אחיד פרוס אנג'ל 750 גרם"
    event_store.resolve_not_found("demo", item, "bakery", NOW)

    event_store.replace_demo_events(events)

    open_reports = event_store.tally_not_found("demo", NOW - timedelta(days=7))
    assert item in {row.item_query for row in open_reports}


def analytics_rows(path: Path, table: str) -> int:
    connection = sqlite3.connect(path)
    try:
        return connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    finally:
        connection.close()


def test_closed_demo_alerts_were_closed_after_their_reports(store: Store) -> None:
    closed = seed_demo_data.build_closed_events(store, NOW, random.Random(7))

    assert len(closed) == sum(
        spec[2] for spec in (*seed_demo_data.CLOSED_THIS_WEEK, *seed_demo_data.PREVIOUS_WEEK_REPORTS)
    )
    assert all(event.timestamp <= resolved_at < NOW for event, resolved_at, _ in closed)
    assert {resolution for _, _, resolution in closed} == {"restocked", "relocated", "on_shelf"}


def test_previous_week_reports_stay_out_of_the_alerts_table(store: Store) -> None:
    previous = {spec[1] for spec in seed_demo_data.PREVIOUS_WEEK_REPORTS}
    closed = seed_demo_data.build_closed_events(store, NOW, random.Random(7))
    older = [event for event, _, _ in closed if "previous-" in event.session_id]

    assert {event.item_query for event in older} == previous
    assert all(timedelta(days=7) < NOW - event.timestamp < timedelta(days=14) for event in older)


def test_this_weeks_closed_alerts_are_off_the_alerts_table_already(store: Store) -> None:
    closed = seed_demo_data.build_closed_events(store, NOW, random.Random(7))
    week = [(event, at) for event, at, _ in closed if "week-" in event.session_id]

    assert week
    assert all(timedelta(hours=12) < NOW - event.timestamp < timedelta(days=7) for event, _ in week)


def test_unfulfilled_searches_have_varied_departments() -> None:
    misses = seed_demo_data.build_misses(NOW, random.Random(7))
    recent = [miss for miss in misses if NOW - miss.timestamp < timedelta(days=7)]

    shares = Counter(miss.category_id for miss in recent)
    assert len(shares) >= 5
    assert None in shares
    assert max(shares.values()) / len(recent) < 0.5


def test_unfulfilled_searches_grew_on_last_week() -> None:
    misses = seed_demo_data.build_misses(NOW, random.Random(7))
    recent = sum(NOW - miss.timestamp < timedelta(days=7) for miss in misses)

    assert recent > len(misses) - recent > 0


def test_unfulfilled_searches_only_name_real_departments(store: Store) -> None:
    known = {category.id for category in store.categories}

    assert {category for category, _, _ in seed_demo_data.SEARCH_MISSES} - {None} <= known
    assert set(seed_demo_data.DEPARTMENT_POPULARITY) == known


def test_trips_walk_real_edges_of_the_floor_plan(store: Store) -> None:
    trips = seed_demo_data.build_trips(store, NOW, random.Random(7))
    walkways = {tuple(sorted((edge.from_node, edge.to_node))) for edge in store.edges}

    assert trips
    assert {edge for trip in trips for edge in trip.edges} <= walkways


def test_trips_never_land_in_the_future(store: Store) -> None:
    trips = seed_demo_data.build_trips(store, NOW, random.Random(7))

    assert max(trip.timestamp for trip in trips) < NOW
    assert min(trip.timestamp for trip in trips) >= NOW - timedelta(days=15)


def test_some_walkways_are_far_busier_than_others(store: Store) -> None:
    trips = seed_demo_data.build_trips(store, NOW, random.Random(7))
    traffic = Counter(edge for trip in trips for edge in trip.edges)

    busiest, quietest = max(traffic.values()), min(traffic.values())
    assert busiest > 1.5 * quietest


def test_running_the_script_twice_keeps_one_seed_of_analytics(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "events.sqlite3"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{path.as_posix()}")

    seed_demo_data.main([])
    first = analytics_rows(path, "search_misses")
    seed_demo_data.main([])

    assert analytics_rows(path, "search_misses") == first


def test_clearing_takes_the_analytics_out_too(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "events.sqlite3"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{path.as_posix()}")

    seed_demo_data.main([])
    seed_demo_data.main(["--clear"])

    for table in ("search_misses", "trips", "trip_edges"):
        assert analytics_rows(path, table) == 0


def inventory_count(where: str) -> int:
    with create_database_engine(Settings.from_env().database_url).connect() as connection:
        return connection.exec_driver_sql(f"SELECT COUNT(*) FROM products {where}").scalar_one()


def test_the_script_fills_the_catalog() -> None:
    seed_demo_data.main([])

    assert inventory_count("WHERE source = 'pos'") == len(
        read_pos_export(seed_demo_data.POS_EXPORT)
    )


def test_the_script_retires_the_generic_products() -> None:
    seed_demo_data.main([])

    assert inventory_count("WHERE source IS NULL") == 0


def test_a_second_run_keeps_one_catalog() -> None:
    seed_demo_data.main([])
    first = inventory_count("")
    seed_demo_data.main([])

    assert inventory_count("") == first


def test_clearing_restores_the_generic_products(store: Store) -> None:
    seed_demo_data.main([])
    seed_demo_data.main(["--clear"])

    assert inventory_count("WHERE source = 'pos'") == 0
    assert inventory_count("") == len(store.products)

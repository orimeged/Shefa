import sqlite3
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.domain.events import NotFoundEvent, NotFoundReport
from app.main import create_app
from app.repositories.event_store import SqlEventStore
from tests.conftest import ADMIN_TOKEN, database_file, migrated_engine

URL = "/api/v1/admin/reports/not-found"
ADMIN = "/api/v1/admin/stores/demo"
AUTH = {"Authorization": f"Bearer {ADMIN_TOKEN}"}


@pytest.fixture()
def events(settings: Settings) -> SqlEventStore:
    return SqlEventStore(migrated_engine(database_file(settings)))


def report_of(
    store: SqlEventStore,
    item: str,
    category: str | None = "dairy",
    *,
    ago: timedelta = timedelta(hours=1),
    store_id: str = "demo",
) -> None:
    store.append(
        NotFoundEvent.from_report(
            NotFoundReport(
                store_id=store_id,
                session_id="session",
                item_query=item,
                category_id=category,
                x_coord=1.0,
                y_coord=1.0,
                timestamp=datetime.now(UTC) - ago,
            )
        )
    )


def fetch(client: TestClient, **params: str) -> list[dict[str, Any]]:
    response = client.get(URL, params={"store_id": "demo", **params}, headers=AUTH)
    assert response.status_code == 200
    return response.json()


def test_the_report_needs_the_admin_token(client: TestClient) -> None:
    assert client.get(URL, params={"store_id": "demo"}).status_code == 401


def test_an_unknown_store_is_a_404(client: TestClient) -> None:
    response = client.get(URL, params={"store_id": "nope"}, headers=AUTH)

    assert response.status_code == 404


def test_a_store_with_no_reports_is_an_empty_list(client: TestClient) -> None:
    assert fetch(client) == []


def test_groups_by_item_and_category(client: TestClient, events: SqlEventStore) -> None:
    report_of(events, "חלב")
    report_of(events, "חלב")
    report_of(events, "חלב", "produce")

    rows = fetch(client)

    assert [(row["item_query"], row["category_id"], row["times_reported"]) for row in rows] == [
        ("חלב", "dairy", 2),
        ("חלב", "produce", 1),
    ]


def test_the_most_reported_comes_first(client: TestClient, events: SqlEventStore) -> None:
    report_of(events, "פעם אחת")
    for _ in range(3):
        report_of(events, "שלוש פעמים")
    for _ in range(2):
        report_of(events, "פעמיים")

    assert [row["times_reported"] for row in fetch(client)] == [3, 2, 1]


def test_a_tie_goes_to_the_most_recent_report(client: TestClient, events: SqlEventStore) -> None:
    report_of(events, "ישן", ago=timedelta(days=2))
    report_of(events, "חדש", ago=timedelta(hours=2))

    assert [row["item_query"] for row in fetch(client)] == ["חדש", "ישן"]


def test_only_the_last_seven_days_count(client: TestClient, events: SqlEventStore) -> None:
    report_of(events, "חלב", ago=timedelta(days=6, hours=23))
    report_of(events, "חלב", ago=timedelta(days=7, hours=1))

    [row] = fetch(client)

    assert row["times_reported"] == 1


def test_gives_the_time_of_the_latest_report(client: TestClient, events: SqlEventStore) -> None:
    report_of(events, "חלב", ago=timedelta(days=3))
    report_of(events, "חלב", ago=timedelta(hours=1))

    [row] = fetch(client)

    reported_at = datetime.fromisoformat(row["last_reported_at"])
    assert reported_at.tzinfo is not None
    assert datetime.now(UTC) - reported_at < timedelta(hours=2)


def test_reports_from_another_store_stay_out(client: TestClient, events: SqlEventStore) -> None:
    report_of(events, "חלב", store_id="other")

    assert fetch(client) == []


def test_names_the_department(client: TestClient, events: SqlEventStore) -> None:
    report_of(events, "חלב", "dairy")

    [row] = fetch(client)

    assert row["category_name"] == "מוצרי חלב וביצים"
    assert row["category_name_en"] == "Dairy & Eggs"


def test_a_product_stop_is_listed_under_its_department(
    client: TestClient, events: SqlEventStore
) -> None:
    client.headers.update(AUTH)
    zones = client.get(f"{ADMIN}/nodes").json()
    node = next(zone for zone in zones if zone["section_id"] == "a1-s1-r")
    snacks = next(
        category
        for category in client.get(f"{ADMIN}/categories").json()
        if category["slug"] == "snacks"
    )
    client.post(
        f"{ADMIN}/nodes/{node['id']}/assignments/batch",
        json={"items": [{"name": "חטיף מיוחד", "category_id": snacks["id"]}]},
    )
    hit = client.get("/api/v1/stores/demo/search", params={"q": "חטיף מיוחד"}).json()[0]
    report_of(events, "חטיף מיוחד", hit["category_id"])

    [row] = fetch(client)

    assert row["category_id"].startswith("product-")
    assert row["category_name"] == snacks["name"]


@pytest.mark.parametrize("category", [None, "gone", "product-999999", "product-x"])
def test_a_report_with_no_known_department_is_still_listed(
    client: TestClient, events: SqlEventStore, category: str | None
) -> None:
    report_of(events, "משהו", category)

    [row] = fetch(client)

    assert row["item_query"] == "משהו"
    assert row["category_name"] is None


def test_the_report_works_with_no_speech_or_claude(settings: Settings) -> None:
    with TestClient(create_app(replace(settings, stt_engine="none"))) as client:
        assert fetch(client) == []


RESOLVE = f"{URL}/resolve"


def resolve(client: TestClient, item: str, category: str | None = "dairy", **extra: Any) -> Any:
    body = {"store_id": "demo", "item_query": item, "category_id": category, **extra}
    return client.post(RESOLVE, json=body, headers=AUTH)


def test_resolving_needs_the_admin_token(client: TestClient) -> None:
    body = {"store_id": "demo", "item_query": "חלב"}

    assert client.post(RESOLVE, json=body).status_code == 401


def test_resolving_for_an_unknown_store_is_a_404(client: TestClient) -> None:
    assert resolve(client, "חלב", store_id="nope").status_code == 404


@pytest.mark.parametrize(
    "bad", [{"item_query": ""}, {"item_query": "x" * 201}, {"extra_field": 1}]
)
def test_a_bad_resolve_is_refused(client: TestClient, bad: dict[str, Any]) -> None:
    body = {"store_id": "demo", "item_query": "חלב", "category_id": "dairy", **bad}

    assert client.post(RESOLVE, json=body, headers=AUTH).status_code == 422


def test_a_resolved_item_leaves_the_report(client: TestClient, events: SqlEventStore) -> None:
    report_of(events, "חלב")
    report_of(events, "חלב")
    report_of(events, "לחם", "bakery")

    response = resolve(client, "חלב")

    assert response.status_code == 200
    assert response.json() == {"resolved": 2}
    assert [row["item_query"] for row in fetch(client)] == ["לחם"]


def test_resolving_leaves_the_same_item_in_another_category(
    client: TestClient, events: SqlEventStore
) -> None:
    report_of(events, "חלב", "dairy")
    report_of(events, "חלב", "produce")

    resolve(client, "חלב", "dairy")

    assert [row["category_id"] for row in fetch(client)] == ["produce"]


def test_a_row_with_no_category_is_resolved_by_itself(
    client: TestClient, events: SqlEventStore
) -> None:
    report_of(events, "משהו", None)
    report_of(events, "משהו", "dairy")

    assert resolve(client, "משהו", None).json() == {"resolved": 1}

    assert [row["category_id"] for row in fetch(client)] == ["dairy"]


def test_resolving_leaves_other_stores_alone(
    settings: Settings, client: TestClient, events: SqlEventStore
) -> None:
    report_of(events, "חלב", store_id="other")

    assert resolve(client, "חלב").json() == {"resolved": 0}

    connection = sqlite3.connect(database_file(settings))
    try:
        assert connection.execute(
            "SELECT COUNT(*) FROM not_found_events WHERE resolved_at IS NULL"
        ).fetchone() == (1,)
    finally:
        connection.close()


def test_resolving_twice_closes_nothing_new(client: TestClient, events: SqlEventStore) -> None:
    report_of(events, "חלב")
    resolve(client, "חלב")

    response = resolve(client, "חלב")

    assert response.status_code == 200
    assert response.json() == {"resolved": 0}


def test_a_new_report_opens_a_new_alert_from_one(
    client: TestClient, events: SqlEventStore
) -> None:
    for _ in range(5):
        report_of(events, "חלב")
    resolve(client, "חלב")

    report_of(events, "חלב")

    [row] = fetch(client)
    assert row["times_reported"] == 1


def test_resolving_reaches_reports_older_than_the_window(
    client: TestClient, events: SqlEventStore
) -> None:
    report_of(events, "חלב", ago=timedelta(days=9))

    assert resolve(client, "חלב").json() == {"resolved": 1}


def test_the_report_gives_the_department_for_a_new_location(client: TestClient) -> None:
    client.headers.update(AUTH)
    bakery = next(
        category
        for category in client.get(f"{ADMIN}/categories").json()
        if category["slug"] == "bakery"
    )
    report_of(client.app.state.events, "לחם", "bakery")

    [row] = fetch(client)

    assert row["catalog_category_id"] == bakery["id"]

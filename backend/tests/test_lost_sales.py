"""The lost-sales report: reports valued at shelf prices, split by what the manager found."""

import sqlite3
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.domain.events import NotFoundEvent, NotFoundReport, ReportRecord
from app.domain.inventory import PricedProduct
from app.domain.lost_sales import PriceBook, restock_minutes, summarize
from app.domain.search_text import normalize
from app.repositories.event_store import SqlEventStore
from tests.conftest import ADMIN_TOKEN, database_file, migrated_engine

REPORT = "/api/v1/admin/analytics/lost-sales"
ALERTS = "/api/v1/admin/reports/not-found"
RESOLVE = "/api/v1/admin/reports/not-found/resolve"
ADMIN = "/api/v1/admin/stores/demo"
AUTH = {"Authorization": f"Bearer {ADMIN_TOKEN}"}
NOW = datetime(2026, 11, 12, 18, 0, tzinfo=UTC)



def product(id_: int, name: str, department: str, price: int | None) -> PricedProduct:
    return PricedProduct(id=id_, name=name, name_key=normalize(name), department=department, price_agorot=price)


MILK = product(1, "חלב 3% תנובה 1 ליטר", "dairy", 710)
COTTAGE = product(2, "קוטג' 5%", "dairy", 620)
YOGURT = product(3, "יוגורט", "dairy", None)
BREAD = product(4, "לחם אחיד", "bakery", 740)
BOOK = PriceBook([MILK, COTTAGE, YOGURT, BREAD])


def record(
    item: str,
    category: str | None = "dairy",
    *,
    ago: timedelta = timedelta(hours=1),
    closed_after: timedelta | None = None,
    resolution: str | None = None,
    source: str = "shopper",
) -> ReportRecord:
    at = NOW - ago
    return ReportRecord(
        item_query=item,
        category_id=category,
        timestamp=at,
        resolved_at=at + closed_after if closed_after is not None else None,
        resolution=resolution,
        source=source,
    )


# ---- Pricing a report


def test_a_report_for_a_product_is_priced_at_that_product() -> None:
    assert BOOK.estimate("חלב 3% תנובה 1 ליטר", "dairy").model_dump() == {"agorot": 710, "basis": "product"}
    assert BOOK.estimate("anything", "product-4").model_dump() == {"agorot": 740, "basis": "product"}


def test_a_loose_word_takes_the_median_of_matching_products() -> None:
    estimate = BOOK.estimate("חלב", "dairy")
    assert estimate is not None and (estimate.agorot, estimate.basis) == (710, "similar")


def test_an_unknown_item_falls_back_to_its_departments_median() -> None:
    estimate = BOOK.estimate("שמנת", "dairy")
    assert estimate is not None and (estimate.agorot, estimate.basis) == (665, "department")


def test_no_department_and_no_product_means_no_price() -> None:
    assert BOOK.estimate("נרות שבת", None) is None
    assert BOOK.estimate("נרות שבת", "toiletries") is None


def test_products_without_a_price_are_left_out_of_every_median() -> None:
    estimate = BOOK.estimate("יוגורט", "dairy")
    assert estimate is not None and estimate.basis == "department"


# ---- Adding it up


def test_every_report_counts_once_at_its_price() -> None:
    records = [record("חלב 3% תנובה 1 ליטר"), record("חלב 3% תנובה 1 ליטר"), record("לחם אחיד", "bakery")]

    summary = summarize(records, BOOK, NOW - timedelta(days=7), NOW)

    assert summary.value_agorot == 710 * 2 + 740
    assert (summary.reports, summary.priced_reports, summary.exact_reports) == (3, 3, 3)
    assert [item.item for item in summary.items] == ["חלב 3% תנובה 1 ליטר", "לחם אחיד"]
    assert summary.items[0].value_agorot == 1420


def test_restocked_and_open_reports_are_empty_shelves_the_rest_misplaced() -> None:
    records = [
        record("חלב 3% תנובה 1 ליטר"),
        record("לחם אחיד", "bakery", closed_after=timedelta(minutes=30), resolution="restocked"),
        record("קוטג' 5%", closed_after=timedelta(minutes=5), resolution="on_shelf"),
        record("חלב", closed_after=timedelta(minutes=5), resolution="relocated"),
    ]

    summary = summarize(records, BOOK, NOW - timedelta(days=7), NOW)

    assert (summary.empty_shelf.reports, summary.empty_shelf.value_agorot) == (2, 710 + 740)
    assert (summary.misplaced.reports, summary.misplaced.items, summary.misplaced.value_agorot) == (2, 2, 620 + 710)
    assert (summary.open_alerts, summary.open_value_agorot) == (1, 710)
    states = {item.item: item.state for item in summary.items}
    assert states == {
        "חלב 3% תנובה 1 ליטר": "open",
        "לחם אחיד": "restocked",
        "קוטג' 5%": "misplaced",
        "חלב": "misplaced",
    }


def test_restock_time_runs_from_an_alerts_first_report_to_its_closing() -> None:
    closed_at = timedelta(minutes=90)
    records = [
        # One alert: two reports closed together, 90 minutes after the first.
        record("לחם אחיד", "bakery", ago=timedelta(hours=5), closed_after=closed_at, resolution="restocked"),
        record("לחם אחיד", "bakery", ago=timedelta(hours=4), closed_after=timedelta(minutes=30), resolution="restocked"),
        record("חלב 3% תנובה 1 ליטר", ago=timedelta(hours=3), closed_after=timedelta(minutes=30), resolution="restocked"),
        # Misplaced: not a restock, so not timed.
        record("קוטג' 5%", ago=timedelta(hours=2), closed_after=timedelta(minutes=5), resolution="on_shelf"),
    ]

    assert sorted(restock_minutes(records, NOW - timedelta(days=7), NOW)) == [30.0, 90.0]
    summary = summarize(records, BOOK, NOW - timedelta(days=7), NOW)
    assert (summary.restocked_alerts, summary.restock_median_minutes) == (2, 60.0)


def test_a_report_closed_before_closings_had_a_reason_counts_as_restocked() -> None:
    records = [record("לחם אחיד", "bakery", closed_after=timedelta(minutes=20))]

    summary = summarize(records, BOOK, NOW - timedelta(days=7), NOW)

    assert summary.restock_median_minutes == 20.0
    assert summary.empty_shelf.reports == 1


def test_only_the_period_counts_but_an_older_first_report_still_times_its_alert() -> None:
    reported = timedelta(days=8)
    records = [
        record("לחם אחיד", "bakery", ago=reported, closed_after=timedelta(days=2), resolution="restocked"),
        record("חלב 3% תנובה 1 ליטר", ago=timedelta(days=3)),
    ]

    summary = summarize(records, BOOK, NOW - timedelta(days=7), NOW)

    assert summary.reports == 1
    assert summary.restock_median_minutes == 2 * 24 * 60


def test_picker_reports_are_counted_apart() -> None:
    records = [record("לחם אחיד", "bakery", source="picker"), record("לחם אחיד", "bakery")]

    [item] = summarize(records, BOOK, NOW - timedelta(days=7), NOW).items

    assert (item.reports, item.picker_reports) == (2, 1)


# ---- The endpoint


@pytest.fixture()
def admin(client: TestClient) -> TestClient:
    client.headers.update(AUTH)
    return client


@pytest.fixture()
def events(settings: Settings) -> SqlEventStore:
    return SqlEventStore(migrated_engine(database_file(settings)))


def report_of(store: SqlEventStore, item: str, category: str | None = "dairy", ago: timedelta = timedelta(hours=1)) -> None:
    store.append(
        NotFoundEvent.from_report(
            NotFoundReport(
                store_id="demo",
                session_id="session",
                item_query=item,
                category_id=category,
                x_coord=1.0,
                y_coord=1.0,
                timestamp=datetime.now(UTC) - ago,
            )
        )
    )


def priced(admin: TestClient, name: str, department: str, price: int) -> dict[str, Any]:
    response = admin.post(f"{ADMIN}/products", json={"name": name, "department": department, "price_agorot": price})
    assert response.status_code == 201, response.text
    return response.json()


def test_the_report_needs_the_admin_token(client: TestClient) -> None:
    assert client.get(REPORT, params={"store_id": "demo"}).status_code == 401


def test_the_report_values_this_weeks_reports_against_last_weeks(admin: TestClient, events: SqlEventStore) -> None:
    priced(admin, "חלב 3% טרה", "dairy", 710)
    priced(admin, "לחם אחיד אנג'ל", "bakery", 740)
    for _ in range(3):
        report_of(events, "חלב 3% טרה")
    report_of(events, "לחם אחיד אנג'ל", "bakery", ago=timedelta(days=9))

    body = admin.get(REPORT, params={"store_id": "demo"}).json()

    assert (body["days"], body["reports"], body["value_agorot"]) == (7, 3, 2130)
    assert (body["previous_reports"], body["previous_value_agorot"]) == (1, 740)
    assert body["open_alerts"] == 1
    [item] = body["items"]
    assert item["item"] == "חלב 3% טרה"
    assert (item["unit_price_agorot"], item["price_basis"], item["state"]) == (710, "product", "open")
    assert item["category_name"]


def test_closing_as_on_shelf_moves_the_money_to_misplaced(admin: TestClient, events: SqlEventStore) -> None:
    priced(admin, "חלב 3% טרה", "dairy", 710)
    report_of(events, "חלב 3% טרה")
    report_of(events, "חלב 3% טרה")

    closed = admin.post(
        RESOLVE, json={"store_id": "demo", "item_query": "חלב 3% טרה", "category_id": "dairy", "resolution": "on_shelf"}
    )

    assert closed.json() == {"resolved": 2}
    body = admin.get(REPORT, params={"store_id": "demo"}).json()
    assert (body["misplaced"]["reports"], body["misplaced"]["value_agorot"]) == (2, 1420)
    assert body["empty_shelf"]["reports"] == 0
    assert body["open_alerts"] == 0
    assert body["restocked_alerts"] == 0


def test_closing_as_restocked_times_the_alert(admin: TestClient, events: SqlEventStore) -> None:
    report_of(events, "חלב 3% טרה", ago=timedelta(minutes=45))

    admin.post(RESOLVE, json={"store_id": "demo", "item_query": "חלב 3% טרה", "category_id": "dairy"})

    body = admin.get(REPORT, params={"store_id": "demo"}).json()
    assert body["restocked_alerts"] == 1
    assert 44 <= body["restock_median_minutes"] <= 46


def test_an_unknown_resolution_is_refused(admin: TestClient) -> None:
    response = admin.post(
        RESOLVE, json={"store_id": "demo", "item_query": "x", "category_id": "dairy", "resolution": "lost"}
    )
    assert response.status_code == 422


def test_the_alerts_table_shows_what_each_alert_is_worth(admin: TestClient, events: SqlEventStore) -> None:
    priced(admin, "חלב 3% טרה", "dairy", 710)
    for _ in range(3):
        report_of(events, "חלב 3% טרה")

    [row] = admin.get(ALERTS, params={"store_id": "demo"}).json()

    assert (row["unit_price_agorot"], row["price_basis"], row["value_agorot"]) == (710, "product", 2130)


def test_searches_for_what_the_store_doesnt_carry_come_along(admin: TestClient) -> None:
    body = admin.get(REPORT, params={"store_id": "demo"}).json()
    assert body["not_carried"] == {"searches": 0, "previous_searches": 0, "items": []}


# ---- What the database still refuses


def test_a_closed_report_cant_be_reclosed_with_another_reason(settings: Settings, events: SqlEventStore) -> None:
    report_of(events, "חלב")
    events.resolve_not_found("demo", "חלב", "dairy", datetime.now(UTC), "on_shelf")

    connection = sqlite3.connect(database_file(settings))
    try:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute("UPDATE not_found_events SET resolution = 'restocked'")
    finally:
        connection.close()


def test_who_reported_never_changes(settings: Settings, events: SqlEventStore) -> None:
    report_of(events, "חלב")

    connection = sqlite3.connect(database_file(settings))
    try:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute("UPDATE not_found_events SET source = 'picker'")
    finally:
        connection.close()


def test_a_report_is_from_a_shopper_unless_staff_say_otherwise(events: SqlEventStore) -> None:
    report_of(events, "חלב")
    [stored] = events.report_records("demo", datetime.now(UTC) - timedelta(days=1))
    assert (stored.source, stored.resolution, stored.resolved_at) == ("shopper", None, None)

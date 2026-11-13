"""Picking online orders in the store: the route-sorted order, missing lines, and minutes per order."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.domain.picking import PickSession, summarize_picks
from app.main import create_app
from app.services.push import AlertNotifier, PushOutcome, PushSubscription
from tests.conftest import ADMIN_TOKEN
from tests.floor_plans import plan_payload

STAFF = "/api/v1/staff"
AUTH = {"Authorization": f"Bearer {ADMIN_TOKEN}"}
NOW = datetime(2026, 11, 12, 18, 0, tzinfo=UTC)

STORE = [
    "##########",
    "#........#",
    "#.vv..ff.#",
    "#........#",
    "#.dddd...#",
    "#........#",
    "E.....CC.#",
]
LABELS = {"v": "ירקות", "f": "פירות", "d": "מוצרי חלב וביצים"}


def session(minutes: float, lines: int = 20, missing: int = 0, ago: timedelta = timedelta(hours=1)) -> PickSession:
    finished = NOW - ago
    return PickSession(
        id=uuid4(),
        store_id="demo",
        started_at=finished - timedelta(minutes=minutes),
        finished_at=finished,
        lines=lines,
        missing=missing,
    )


# ---- The figures


def test_minutes_per_order_is_a_median() -> None:
    summary = summarize_picks([session(20), session(30), session(40, lines=10, missing=2)])
    assert (summary.orders, summary.lines, summary.missing, summary.median_minutes) == (3, 50, 2, 30.0)
    assert summary.median_minutes_per_line == 1.5


def test_a_misfire_or_a_forgotten_phone_doesnt_move_it() -> None:
    summary = summarize_picks([session(0.2), session(25), session(30), session(600)])
    assert summary.orders == 4
    assert summary.median_minutes == 27.5


def test_no_orders_no_median() -> None:
    assert summarize_picks([]).median_minutes is None


# ---- The endpoints


@pytest.fixture()
def staff(settings: Settings) -> TestClient:
    with TestClient(create_app(replace(settings, staff_token="s"))) as client:
        client.headers.update(AUTH)
        yield client


def draw(client: TestClient) -> None:
    saved = client.put("/api/v1/stores/demo/floor-plan", json=plan_payload(STORE, LABELS))
    assert saved.status_code == 200 and saved.json()["check"]["routable"]


def picked(**overrides: Any) -> dict[str, Any]:
    finished = datetime.now(UTC)
    return {
        "id": str(uuid4()),
        "store_id": "demo",
        "started_at": (finished - timedelta(minutes=22)).isoformat(),
        "finished_at": finished.isoformat(),
        "lines": 18,
        "missing": 1,
        **overrides,
    }


def test_picking_needs_a_staff_or_admin_token(client: TestClient) -> None:
    assert client.post(f"{STAFF}/picks/route", params={"store_id": "demo"}, json={"category_ids": ["dairy"]}).status_code == 401


def test_picking_needs_a_drawn_plan(staff: TestClient) -> None:
    response = staff.post(f"{STAFF}/picks/route", params={"store_id": "demo"}, json={"category_ids": ["dairy"]})
    assert response.status_code == 409


def test_an_order_comes_back_in_walking_order_without_counting_as_a_shopper(staff: TestClient) -> None:
    draw(staff)
    trips_before = staff.get("/api/v1/admin/analytics/traffic-flow", params={"store_id": "demo"}).json()["trips"]

    route = staff.post(f"{STAFF}/picks/route", params={"store_id": "demo"}, json={"category_ids": ["dairy", "produce"]})

    assert route.status_code == 200, route.text
    assert {stop["category_id"] for stop in route.json()["stops"]} == {"dairy", "produce"}
    trips_after = staff.get("/api/v1/admin/analytics/traffic-flow", params={"store_id": "demo"}).json()["trips"]
    assert trips_after == trips_before


class Ringing:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    def send(self, subscription: PushSubscription, payload: dict[str, Any]) -> PushOutcome:
        self.sent.append(payload)
        return PushOutcome.SENT


def test_a_missing_line_is_a_picker_report_that_always_rings(staff: TestClient) -> None:
    draw(staff)
    ringing = Ringing()
    state = staff.app.state
    state.notifier = AlertNotifier(state.push_subscriptions, ringing, "key")
    state.push_subscriptions.save("demo", PushSubscription(endpoint="https://push.example/1", p256dh="k", auth="a"))
    body = {"store_id": "demo", "session_id": "picker-1", "item_query": "חלב 3%", "category_id": "dairy", "x_coord": 2.5, "y_coord": 2.5}

    for _ in range(2):
        assert staff.post(f"{STAFF}/picks/missing", json={**body, "event_id": str(uuid4())}).status_code == 201

    assert [payload["title"] for payload in ringing.sent] == ["מלקט: חסר במדף", "מלקט: חסר במדף"]
    report = staff.get("/api/v1/admin/analytics/lost-sales", params={"store_id": "demo"}).json()
    [item] = report["items"]
    assert (item["reports"], item["picker_reports"]) == (2, 2)


def test_a_missing_line_must_be_in_the_store(staff: TestClient) -> None:
    draw(staff)
    body = {"store_id": "demo", "session_id": "p", "item_query": "x", "x_coord": 500.0, "y_coord": 500.0}
    assert staff.post(f"{STAFF}/picks/missing", json=body).status_code == 422


def test_a_finished_order_is_kept_once_and_counted(staff: TestClient) -> None:
    order = picked()

    first = staff.post(f"{STAFF}/picks/finish", json=order).json()
    again = staff.post(f"{STAFF}/picks/finish", json=order).json()

    assert first == {"recorded": True, "minutes": 22.0}
    assert again["recorded"] is False
    figures = staff.get("/api/v1/admin/analytics/picking", params={"store_id": "demo"}).json()
    assert (figures["current"]["orders"], figures["current"]["median_minutes"]) == (1, 22.0)
    assert figures["previous"]["orders"] == 0


@pytest.mark.parametrize(
    "overrides",
    [{"missing": 30}, {"lines": 0}, {"finished_at": "2020-01-01T00:00:00+00:00"}, {"store_id": "nope"}],
)
def test_a_nonsense_order_is_refused(staff: TestClient, overrides: dict[str, Any]) -> None:
    assert staff.post(f"{STAFF}/picks/finish", json=picked(**overrides)).status_code in (404, 422)


def test_order_lines_are_matched_without_counting_as_searches(staff: TestClient) -> None:
    resolved = staff.post(f"{STAFF}/picks/resolve", params={"store_id": "demo"}, json={"lines": ["חלב", "נרות שבת לכל השבוע"]})

    assert resolved.status_code == 200, resolved.text
    [milk, candles] = resolved.json()
    assert milk["hit"]["category_id"] == "dairy"
    assert candles["hit"] is None
    counts = staff.get("/api/v1/admin/analytics/summary", params={"store_id": "demo"}).json()
    assert counts["unfulfilled_searches"]["current"] == 0

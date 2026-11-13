"""The floor staff's app: its token, its alerts, and alerts pushed to phones."""

import base64
import os
from dataclasses import replace
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

import generate_vapid_keys
from app.config import Settings
from app.main import create_app
from app.services.push import AlertNotifier, PushOutcome, PushSubscription, alert_message, should_alert
from tests.conftest import ADMIN_TOKEN

STAFF_TOKEN = "test-staff-token"
STAFF = "/api/v1/staff"
REPORTS = "/api/events/not-found"
SUBSCRIPTION = {
    "endpoint": "https://push.example.com/send/abc",
    "keys": {"p256dh": "BPublicKey", "auth": "secret"},
}


class FakeSender:
    """Records what would have gone to each phone, and answers as told."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, dict[str, Any]]] = []
        self.answer = PushOutcome.SENT

    def send(self, subscription: PushSubscription, payload: dict[str, Any]) -> PushOutcome:
        self.sent.append((subscription.endpoint, payload))
        return self.answer


@pytest.fixture()
def staff_settings(settings: Settings) -> Settings:
    return replace(settings, staff_token=STAFF_TOKEN)


@pytest.fixture()
def staff(staff_settings: Settings) -> TestClient:
    with TestClient(create_app(staff_settings)) as client:
        client.headers.update({"Authorization": f"Bearer {STAFF_TOKEN}"})
        yield client


@pytest.fixture()
def sender(staff: TestClient) -> FakeSender:
    fake = FakeSender()
    state = staff.app.state
    state.notifier = AlertNotifier(state.push_subscriptions, fake, "test-public-key")
    return fake


def report(client: TestClient, item: str = "חלב 3% תנובה 1 ליטר", category: str = "dairy") -> None:
    response = client.post(
        REPORTS,
        json={
            "event_id": str(uuid4()),
            "store_id": "demo",
            "session_id": "shopper",
            "item_query": item,
            "category_id": category,
            "x_coord": 5.0,
            "y_coord": 5.0,
        },
    )
    assert response.status_code == 201, response.text


# ---- Who gets in


def test_the_staff_token_opens_the_staff_app(staff: TestClient) -> None:
    assert staff.get(f"{STAFF}/session").status_code == 204


def test_the_dashboard_token_opens_it_too(staff: TestClient) -> None:
    response = staff.get(f"{STAFF}/session", headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})
    assert response.status_code == 204


def test_a_wrong_token_is_refused(staff: TestClient) -> None:
    assert staff.get(f"{STAFF}/session", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert staff.get(f"{STAFF}/session", headers={"Authorization": ""}).status_code == 401


def test_the_staff_token_doesnt_open_the_dashboard(staff: TestClient) -> None:
    assert staff.get("/api/v1/admin/session").status_code == 401


def test_with_no_token_at_all_the_staff_app_stays_locked(settings: Settings) -> None:
    with TestClient(create_app(replace(settings, admin_token=None))) as client:
        assert client.get(f"{STAFF}/session").status_code == 503


# ---- Alerts


def test_staff_see_and_close_the_open_alerts(staff: TestClient) -> None:
    report(staff)
    report(staff)

    [row] = staff.get(f"{STAFF}/alerts", params={"store_id": "demo"}).json()
    assert (row["item_query"], row["times_reported"]) == ("חלב 3% תנובה 1 ליטר", 2)
    assert "shelf" in row

    closed = staff.post(
        f"{STAFF}/alerts/resolve",
        json={"store_id": "demo", "item_query": row["item_query"], "category_id": "dairy", "resolution": "restocked"},
    )
    assert closed.json() == {"resolved": 2}
    assert staff.get(f"{STAFF}/alerts", params={"store_id": "demo"}).json() == []


def test_an_unknown_store_is_a_404(staff: TestClient) -> None:
    assert staff.get(f"{STAFF}/alerts", params={"store_id": "nope"}).status_code == 404


# ---- Push, switched off


def test_without_a_vapid_key_there_is_no_push(staff: TestClient) -> None:
    assert staff.get(f"{STAFF}/push/key").json() == {"public_key": None}
    response = staff.post(f"{STAFF}/push/subscriptions", json={"store_id": "demo", **SUBSCRIPTION})
    assert response.status_code == 503


def test_reports_still_work_with_push_off(staff: TestClient) -> None:
    report(staff)
    assert len(staff.get(f"{STAFF}/alerts", params={"store_id": "demo"}).json()) == 1


# ---- Push, switched on


def test_a_phone_subscribes_and_hears_the_first_report(staff: TestClient, sender: FakeSender) -> None:
    assert staff.get(f"{STAFF}/push/key").json() == {"public_key": "test-public-key"}
    assert staff.post(f"{STAFF}/push/subscriptions", json={"store_id": "demo", **SUBSCRIPTION}).status_code == 201

    report(staff)

    [(endpoint, payload)] = sender.sent
    assert endpoint == SUBSCRIPTION["endpoint"]
    assert payload["item"] == "חלב 3% תנובה 1 ליטר"
    assert payload["url"] == "/staff"
    assert payload["tag"] == "alert:dairy:חלב 3% תנובה 1 ליטר"
    assert payload["count"] == 1


def test_only_the_first_and_the_third_report_ring(staff: TestClient, sender: FakeSender) -> None:
    staff.post(f"{STAFF}/push/subscriptions", json={"store_id": "demo", **SUBSCRIPTION})

    for _ in range(4):
        report(staff)

    assert [payload["count"] for _, payload in sender.sent] == [1, 3]
    assert "כנראה מדף ריק" in sender.sent[1][1]["title"]


def test_after_a_restock_the_next_report_rings_again(staff: TestClient, sender: FakeSender) -> None:
    staff.post(f"{STAFF}/push/subscriptions", json={"store_id": "demo", **SUBSCRIPTION})
    report(staff)
    staff.post(f"{STAFF}/alerts/resolve", json={"store_id": "demo", "item_query": "חלב 3% תנובה 1 ליטר", "category_id": "dairy"})

    report(staff)

    assert [payload["count"] for _, payload in sender.sent] == [1, 1]


def test_a_retried_report_doesnt_ring_twice(staff: TestClient, sender: FakeSender) -> None:
    staff.post(f"{STAFF}/push/subscriptions", json={"store_id": "demo", **SUBSCRIPTION})
    body = {
        "event_id": str(uuid4()),
        "store_id": "demo",
        "session_id": "s",
        "item_query": "לחם",
        "category_id": "bakery",
        "x_coord": 5.0,
        "y_coord": 5.0,
    }
    staff.post(REPORTS, json=body)
    assert staff.post(REPORTS, json=body).status_code == 200

    assert len(sender.sent) == 1


def test_a_phone_the_push_service_forgot_is_dropped(staff: TestClient, sender: FakeSender) -> None:
    staff.post(f"{STAFF}/push/subscriptions", json={"store_id": "demo", **SUBSCRIPTION})
    sender.answer = PushOutcome.GONE

    report(staff)
    report(staff, item="לחם")

    assert len(sender.sent) == 1
    assert staff.app.state.push_subscriptions.for_store("demo") == []


def test_subscribing_again_doesnt_double_the_alerts(staff: TestClient, sender: FakeSender) -> None:
    for _ in range(2):
        staff.post(f"{STAFF}/push/subscriptions", json={"store_id": "demo", **SUBSCRIPTION})

    report(staff)

    assert len(sender.sent) == 1


def test_unsubscribing_stops_them(staff: TestClient, sender: FakeSender) -> None:
    staff.post(f"{STAFF}/push/subscriptions", json={"store_id": "demo", **SUBSCRIPTION})
    assert staff.post(f"{STAFF}/push/unsubscribe", json={"endpoint": SUBSCRIPTION["endpoint"]}).status_code == 204

    report(staff)

    assert sender.sent == []


def test_a_subscription_must_point_at_a_push_service(staff: TestClient, sender: FakeSender) -> None:
    bad = {**SUBSCRIPTION, "endpoint": "http://evil.example/collect"}
    assert staff.post(f"{STAFF}/push/subscriptions", json={"store_id": "demo", **bad}).status_code == 422


def test_a_test_alert_reaches_every_phone(staff: TestClient, sender: FakeSender) -> None:
    staff.post(f"{STAFF}/push/subscriptions", json={"store_id": "demo", **SUBSCRIPTION})
    other = {**SUBSCRIPTION, "endpoint": "https://push.example.com/send/def"}
    staff.post(f"{STAFF}/push/subscriptions", json={"store_id": "demo", **other})

    assert staff.post(f"{STAFF}/push/test", json={"store_id": "demo"}).json() == {"sent": 2}


# ---- The message itself


def test_pickers_always_ring_shoppers_on_the_first_and_third() -> None:
    assert [count for count in range(1, 6) if should_alert(count, "shopper")] == [1, 3]
    assert all(should_alert(count, "picker") for count in range(1, 6))


def test_the_message_names_the_item_and_its_shelf() -> None:
    message = alert_message("חלב 3%", "dairy", 1, "חלב וביצים", "מוצרי חלב", "shopper")
    assert message["body"] == "חלב 3% · מדף חלב וביצים"
    assert message["title"] == "לקוח לא מצא מוצר במדף"
    without_shelf = alert_message("חלב 3%", "dairy", 3, None, "מוצרי חלב", "shopper")
    assert without_shelf["body"] == "חלב 3% · מוצרי חלב"
    assert alert_message("חלב", None, 1, None, None, "picker")["title"] == "מלקט: חסר במדף"


# ---- The key pair


def test_a_generated_key_pair_signs_and_encrypts_a_real_push(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    env = tmp_path / ".env"
    env.write_text("OPENAI_API_KEY=keep-me\n", encoding="utf-8")
    monkeypatch.setattr(generate_vapid_keys, "ENV_FILE", env)
    # The library's dry run writes the encrypted body to a file in the working directory.
    monkeypatch.chdir(tmp_path)

    assert generate_vapid_keys.main(["mailto:ops@example.com"]) == 0
    values = dict(line.split("=", 1) for line in env.read_text(encoding="utf-8").splitlines())
    assert values["OPENAI_API_KEY"] == "keep-me"
    assert values["VAPID_SUBJECT"] == "mailto:ops@example.com"
    assert generate_vapid_keys.main(["mailto:ops@example.com"]) == 1, "never overwrites a key in use"

    from py_vapid import Vapid
    from pywebpush import webpush

    phone = ec.generate_private_key(ec.SECP256R1())
    p256dh = base64.urlsafe_b64encode(
        phone.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    ).decode().rstrip("=")
    auth = base64.urlsafe_b64encode(os.urandom(16)).decode().rstrip("=")
    request = webpush(
        subscription_info={"endpoint": "https://push.example.com/x", "keys": {"p256dh": p256dh, "auth": auth}},
        data='{"title": "בדיקה"}',
        vapid_private_key=Vapid.from_string(values["VAPID_PRIVATE_KEY"]),
        vapid_claims={"sub": values["VAPID_SUBJECT"]},
        curl=True,
    )
    assert "vapid t=" in request and values["VAPID_PUBLIC_KEY"] in request


# ---- Placing products by barcode

ADMIN_PRODUCTS = "/api/v1/admin/stores/demo/products"


def admin_add(client: TestClient, **fields: Any) -> dict[str, Any]:
    response = client.post(
        ADMIN_PRODUCTS,
        json={"department": "dairy", **fields},
        headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_a_scanned_barcode_finds_its_product(staff: TestClient) -> None:
    milk = admin_add(staff, name="חלב 3% טרה", barcode="7290000002200", price_agorot=710)

    [found] = staff.get(f"{STAFF}/products", params={"store_id": "demo", "barcode": "7290000002200"}).json()

    assert (found["id"], found["name"], found["price_agorot"]) == (milk["id"], "חלב 3% טרה", 710)


def test_a_upc_scan_finds_the_ean_with_its_leading_zero(staff: TestClient) -> None:
    admin_add(staff, name="דגני בדיקה מיובאים", barcode="0012345678905", department="cereals")

    [found] = staff.get(f"{STAFF}/products", params={"store_id": "demo", "barcode": "012345678905"}).json()

    assert found["name"] == "דגני בדיקה מיובאים"


def test_an_unknown_barcode_is_an_empty_answer(staff: TestClient) -> None:
    assert staff.get(f"{STAFF}/products", params={"store_id": "demo", "barcode": "7290099999999"}).json() == []


def test_a_barcode_is_digits(staff: TestClient) -> None:
    assert staff.get(f"{STAFF}/products", params={"store_id": "demo", "barcode": "12ab"}).status_code == 422


def test_staff_move_a_product_to_the_shelf_they_found_it_on(staff: TestClient) -> None:
    milk = admin_add(staff, name="חלב 3% טרה", barcode="7290000002200", price_agorot=710)

    moved = staff.patch(f"{STAFF}/products/{milk['id']}", params={"store_id": "demo"}, json={"subcategory": "חלב וביצים"})

    assert moved.status_code == 200, moved.text
    assert moved.json()["subcategory"] == "חלב וביצים"
    assert moved.json()["price_agorot"] == 710


def test_staff_cant_change_a_price_or_a_name(staff: TestClient) -> None:
    milk = admin_add(staff, name="חלב 3% טרה", price_agorot=710)
    for change in ({"price_agorot": 1}, {"name": "אחר"}):
        response = staff.patch(f"{STAFF}/products/{milk['id']}", params={"store_id": "demo"}, json=change)
        assert response.status_code == 422


def test_staff_add_a_product_the_catalog_lacked_without_a_price(staff: TestClient) -> None:
    created = staff.post(
        f"{STAFF}/products",
        params={"store_id": "demo"},
        json={"name": "חלב שקדים אלפרו", "barcode": "5411188112709", "department": "dairy", "subcategory": "חלב וביצים"},
    )
    assert created.status_code == 201, created.text
    assert created.json()["price_agorot"] is None
    refused = staff.post(
        f"{STAFF}/products", params={"store_id": "demo"}, json={"name": "x", "department": "dairy", "price_agorot": 100}
    )
    assert refused.status_code == 422


def test_staff_see_the_departments(staff: TestClient) -> None:
    categories = staff.get(f"{STAFF}/categories", params={"store_id": "demo"}).json()
    assert "dairy" in {category["slug"] for category in categories}

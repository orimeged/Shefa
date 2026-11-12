"""The catalog screen's API: listing, adding, editing and removing products, and the shelf each reaches."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import ADMIN_TOKEN
from tests.floor_plans import plan_payload

ADMIN = "/api/v1/admin/stores/demo"
SHOPPER = "/api/v1/stores/demo"
AUTH = {"Authorization": f"Bearer {ADMIN_TOKEN}"}

# A small store drawn with produce as two shelves, fruit and vegetables, and dairy whole.
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


@pytest.fixture()
def admin(client: TestClient) -> TestClient:
    client.headers.update(AUTH)
    return client


def add(client: TestClient, **fields: Any) -> dict[str, Any]:
    response = client.post(f"{ADMIN}/products", json={"department": "produce", **fields})
    assert response.status_code == 201, response.text
    return response.json()


def draw(client: TestClient) -> None:
    saved = client.put(f"{SHOPPER}/floor-plan", json=plan_payload(STORE, LABELS))
    assert saved.status_code == 200 and saved.json()["check"]["routable"]


def test_the_catalog_needs_the_managers_token(client: TestClient) -> None:
    assert client.get(f"{ADMIN}/products").status_code == 401
    assert client.post(f"{ADMIN}/products", json={"name": "x", "department": "produce"}).status_code == 401


def test_it_lists_the_stores_products_with_their_department(admin: TestClient) -> None:
    products = admin.get(f"{ADMIN}/products").json()
    assert products, "the demo store starts with its placeholder products"
    assert all({"id", "name", "department", "subcategory", "shelf", "zones"} <= set(row) for row in products)


def test_a_manager_adds_a_product_with_its_hebrew_name_barcode_and_shelf(admin: TestClient) -> None:
    created = add(admin, name="תפוחי עץ גאלה", barcode="7290000000015", subcategory="פירות")
    assert (created["name"], created["barcode"], created["department"], created["subcategory"]) == (
        "תפוחי עץ גאלה",
        "7290000000015",
        "produce",
        "פירות",
    )
    assert any(row["id"] == created["id"] for row in admin.get(f"{ADMIN}/products").json())


def test_the_same_name_or_barcode_twice_is_refused(admin: TestClient) -> None:
    add(admin, name="אגסים", barcode="7290000000022")
    assert admin.post(f"{ADMIN}/products", json={"name": "  אגסים ", "department": "produce"}).status_code == 409
    clash = admin.post(f"{ADMIN}/products", json={"name": "אגס אחר", "barcode": "7290000000022", "department": "produce"})
    assert clash.status_code == 409


@pytest.mark.parametrize(
    "fields",
    [
        {"name": "", "department": "produce"},
        {"name": "x", "department": "no-such-department"},
        {"name": "x", "department": "produce", "barcode": "7290000000016"},
        {"name": "x", "department": "produce", "barcode": "12ab"},
        {"name": "x", "department": "produce", "price": 9.9},
    ],
)
def test_a_product_that_doesnt_hold_together_is_refused(admin: TestClient, fields: dict[str, Any]) -> None:
    assert admin.post(f"{ADMIN}/products", json=fields).status_code == 422


def test_editing_changes_only_what_was_sent(admin: TestClient) -> None:
    created = add(admin, name="מלפפונים בדיקה", brand="מהדרין", subcategory="ירקות")
    changed = admin.patch(f"{ADMIN}/products/{created['id']}", json={"name": "מלפפונים בייבי בדיקה"}).json()
    assert (changed["name"], changed["brand"], changed["subcategory"]) == ("מלפפונים בייבי בדיקה", "מהדרין", "ירקות")
    cleared = admin.patch(f"{ADMIN}/products/{created['id']}", json={"subcategory": None}).json()
    assert cleared["subcategory"] is None


def test_a_product_moves_to_another_department(admin: TestClient) -> None:
    created = add(admin, name="ביצי חופש בדיקה", subcategory="ירקות")
    moved = admin.patch(f"{ADMIN}/products/{created['id']}", json={"department": "dairy", "subcategory": None}).json()
    assert moved["department"] == "dairy"


def test_removing_a_product_takes_it_out(admin: TestClient) -> None:
    created = add(admin, name="מוצר לבדיקה")
    assert admin.delete(f"{ADMIN}/products/{created['id']}").status_code == 204
    assert all(row["id"] != created["id"] for row in admin.get(f"{ADMIN}/products").json())
    assert admin.delete(f"{ADMIN}/products/{created['id']}").status_code == 404
    assert admin.patch(f"{ADMIN}/products/{created['id']}", json={"name": "y"}).status_code == 404


# ---------- On a drawn plan ----------


def test_without_a_plan_no_shelf_is_named(admin: TestClient) -> None:
    created = add(admin, name="תותים", subcategory="פירות")
    assert created["shelf"] is None


def test_each_product_says_the_shelf_it_reaches_on_the_plan(admin: TestClient) -> None:
    draw(admin)
    fruit = add(admin, name="תותים", subcategory="פירות")
    plain = add(admin, name="חלב טרי", department="dairy")
    assert fruit["shelf"] == "פירות"
    # No finer shelf: its department's.
    assert plain["shelf"] == "מוצרי חלב וביצים"
    listed = {row["id"]: row["shelf"] for row in admin.get(f"{ADMIN}/products").json()}
    assert listed[fruit["id"]] == "פירות"


def test_a_shelf_that_isnt_drawn_falls_back_to_the_department_and_says_so(admin: TestClient) -> None:
    draw(admin)
    stray = add(admin, name="פטריות", subcategory="פטריות")
    # Produce isn't drawn whole: the fallback is one of its drawn shelves, which the screen shows.
    assert stray["shelf"] in {"ירקות", "פירות"}


def test_a_new_product_routes_shoppers_to_its_own_shelf(admin: TestClient) -> None:
    draw(admin)
    fruit = add(admin, name="ענבים אדומים", subcategory="פירות")
    # The shopper finds it by name, as its own stop...
    hits = admin.get(f"{SHOPPER}/search", params={"q": "ענבים אדומים"}).json()
    target = hits[0]["category_id"]
    assert target == f"product-{fruit['id']}"
    # ...and the route goes to the fruit shelf, not anywhere in produce.
    route = admin.post(f"{SHOPPER}/floor-plan/routes", json={"category_ids": [target]}).json()
    assert [stop["department"] for stop in route["stops"]] == ["פירות"]


def test_moving_a_product_to_another_shelf_moves_the_route(admin: TestClient) -> None:
    draw(admin)
    fruit = add(admin, name="ענבים ירוקים", subcategory="פירות")
    admin.patch(f"{ADMIN}/products/{fruit['id']}", json={"subcategory": "ירקות"})
    route = admin.post(f"{SHOPPER}/floor-plan/routes", json={"category_ids": [f"product-{fruit['id']}"]}).json()
    assert [stop["department"] for stop in route["stops"]] == ["ירקות"]

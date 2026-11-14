"""Where on a long shelf a product stands: a route ends beside its quarter, not the shelf's middle."""

import pytest
from fastapi.testclient import TestClient

from app.domain.floor_routing import SHELF_PARTS, GridRouter, shelf_part_tiles
from app.domain.models import Category
from tests.conftest import ADMIN_TOKEN
from tests.floor_plans import plan_from, plan_payload


def category(id_: str, name: str, shelf_part: int | None = None) -> Category:
    return Category(
        id=id_,
        name=name,
        name_en=id_,
        section_id="unused",
        department_id="beverages",
        subcategory="מים ומיצים",
        shelf_part=shelf_part,
    )


# One shelf twelve tiles long down the middle of the store, an aisle down either side.
STORE = [
    "#######",
    "#.....#",
    "#..w..#",
    "#..w..#",
    "#..w..#",
    "#..w..#",
    "#..w..#",
    "#..w..#",
    "#..w..#",
    "#..w..#",
    "#..w..#",
    "#..w..#",
    "#..w..#",
    "#..w..#",
    "#.....#",
    "E...CC#",
]
SHELF = {(row, 3) for row in range(2, 14)}
CATALOG = {
    "beverages": Category(id="beverages", name="משקאות", name_en="beverages", section_id="unused"),
    "water": category("water", "מים מינרליים", shelf_part=0),
    "juice": category("juice", "מיץ תפוזים", shelf_part=3),
    "soda": category("soda", "סודה"),
}
SUBCATEGORIES = {"beverages": ("מים ומיצים",)}


@pytest.fixture(scope="module")
def router() -> GridRouter:
    return GridRouter(plan_from(STORE, {"w": "מים ומיצים"}))


def stop_of(router: GridRouter, category_id: str) -> tuple[int, int]:
    route = router.plan_route("demo", [category_id], CATALOG, None, SUBCATEGORIES)
    [stop] = route.stops
    assert stop.department == "מים ומיצים"
    return stop.row, stop.col


def test_a_shelf_is_cut_into_quarters_along_its_length() -> None:
    parts = [shelf_part_tiles(sorted(SHELF), part) for part in range(SHELF_PARTS)]
    assert [len(tiles) for tiles in parts] == [3, 3, 3, 3]
    assert {tile for tiles in parts for tile in tiles} == SHELF
    assert parts[0][0] == (2, 3) and parts[3][-1] == (13, 3)
    # Across the plan, from the left: a shelf along the back wall.
    assert shelf_part_tiles([(1, col) for col in range(10, 18)], 3) == ((1, 16), (1, 17))


def test_a_shelf_shorter_than_its_quarters_gives_the_nearest() -> None:
    assert shelf_part_tiles([(1, 5), (1, 6)], 1) == ((1, 5),)
    assert shelf_part_tiles([(1, 5)], 3) == ((1, 5),)


def test_a_product_goes_beside_its_own_quarter(router: GridRouter) -> None:
    water_row, _ = stop_of(router, "water")
    juice_row, _ = stop_of(router, "juice")
    assert 2 <= water_row <= 4
    assert 11 <= juice_row <= 13


def test_without_a_quarter_it_goes_to_the_shelfs_middle_as_before(router: GridRouter) -> None:
    row, _ = stop_of(router, "soda")
    assert 7 <= row <= 8


def test_two_products_in_different_quarters_are_two_stops_in_walking_order(router: GridRouter) -> None:
    route = router.plan_route("demo", ["water", "juice", "soda"], CATALOG, None, SUBCATEGORIES)
    rows = {stop.category_id: stop.row for stop in route.stops}
    assert len(set(rows.values())) == 3
    assert 2 <= rows["water"] <= 4 and 11 <= rows["juice"] <= 13 and 7 <= rows["soda"] <= 8


def test_a_long_shelf_is_never_reached_from_its_end(router: GridRouter) -> None:
    """Its end faces the aisle across the store: stopping there is stopping at the department's door."""
    for category_id in ("water", "juice", "soda"):
        for start in (None, (1, 3), (14, 3)):
            route = router.plan_route("demo", [category_id], CATALOG, start, SUBCATEGORIES)
            [stop] = route.stops
            assert stop.col in (2, 4), (category_id, start, stop.row, stop.col)


def test_a_report_can_stand_at_a_quarter(router: GridRouter) -> None:
    assert router.stop_for("מים ומיצים", 0) != router.stop_for("מים ומיצים", 3)
    assert router.stop_for("מים ומיצים") == stop_of(router, "soda")


# ---- Through the API: a manager says where on the shelf, and the shopper is sent there

ADMIN = "/api/v1/admin/stores/demo"
SHOPPER = "/api/v1/stores/demo"
AUTH = {"Authorization": f"Bearer {ADMIN_TOKEN}"}


@pytest.fixture()
def admin(client: TestClient) -> TestClient:
    client.headers.update(AUTH)
    saved = client.put(f"{SHOPPER}/floor-plan", json=plan_payload(STORE, {"w": "מים ומיצים"}))
    assert saved.status_code == 200, saved.text
    return client


def route_row(client: TestClient, product: dict) -> int:
    stop_id = f"product-{product['id']}"
    route = client.post(f"{SHOPPER}/floor-plan/routes", json={"category_ids": [stop_id]})
    assert route.status_code == 200, route.text
    [stop] = route.json()["stops"]
    return stop["row"]


def test_a_manager_sets_the_quarter_and_the_route_follows(admin: TestClient) -> None:
    created = admin.post(
        f"{ADMIN}/products",
        json={"name": "מים מינרליים בדיקה", "department": "beverages", "subcategory": "מים ומיצים"},
    )
    assert created.status_code == 201, created.text
    product = created.json()
    assert product["shelf_part"] is None
    assert 7 <= route_row(admin, product) <= 8

    changed = admin.patch(f"{ADMIN}/products/{product['id']}", json={"shelf_part": 3}).json()
    assert changed["shelf_part"] == 3
    assert 11 <= route_row(admin, product) <= 13
    stops = admin.get(f"{SHOPPER}/map").json()["product_stops"]
    assert next(stop for stop in stops if stop["id"] == f"product-{product['id']}")["shelf_part"] == 3


def test_moving_to_another_shelf_forgets_the_quarter_unless_it_is_given(admin: TestClient) -> None:
    product = admin.post(
        f"{ADMIN}/products",
        json={"name": "מיץ בדיקה", "department": "beverages", "subcategory": "מים ומיצים", "shelf_part": 1},
    ).json()
    assert product["shelf_part"] == 1

    renamed = admin.patch(f"{ADMIN}/products/{product['id']}", json={"brand": "פריגת"}).json()
    assert renamed["shelf_part"] == 1
    moved = admin.patch(f"{ADMIN}/products/{product['id']}", json={"subcategory": "משקאות קלים"}).json()
    assert moved["shelf_part"] is None
    placed = admin.patch(
        f"{ADMIN}/products/{product['id']}", json={"subcategory": "מים ומיצים", "shelf_part": 2}
    ).json()
    assert placed["shelf_part"] == 2


def test_a_quarter_is_one_of_four(admin: TestClient) -> None:
    product = admin.post(f"{ADMIN}/products", json={"name": "סודה בדיקה", "department": "beverages"}).json()
    assert admin.patch(f"{ADMIN}/products/{product['id']}", json={"shelf_part": 4}).status_code == 422
    assert admin.patch(f"{ADMIN}/products/{product['id']}", json={"shelf_part": -1}).status_code == 422

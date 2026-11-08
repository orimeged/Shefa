"""The floor plan endpoints: saving what the dashboard's editor drew, reading it back, routing on it."""

import copy
import time
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.domain.models import Store
from app.main import create_app
from tests.conftest import ADMIN_TOKEN
from tests.floor_plans import plan_payload

AUTH = {"Authorization": f"Bearer {ADMIN_TOKEN}"}
URL = "/api/v1/stores/demo/floor-plan"

STORE = [
    "##########",
    "#........#",
    "#.dd.bb..#",
    "#........#",
    "#.cc..kk.#",
    "#........#",
    "E......CC#",
]


@pytest.fixture()
def drawing(store: Store) -> dict[str, Any]:
    """Dairy in the catalog's own Hebrew, bakery and coffee in English, and one unknown department."""
    dairy = next(category for category in store.categories if category.id == "dairy")
    return plan_payload(
        STORE,
        {"d": dairy.name, "b": "Bakery", "c": "Coffee & Tea", "k": "קומבוצה"},
    )


def save(client: TestClient, payload: dict[str, Any]) -> Any:
    return client.put(URL, json=payload, headers=AUTH)


def test_a_store_starts_with_no_floor_plan(client: TestClient) -> None:
    response = client.get(URL)
    assert response.status_code == 204
    assert response.content == b""


def test_saving_needs_the_admin_code(client: TestClient, drawing: dict[str, Any]) -> None:
    assert client.put(URL, json=drawing).status_code == 401
    assert client.put(URL, json=drawing, headers={"Authorization": "Bearer guess"}).status_code == 401
    assert client.get(URL).status_code == 204


def test_the_admin_code_is_checked_before_the_drawing(client: TestClient) -> None:
    """A stranger learns nothing from validation messages."""
    assert client.put(URL, json={"nonsense": True}).status_code == 401


def test_a_saved_plan_reads_back_exactly(client: TestClient, drawing: dict[str, Any]) -> None:
    saved = save(client, drawing)
    assert saved.status_code == 200

    body = client.get(URL).json()
    assert body["store_id"] == "demo"
    assert body["floor_plan"]["tiles"] == drawing["tiles"]
    assert body["floor_plan"]["labels"] == drawing["labels"]
    assert body["floor_plan"]["cell_size_m"] == 1.0
    assert body["updated_at"] == saved.json()["updated_at"]
    assert body["updated_at"].endswith(("Z", "+00:00"))


def test_saving_reports_what_the_manager_should_know(
    client: TestClient, drawing: dict[str, Any], store: Store
) -> None:
    check = save(client, drawing).json()["check"]
    dairy_name = next(category.name for category in store.categories if category.id == "dairy")

    assert check["routable"] is True
    assert check["problems"] == []
    linked = {department["label"]: department["category_id"] for department in check["departments"]}
    assert linked == {
        "Bakery": "bakery",
        "Coffee & Tea": "coffee",
        dairy_name: "dairy",
        # Not in the catalog, so no shopper's list can lead there yet.
        "קומבוצה": None,
    }


def test_a_plan_with_no_way_out_is_saved_but_flagged(client: TestClient) -> None:
    payload = plan_payload(["E....", ".....", ".....", ".....", "....."])
    response = save(client, payload)

    assert response.status_code == 200
    assert response.json()["check"] == {"routable": False, "problems": ["no_checkout"], "departments": []}


@pytest.mark.parametrize(
    "spoil",
    [
        lambda p: p.update(version=2),
        lambda p: p.update(rows=4),
        lambda p: p["tiles"].pop(),
        lambda p: p["tiles"][0].__setitem__(0, "lava"),
        lambda p: p["labels"].append({"row": 0, "col": 0, "label": "על הקיר"}),
        lambda p: p.update(extra="field"),
    ],
)
def test_a_broken_drawing_is_refused_and_the_old_one_kept(
    client: TestClient, drawing: dict[str, Any], spoil: Any
) -> None:
    save(client, drawing)
    broken = copy.deepcopy(drawing)
    spoil(broken)

    assert save(client, broken).status_code == 422
    assert client.get(URL).json()["floor_plan"]["tiles"] == drawing["tiles"]


def test_a_new_save_replaces_the_plan_and_its_routes(client: TestClient, drawing: dict[str, Any]) -> None:
    first = save(client, drawing).json()
    before = client.post(f"{URL}/routes", json={"category_ids": ["dairy"]}).json()

    # The dairy shelf moves to the bottom row of shelves.
    moved = plan_payload(
        [row.replace("d", ".").replace("k", "d") for row in STORE],
        {"d": "Dairy & Eggs", "b": "Bakery", "c": "Coffee & Tea"},
    )
    time.sleep(0.01)
    second = save(client, moved).json()
    after = client.post(f"{URL}/routes", json={"category_ids": ["dairy"]}).json()

    assert second["updated_at"] > first["updated_at"]
    assert before["stops"][0]["row"] < after["stops"][0]["row"]
    assert client.get(URL).json()["floor_plan"]["tiles"] == moved["tiles"]


def test_saving_for_an_unknown_store_is_refused(client: TestClient, drawing: dict[str, Any]) -> None:
    response = client.put("/api/v1/stores/nowhere/floor-plan", json=drawing, headers=AUTH)
    assert response.status_code == 404
    assert client.get("/api/v1/stores/nowhere/floor-plan").status_code == 404


def test_a_saved_plan_outlives_a_restart(settings: Settings, drawing: dict[str, Any]) -> None:
    with TestClient(create_app(settings)) as client:
        save(client, drawing)
    with TestClient(create_app(settings)) as client:
        assert client.get(URL).json()["floor_plan"]["tiles"] == drawing["tiles"]
        assert client.post(f"{URL}/routes", json={"category_ids": ["coffee"]}).status_code == 200


def test_the_kiosk_and_phone_map_is_untouched(client: TestClient, drawing: dict[str, Any]) -> None:
    before = client.get("/api/v1/stores/demo/map").json()
    save(client, drawing)
    assert client.get("/api/v1/stores/demo/map").json() == before


# ---------- Routes ----------


def test_a_route_walks_the_drawn_store(client: TestClient, drawing: dict[str, Any]) -> None:
    save(client, drawing)
    response = client.post(f"{URL}/routes", json={"category_ids": ["coffee", "dairy", "frozen"]})

    assert response.status_code == 200
    route = response.json()
    assert route["store_id"] == "demo"
    assert route["start"] == {"row": 6, "col": 0}
    assert {stop["category_id"] for stop in route["stops"]} == {"coffee", "dairy"}
    # Frozen exists in the catalog but isn't drawn.
    assert route["unplaced_category_ids"] == ["frozen"]
    assert len(route["legs"]) == 3
    tiles = drawing["tiles"]
    for leg in route["legs"]:
        assert all(tiles[cell["row"]][cell["col"]] in ("aisle", "entrance") for cell in leg["cells"])
    end = route["end"]
    assert tiles[end["row"]][end["col"] + 1] == "checkout"


def test_a_stop_names_the_department_as_the_manager_drew_it(
    client: TestClient, drawing: dict[str, Any], store: Store
) -> None:
    save(client, drawing)
    route = client.post(f"{URL}/routes", json={"category_ids": ["dairy"]}).json()
    assert route["stops"][0]["department"] == next(c.name for c in store.categories if c.id == "dairy")


def test_a_re_plan_starts_where_the_shopper_stands(client: TestClient, drawing: dict[str, Any]) -> None:
    save(client, drawing)
    route = client.post(
        f"{URL}/routes", json={"category_ids": ["bakery"], "start": {"row": 3, "col": 4}}
    ).json()
    assert route["start"] == {"row": 3, "col": 4}
    assert route["legs"][0]["cells"][0] == {"row": 3, "col": 4}


def test_a_re_plan_from_inside_a_shelf_is_refused(client: TestClient, drawing: dict[str, Any]) -> None:
    save(client, drawing)
    response = client.post(
        f"{URL}/routes", json={"category_ids": ["bakery"], "start": {"row": 2, "col": 2}}
    )
    assert response.status_code == 422


def test_no_plan_no_route(client: TestClient) -> None:
    assert client.post(f"{URL}/routes", json={"category_ids": ["dairy"]}).status_code == 404


def test_a_plan_without_a_checkout_says_why_it_cant_route(client: TestClient) -> None:
    save(client, plan_payload(["E....", ".....", ".....", ".....", "....."]))
    response = client.post(f"{URL}/routes", json={"category_ids": ["dairy"]})
    assert response.status_code == 409
    assert response.json()["detail"] == {"problems": ["no_checkout"]}


@pytest.mark.parametrize(
    "body",
    [{}, {"category_ids": []}, {"category_ids": ["x"] * 51}, {"category_ids": ["dairy"], "extra": 1}],
)
def test_a_malformed_route_request_is_refused(
    client: TestClient, drawing: dict[str, Any], body: dict[str, Any]
) -> None:
    save(client, drawing)
    assert client.post(f"{URL}/routes", json=body).status_code == 422


def test_the_dashboard_on_its_own_domain_may_save(settings: Settings) -> None:
    from dataclasses import replace

    with TestClient(create_app(replace(settings, cors_origins=("https://shefa.vercel.app",)))) as client:
        response = client.options(
            URL,
            headers={
                "origin": "https://shefa.vercel.app",
                "access-control-request-method": "PUT",
                "access-control-request-headers": "authorization, content-type",
            },
        )
    assert response.status_code == 200
    assert "PUT" in response.headers["access-control-allow-methods"]

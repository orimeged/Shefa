import json
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from fastapi.testclient import TestClient
from sqlalchemy import insert, text
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.domain.inventory import LayoutConflictError, StagedItem
from app.main import create_app
from app.repositories.database import create_database_engine, migrate
from app.repositories.inventory_tables import Base, NodeAssignment
from tests.conftest import ADMIN_TOKEN

ADMIN = "/api/v1/admin/stores/demo"
SHOPPER = "/api/v1/stores/demo"
AUTH = {"Authorization": f"Bearer {ADMIN_TOKEN}"}


@pytest.fixture()
def admin(client: TestClient) -> TestClient:
    client.headers.update(AUTH)
    return client


def zone(client: TestClient, section_id: str) -> dict[str, Any]:
    zones = client.get(f"{ADMIN}/nodes").json()
    return next(entry for entry in zones if entry["section_id"] == section_id)


def category(client: TestClient, slug: str) -> dict[str, Any]:
    categories = client.get(f"{ADMIN}/categories").json()
    return next(entry for entry in categories if entry["slug"] == slug)


def items_in(client: TestClient, node_id: int) -> list[dict[str, Any]]:
    return client.get(f"{ADMIN}/nodes/{node_id}/assignments").json()


def add_items(client: TestClient, node_id: int, *items: tuple[str, int]) -> Any:
    body = {"items": [{"name": name, "category_id": cat} for name, cat in items]}
    return client.post(f"{ADMIN}/nodes/{node_id}/assignments/batch", json=body)


def route_to(client: TestClient, *category_ids: str) -> dict[str, Any]:
    response = client.post(f"{SHOPPER}/routes", json={"category_ids": list(category_ids)})
    assert response.status_code == 200
    return response.json()


def first_hit(client: TestClient, query: str) -> dict[str, Any] | None:
    hits = client.get(f"{SHOPPER}/search", params={"q": query}).json()
    return hits[0] if hits else None


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/v1/admin/session"),
        ("get", f"{ADMIN}/nodes"),
        ("get", f"{ADMIN}/nodes/1/assignments"),
        ("post", f"{ADMIN}/nodes/1/assignments/batch"),
        ("delete", f"{ADMIN}/nodes/1/assignments/category/1"),
        ("post", "/api/v1/admin/map-audio?store_id=demo"),
    ],
)
def test_every_admin_route_needs_the_token(client: TestClient, method: str, path: str) -> None:
    assert getattr(client, method)(path).status_code == 401
    wrong = {"Authorization": "Bearer guess"}
    assert getattr(client, method)(path, headers=wrong).status_code == 401


def test_a_valid_token_opens_the_session(client: TestClient) -> None:
    assert client.get("/api/v1/admin/session", headers=AUTH).status_code == 204


def test_no_configured_token_locks_the_dashboard(settings: Settings) -> None:
    with TestClient(create_app(replace(settings, admin_token=None))) as client:
        response = client.get("/api/v1/admin/session", headers={"Authorization": "Bearer "})
        assert response.status_code == 503
        assert client.get("/api/v1/admin/session", headers=AUTH).status_code == 503


def test_every_shelf_face_is_a_zone(admin: TestClient) -> None:
    zones = admin.get(f"{ADMIN}/nodes").json()

    assert len(zones) == 30
    assert {entry["svg_element_id"] for entry in zones} == {
        f"zone-{entry['section_id']}" for entry in zones
    }
    assert len({entry["zone_name"] for entry in zones}) == 30


def test_the_seed_puts_each_department_on_its_shelf(admin: TestClient) -> None:
    dairy = zone(admin, "a5-s2-r")

    assert dairy["item_count"] == 1
    assert dairy["preview"] == category(admin, "dairy")["name"]
    [item] = items_in(admin, dairy["id"])
    assert item["entity_type"] == "category"
    assert item["product_count"] > 0
    assert zone(admin, "a1-s1-r")["item_count"] == 0


def test_moving_a_department_reaches_shoppers_at_once(admin: TestClient) -> None:
    source = zone(admin, "a5-s2-r")
    target = zone(admin, "a1-s1-r")
    dairy = category(admin, "dairy")

    before = route_to(admin, "dairy")["stops"][0]
    response = admin.patch(
        f"{ADMIN}/nodes/{source['id']}/assignments/category/{dairy['id']}",
        json={"to_node_id": target["id"]},
    )

    assert response.status_code == 200
    assert response.json() == []
    after = route_to(admin, "dairy")["stops"][0]
    assert (before["node_id"], before["side"]) == ("a5_s2", "right")
    assert (after["node_id"], after["side"]) == ("a1_s1", "right")
    assert first_hit(admin, "dairy")["aisle_no"] == 1


def test_removing_a_department_stops_sending_shoppers_there(admin: TestClient) -> None:
    node = zone(admin, "a5-s2-r")
    dairy = category(admin, "dairy")

    response = admin.delete(f"{ADMIN}/nodes/{node['id']}/assignments/category/{dairy['id']}")

    assert response.status_code == 204
    hits = admin.get(f"{SHOPPER}/search", params={"q": "dairy"}).json()
    assert "dairy" not in {hit["category_id"] for hit in hits}
    route = route_to(admin, "dairy", "bakery")
    assert route["unplaced_category_ids"] == ["dairy"]
    assert [stop["category_id"] for stop in route["stops"]] == ["bakery"]
    map_ids = {entry["id"] for entry in admin.get(f"{SHOPPER}/map").json()["categories"]}
    assert "dairy" not in map_ids


def test_a_placed_product_is_its_own_stop(admin: TestClient) -> None:
    node = zone(admin, "a1-s1-r")
    snacks = category(admin, "snacks")

    assert add_items(admin, node["id"], ("חטיף גרנולה חדש", snacks["id"])).status_code == 201

    hit = first_hit(admin, "חטיף גרנולה חדש")
    assert hit["category_name"] == "חטיף גרנולה חדש"
    assert (hit["aisle_no"], hit["side"]) == (1, "right")
    assert route_to(admin, hit["category_id"])["stops"][0]["node_id"] == "a1_s1"


def test_a_placed_product_stays_out_of_the_departments_shoppers_browse(admin: TestClient) -> None:
    node = zone(admin, "a1-s1-r")
    add_items(admin, node["id"], ("חטיף גרנולה חדש", category(admin, "snacks")["id"]))

    shopper_map = admin.get(f"{SHOPPER}/map").json()

    assert len(shopper_map["categories"]) == 15
    assert [stop["name"] for stop in shopper_map["product_stops"]] == ["חטיף גרנולה חדש"]


def test_a_placed_product_beats_its_department_on_a_shared_name(admin: TestClient) -> None:
    node = zone(admin, "a1-s1-r")
    product = admin.get(f"{ADMIN}/catalog", params={"q": "קוטג"}).json()[0]
    assert product["entity_type"] == "product"

    admin.post(
        f"{ADMIN}/nodes/{node['id']}/assignments",
        json={"entity_type": "product", "entity_id": product["entity_id"]},
    )

    hit = first_hit(admin, product["name"])
    assert hit["aisle_no"] == 1


def test_an_unplaced_product_stands_with_its_department(admin: TestClient) -> None:
    node = zone(admin, "a1-s1-r")
    product = admin.get(f"{ADMIN}/catalog", params={"q": "קוטג"}).json()[0]
    path = f"{ADMIN}/nodes/{node['id']}/assignments"
    admin.post(path, json={"entity_type": "product", "entity_id": product["entity_id"]})

    admin.delete(f"{path}/product/{product['entity_id']}")

    assert first_hit(admin, product["name"])["category_id"] == "dairy"


def test_a_shopper_goes_to_the_closest_place_a_department_stands(admin: TestClient) -> None:
    dairy = category(admin, "dairy")
    near_entrance = zone(admin, "a1-s1-r")
    admin.post(
        f"{ADMIN}/nodes/{near_entrance['id']}/assignments",
        json={"entity_type": "category", "entity_id": dairy["id"]},
    )

    from_entrance = route_to(admin, "dairy")["stops"][0]
    from_the_far_end = admin.post(
        f"{SHOPPER}/routes", json={"category_ids": ["dairy"], "start_node_id": "a5_s3"}
    ).json()["stops"][0]

    assert from_entrance["node_id"] == "a1_s1"
    assert from_the_far_end["node_id"] == "a5_s2"


def test_a_batch_is_all_or_nothing(admin: TestClient) -> None:
    node = zone(admin, "a1-s1-r")
    snacks = category(admin, "snacks")

    response = add_items(admin, node["id"], ("מוצר טוב", snacks["id"]), ("מוצר רע", 999_999))

    assert response.status_code == 422
    assert items_in(admin, node["id"]) == []
    assert admin.get(f"{ADMIN}/catalog", params={"q": "מוצר טוב"}).json() == []


def test_a_batch_can_be_sent_twice(admin: TestClient) -> None:
    node = zone(admin, "a1-s1-r")
    snacks = category(admin, "snacks")["id"]

    add_items(admin, node["id"], ("מוצר חדש", snacks))
    response = add_items(admin, node["id"], ("מוצר חדש", snacks), ("מוצר  חדש!", snacks))

    assert response.status_code == 201
    assert [item["name"] for item in response.json()] == ["מוצר חדש"]
    assert len(admin.get(f"{ADMIN}/catalog", params={"q": "מוצר חדש"}).json()) == 1


def test_a_department_named_in_a_batch_means_the_department(admin: TestClient) -> None:
    node = zone(admin, "a1-s1-r")
    snacks = category(admin, "snacks")

    response = add_items(admin, node["id"], (snacks["name"], snacks["id"]))

    assert response.json()[0]["entity_type"] == "category"


def test_a_known_product_takes_the_approved_category(admin: TestClient) -> None:
    node = zone(admin, "a1-s1-r")
    product = admin.get(f"{ADMIN}/catalog", params={"q": "קוטג"}).json()[0]
    snacks = category(admin, "snacks")

    response = add_items(admin, node["id"], (product["name"], snacks["id"]))

    assert response.json()[0]["category_name"] == snacks["name"]


def test_a_name_with_no_letters_is_refused(admin: TestClient) -> None:
    node = zone(admin, "a1-s1-r")

    response = add_items(admin, node["id"], ("?!", category(admin, "snacks")["id"]))

    assert response.status_code == 422


def test_two_managers_saving_at_once_both_succeed(admin: TestClient) -> None:
    node = zone(admin, "a1-s1-r")
    snacks = category(admin, "snacks")["id"]
    inventory = admin.app.state.inventory
    item = StagedItem(name="מוצר משותף", category_id=snacks)
    version = inventory.version("demo")

    with ThreadPoolExecutor(max_workers=8) as pool:
        saves = [
            pool.submit(inventory.assign_batch, "demo", node["id"], [item]) for _ in range(16)
        ]
        results = [save.result() for save in saves]

    assert all(len(result) == 1 for result in results)
    assert inventory.version("demo") == version + 16
    assert len(items_in(admin, node["id"])) == 1


def test_moving_to_the_same_zone_changes_nothing(admin: TestClient) -> None:
    node = zone(admin, "a5-s2-r")
    dairy = category(admin, "dairy")

    response = admin.patch(
        f"{ADMIN}/nodes/{node['id']}/assignments/category/{dairy['id']}",
        json={"to_node_id": node["id"]},
    )

    assert [item["entity_id"] for item in response.json()] == [dairy["id"]]


def test_moving_onto_a_zone_that_has_it_already_merges(admin: TestClient) -> None:
    source = zone(admin, "a5-s2-r")
    target = zone(admin, "a1-s1-r")
    dairy = category(admin, "dairy")
    body = {"entity_type": "category", "entity_id": dairy["id"]}
    admin.post(f"{ADMIN}/nodes/{target['id']}/assignments", json=body)

    response = admin.patch(
        f"{ADMIN}/nodes/{source['id']}/assignments/category/{dairy['id']}",
        json={"to_node_id": target["id"]},
    )

    assert response.status_code == 200
    assert len(items_in(admin, target["id"])) == 1


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", f"{ADMIN}/nodes/999999/assignments", None),
        ("get", "/api/v1/admin/stores/nope/nodes", None),
        ("delete", f"{ADMIN}/nodes/1/assignments/product/999999", None),
        ("patch", f"{ADMIN}/nodes/1/assignments/product/999999", {"to_node_id": 2}),
        ("post", f"{ADMIN}/nodes/1/assignments", {"entity_type": "product", "entity_id": 999999}),
    ],
)
def test_unknown_references_are_404(
    admin: TestClient, method: str, path: str, body: dict[str, Any] | None
) -> None:
    arguments = {"json": body} if body else {}
    assert getattr(admin, method)(path, **arguments).status_code == 404


def test_an_unknown_entity_type_is_rejected(admin: TestClient) -> None:
    response = admin.post(
        f"{ADMIN}/nodes/1/assignments", json={"entity_type": "brand", "entity_id": 1}
    )

    assert response.status_code == 422


def test_the_catalog_lists_departments_first(admin: TestClient) -> None:
    entries = admin.get(f"{ADMIN}/catalog", params={"q": "חלב"}).json()

    assert entries[0]["entity_type"] == "category"


def test_a_search_for_a_wildcard_is_taken_literally(admin: TestClient) -> None:
    assert admin.get(f"{ADMIN}/catalog", params={"q": "%"}).json() == []


@pytest.fixture()
def two_stores(settings: Settings, tmp_path: Path) -> Iterator[TestClient]:
    data = tmp_path / "data"
    (data / "semantic").mkdir(parents=True)
    source = json.loads((settings.data_dir / "demo_store.json").read_text(encoding="utf-8"))
    for store_id in ("demo", "other"):
        path = data / f"{store_id}.json"
        path.write_text(json.dumps({**source, "id": store_id}), encoding="utf-8")
    dictionary = settings.data_dir / "semantic" / "food_terms.json"
    (data / "semantic" / "food_terms.json").write_text(
        dictionary.read_text(encoding="utf-8"), encoding="utf-8"
    )
    with TestClient(create_app(replace(settings, data_dir=data))) as client:
        client.headers.update(AUTH)
        yield client


def test_one_store_cant_reach_anothers_zones_or_catalog(two_stores: TestClient) -> None:
    other = "/api/v1/admin/stores/other"
    their_zone = two_stores.get(f"{other}/nodes").json()[0]
    their_snacks = next(
        entry
        for entry in two_stores.get(f"{other}/categories").json()
        if entry["slug"] == "snacks"
    )
    ours = zone(two_stores, "a1-s1-r")

    assert two_stores.get(f"{ADMIN}/nodes/{their_zone['id']}/assignments").status_code == 404
    response = two_stores.post(
        f"{ADMIN}/nodes/{ours['id']}/assignments",
        json={"entity_type": "category", "entity_id": their_snacks["id"]},
    )
    assert response.status_code == 404
    assert add_items(two_stores, ours["id"], ("מוצר", their_snacks["id"])).status_code == 422


def test_a_change_to_one_store_leaves_the_other_alone(two_stores: TestClient) -> None:
    zones = two_stores.get(f"{ADMIN}/nodes").json()
    dairy_zone = next(entry for entry in zones if entry["section_id"] == "a5-s2-r")
    dairy = category(two_stores, "dairy")
    two_stores.delete(f"{ADMIN}/nodes/{dairy_zone['id']}/assignments/category/{dairy['id']}")

    hits = two_stores.get("/api/v1/stores/other/search", params={"q": "dairy"}).json()

    assert hits


def test_managers_work_survives_a_restart(settings: Settings) -> None:
    with TestClient(create_app(settings)) as first:
        first.headers.update(AUTH)
        node = zone(first, "a1-s1-r")
        add_items(first, node["id"], ("מוצר חדש", category(first, "snacks")["id"]))

    with TestClient(create_app(settings)) as second:
        second.headers.update(AUTH)
        assert [item["name"] for item in items_in(second, node["id"])] == ["מוצר חדש"]
        assert len(second.get(f"{ADMIN}/nodes").json()) == 30
        assert first_hit(second, "מוצר חדש")["aisle_no"] == 1


def test_a_floor_plan_cant_silently_erase_a_stocked_zone(settings: Settings, tmp_path: Path) -> None:
    data = tmp_path / "data"
    (data / "semantic").mkdir(parents=True)
    plan = json.loads((settings.data_dir / "demo_store.json").read_text(encoding="utf-8"))
    (data / "demo.json").write_text(json.dumps(plan), encoding="utf-8")
    dictionary = settings.data_dir / "semantic" / "food_terms.json"
    (data / "semantic" / "food_terms.json").write_text(
        dictionary.read_text(encoding="utf-8"), encoding="utf-8"
    )
    updated = replace(settings, data_dir=data)
    with TestClient(create_app(updated)):
        pass

    plan["sections"] = [entry for entry in plan["sections"] if entry["id"] != "a5-s2-r"]
    plan["categories"] = [entry for entry in plan["categories"] if entry["id"] != "dairy"]
    plan["products"] = [entry for entry in plan["products"] if entry["category_id"] != "dairy"]
    (data / "demo.json").write_text(json.dumps(plan), encoding="utf-8")

    with pytest.raises(LayoutConflictError, match="a5-s2-r"):
        with TestClient(create_app(updated)):
            pass


def test_an_empty_zone_can_leave_the_floor_plan(settings: Settings, tmp_path: Path) -> None:
    data = tmp_path / "data"
    (data / "semantic").mkdir(parents=True)
    plan = json.loads((settings.data_dir / "demo_store.json").read_text(encoding="utf-8"))
    (data / "demo.json").write_text(json.dumps(plan), encoding="utf-8")
    dictionary = settings.data_dir / "semantic" / "food_terms.json"
    (data / "semantic" / "food_terms.json").write_text(
        dictionary.read_text(encoding="utf-8"), encoding="utf-8"
    )
    updated = replace(settings, data_dir=data)
    with TestClient(create_app(updated)):
        pass

    plan["sections"] = [entry for entry in plan["sections"] if entry["id"] != "a1-s1-r"]
    (data / "demo.json").write_text(json.dumps(plan), encoding="utf-8")

    with TestClient(create_app(updated)) as client:
        client.headers.update(AUTH)
        assert len(client.get(f"{ADMIN}/nodes").json()) == 29


def test_navigation_is_only_rebuilt_when_inventory_changes(admin: TestClient) -> None:
    registry = admin.app.state.stores

    first = registry.get("demo")
    assert registry.get("demo") is first

    node = zone(admin, "a1-s1-r")
    add_items(admin, node["id"], ("מוצר חדש", category(admin, "snacks")["id"]))

    assert registry.get("demo") is not first


def test_a_failed_save_doesnt_force_a_rebuild(admin: TestClient) -> None:
    registry = admin.app.state.stores
    first = registry.get("demo")

    add_items(admin, zone(admin, "a1-s1-r")["id"], ("מוצר", 999_999))

    assert registry.get("demo") is first


def test_migrations_build_exactly_the_tables_the_code_expects(tmp_path: Path) -> None:
    engine = create_database_engine(f"sqlite:///{(tmp_path / 'fresh.sqlite3').as_posix()}")
    migrate(engine)

    with engine.connect() as connection:
        differences = compare_metadata(MigrationContext.configure(connection), Base.metadata)

    assert differences == []


def test_migrating_twice_is_harmless(tmp_path: Path) -> None:
    engine = create_database_engine(f"sqlite:///{(tmp_path / 'fresh.sqlite3').as_posix()}")
    migrate(engine)
    migrate(engine)


@pytest.fixture()
def database(tmp_path: Path) -> Any:
    engine = create_database_engine(f"sqlite:///{(tmp_path / 'fresh.sqlite3').as_posix()}")
    migrate(engine)
    return engine


def test_the_database_refuses_an_assignment_to_no_zone(database: Any) -> None:
    from datetime import UTC, datetime

    row = {
        "node_id": 12345,
        "entity_type": "product",
        "entity_id": 1,
        "assigned_at": datetime.now(UTC),
    }
    with pytest.raises(IntegrityError), database.begin() as connection:
        connection.execute(insert(NodeAssignment), row)


def test_the_database_refuses_an_unknown_entity_type(database: Any) -> None:
    with database.begin() as connection:
        connection.execute(text("PRAGMA foreign_keys=OFF"))
    with pytest.raises(IntegrityError), database.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO node_assignments VALUES (1, 'brand', 1, '2026-11-01 00:00:00')"
            )
        )


def relocate(admin: TestClient, node_id: int, product_id: int) -> Any:
    return admin.post(
        f"{ADMIN}/nodes/{node_id}/assignments",
        json={"entity_type": "product", "entity_id": product_id, "relocate": True},
    )


def place_product(admin: TestClient, section_id: str, query: str = "קוטג") -> tuple[int, int]:
    """Gives a catalog product its own zone, and returns the zone and the product."""
    node = zone(admin, section_id)
    product = admin.get(f"{ADMIN}/catalog", params={"q": query}).json()[0]
    admin.post(
        f"{ADMIN}/nodes/{node['id']}/assignments",
        json={"entity_type": "product", "entity_id": product["entity_id"]},
    )
    return node["id"], product["entity_id"]


def test_relocating_takes_a_product_off_its_old_shelf(admin: TestClient) -> None:
    old_node, product_id = place_product(admin, "a1-s1-r")
    new_node = zone(admin, "a4-s1-l")["id"]

    response = relocate(admin, new_node, product_id)

    assert response.status_code == 201
    assert items_in(admin, old_node) == []
    assert [item["entity_id"] for item in items_in(admin, new_node)] == [product_id]


def test_without_relocating_a_product_stands_in_both_places(admin: TestClient) -> None:
    old_node, product_id = place_product(admin, "a1-s1-r")
    new_node = zone(admin, "a4-s1-l")["id"]

    admin.post(
        f"{ADMIN}/nodes/{new_node}/assignments",
        json={"entity_type": "product", "entity_id": product_id},
    )

    assert len(items_in(admin, old_node)) == 1
    assert len(items_in(admin, new_node)) == 1


def test_a_relocated_product_stops_being_routed_to_the_old_shelf(admin: TestClient) -> None:
    _, product_id = place_product(admin, "a1-s1-r")
    far_node = zone(admin, "a5-s3-l")["id"]

    relocate(admin, far_node, product_id)

    stop = f"product-{product_id}"
    assert route_to(admin, stop)["stops"][0]["node_id"] == "a5_s3"


def test_relocating_onto_its_own_shelf_keeps_it_there(admin: TestClient) -> None:
    node, product_id = place_product(admin, "a1-s1-r")

    relocate(admin, node, product_id)

    assert len(items_in(admin, node)) == 1


def test_a_product_can_move_out_of_its_department_by_name(admin: TestClient) -> None:
    node = zone(admin, "a4-s1-l")
    dairy = category(admin, "dairy")
    product = admin.get(f"{ADMIN}/catalog", params={"q": "קוטג"}).json()[0]

    response = admin.post(
        f"{ADMIN}/nodes/{node['id']}/assignments/batch",
        json={
            "items": [{"name": product["name"], "category_id": dairy["id"]}],
            "relocate": True,
        },
    )

    assert response.status_code == 201
    assert first_hit(admin, product["name"])["aisle_no"] == 4
    assert first_hit(admin, "dairy")["aisle_no"] == 5


def test_a_relocated_batch_clears_the_old_shelf(admin: TestClient) -> None:
    old_node, product_id = place_product(admin, "a1-s1-r")
    name = items_in(admin, old_node)[0]["name"]
    new_node = zone(admin, "a4-s1-l")["id"]

    admin.post(
        f"{ADMIN}/nodes/{new_node}/assignments/batch",
        json={
            "items": [{"name": name, "category_id": category(admin, "dairy")["id"]}],
            "relocate": True,
        },
    )

    assert items_in(admin, old_node) == []


def test_relocating_never_pulls_a_department_off_its_shelf(admin: TestClient) -> None:
    dairy = category(admin, "dairy")
    home = zone(admin, "a5-s2-r")["id"]
    other = zone(admin, "a1-s1-r")["id"]

    admin.post(
        f"{ADMIN}/nodes/{other}/assignments",
        json={"entity_type": "category", "entity_id": dairy["id"], "relocate": True},
    )
    admin.post(
        f"{ADMIN}/nodes/{other}/assignments/batch",
        json={"items": [{"name": dairy["name"], "category_id": dairy["id"]}], "relocate": True},
    )

    assert [item["entity_id"] for item in items_in(admin, home)] == [dairy["id"]]


def test_relocating_a_product_of_another_store_is_refused(two_stores: TestClient) -> None:
    other = "/api/v1/admin/stores/other"
    theirs = two_stores.get(f"{other}/catalog", params={"q": "קוטג"}).json()[0]
    ours = zone(two_stores, "a1-s1-r")

    response = relocate(two_stores, ours["id"], theirs["entity_id"])

    assert response.status_code == 404

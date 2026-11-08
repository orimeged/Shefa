from collections.abc import Sequence
from typing import Any

import pytest
from fastapi.testclient import TestClient

import seed_demo_data
from app.domain.inventory import CatalogRow, InvalidItemError
from app.domain.models import Store
from app.repositories.inventory_repository import SqlInventoryRepository
from app.services.pos_import import ean13_is_valid, parse_pos_export, read_pos_export
from tests.conftest import ADMIN_TOKEN

ADMIN = "/api/v1/admin/stores/demo"
SHOPPER = "/api/v1/stores/demo"
AUTH = {"Authorization": f"Bearer {ADMIN_TOKEN}"}
HEADER = "barcode,department,subcategory,brand,item,size,zone\n"
GOOD_LINE = "7290000000015,produce,ירקות,מהדרין,עגבניות שרי,500 גרם,a1-s1-l\n"


def row(barcode: str = "7290000000015", **overrides: str) -> CatalogRow:
    values = {
        "barcode": barcode,
        "department": "snacks",
        "subcategory": "חטיפים מלוחים",
        "brand": "אסם",
        "item": "במבה",
        "size": "80 גרם",
        "zone": "a1-s1-r",
        **overrides,
    }
    return CatalogRow(**values)


def inventory(client: TestClient) -> SqlInventoryRepository:
    return client.app.state.inventory


def zone_id(client: TestClient, section: str) -> int:
    zones = client.get(f"{ADMIN}/nodes", headers=AUTH).json()
    return next(zone["id"] for zone in zones if zone["section_id"] == section)


def items_in(client: TestClient, section: str) -> list[dict[str, Any]]:
    url = f"{ADMIN}/nodes/{zone_id(client, section)}/assignments"
    return client.get(url, headers=AUTH).json()


def names_in(client: TestClient, section: str) -> list[str]:
    return [item["name"] for item in items_in(client, section)]


def catalog_ids(client: TestClient, query: str) -> Sequence[int]:
    url = f"{ADMIN}/catalog"
    entries = client.get(url, params={"q": query}, headers=AUTH).json()
    return [entry["entity_id"] for entry in entries if entry["entity_type"] == "product"]


# ---- Reading the file


@pytest.mark.parametrize(
    ("code", "valid"),
    [
        ("7290000000015", True),
        ("7290000000016", False),
        ("7290000000000", False),
        ("729000000001", False),
        ("72900000000155", False),
        ("72900000abc15", False),
        ("٧٢٩٠٠٠٠٠٠٠٠١٥", False),
    ],
)
def test_ean13_check_digit(code: str, valid: bool) -> None:
    assert ean13_is_valid(code) is valid


def test_reads_a_line_into_its_parts() -> None:
    [parsed] = parse_pos_export(HEADER + GOOD_LINE)

    assert parsed.display_name == "עגבניות שרי מהדרין 500 גרם"
    assert (parsed.department, parsed.zone) == ("produce", "a1-s1-l")


def test_an_excel_export_with_a_byte_order_mark_reads_the_same() -> None:
    assert len(parse_pos_export("﻿" + HEADER + GOOD_LINE)) == 1


def test_a_missing_column_is_named() -> None:
    with pytest.raises(InvalidItemError, match="zone"):
        parse_pos_export("barcode,department,subcategory,brand,item,size\n")


@pytest.mark.parametrize(
    ("line", "message"),
    [
        ("7290000000016,produce,ירקות,מהדרין,עגבניות,1 קילו,a1-s1-l\n", "Line 3.*EAN-13"),
        (",produce,ירקות,מהדרין,עגבניות,1 קילו,a1-s1-l\n", "Line 3.*barcode"),
        ("7290000000022,produce,ירקות,,עגבניות,1 קילו,a1-s1-l\n", "Line 3.*brand"),
        ("7290000000015,produce,ירקות,מהדרין,אחר,1 קילו,a1-s1-l\n", "Line 3.*barcode appears twice"),
        ("7290000000022,produce,ירקות,מהדרין,עגבניות שרי,500 גרם,a1-s1-l\n", "Line 3.*item appears twice"),
    ],
)
def test_a_bad_line_is_reported_by_number(line: str, message: str) -> None:
    with pytest.raises(InvalidItemError, match=message):
        parse_pos_export(HEADER + GOOD_LINE + line)


# ---- The demo export


@pytest.fixture(scope="module")
def export() -> list[CatalogRow]:
    return read_pos_export(seed_demo_data.POS_EXPORT)


def test_the_demo_export_is_deep_enough_to_look_real(export: list[CatalogRow]) -> None:
    assert len(export) >= 200
    assert len({row.brand for row in export}) >= 50
    assert len({row.subcategory for row in export}) >= 25


def test_the_demo_export_stocks_every_zone(export: list[CatalogRow], store: Store) -> None:
    assert {row.zone for row in export} == {section.id for section in store.sections}


def test_every_department_has_shelves_of_its_own(export: list[CatalogRow], store: Store) -> None:
    subcategories: dict[str, set[str]] = {}
    for line in export:
        subcategories.setdefault(line.department, set()).add(line.subcategory)

    assert set(subcategories) == {category.id for category in store.categories}
    assert all(len(shelves) >= 2 for shelves in subcategories.values())


def test_seeded_reports_name_real_catalog_items(export: list[CatalogRow]) -> None:
    names = {line.display_name: line.department for line in export}
    tallies = (
        *seed_demo_data.PROBLEM_REPORTS,
        *seed_demo_data.BACKGROUND_REPORTS,
        *seed_demo_data.PREVIOUS_WEEK_REPORTS,
    )

    for department, item, _ in tallies:
        assert names.get(item) == department, item


# ---- Importing


def test_an_imported_item_stands_on_its_shelf(client: TestClient) -> None:
    inventory(client).import_catalog("demo", [row()])

    [item] = items_in(client, "a1-s1-r")

    assert item["name"] == "במבה אסם 80 גרם"
    assert item["barcode"] == "7290000000015"
    assert item["subcategory"] == "חטיפים מלוחים"
    assert item["category_name"] == "חטיפים וממתקים"


def test_shoppers_find_an_imported_item_where_it_stands(client: TestClient) -> None:
    inventory(client).import_catalog("demo", [row()])

    hit = client.get(f"{SHOPPER}/search", params={"q": "במבה אסם"}).json()[0]

    assert (hit["aisle_no"], hit["side"]) == (1, "right")


def test_importing_twice_changes_nothing(client: TestClient) -> None:
    inventory(client).import_catalog("demo", [row()])
    before = catalog_ids(client, "במבה אסם")

    inventory(client).import_catalog("demo", [row()])

    assert catalog_ids(client, "במבה אסם") == before
    assert len(items_in(client, "a1-s1-r")) == 1


def test_a_new_export_updates_an_item_by_barcode(client: TestClient) -> None:
    inventory(client).import_catalog("demo", [row()])
    before = catalog_ids(client, "במבה אסם")

    inventory(client).import_catalog("demo", [row(size="200 גרם", zone="a2-s2-l")])

    assert catalog_ids(client, "במבה אסם") == before
    assert names_in(client, "a2-s2-l") == ["במבה אסם 200 גרם"]
    assert names_in(client, "a1-s1-r") == []


def test_an_item_gone_from_the_export_leaves_the_store(client: TestClient) -> None:
    other = row("7290000000022", item="ביסלי")
    inventory(client).import_catalog("demo", [row(), other])

    inventory(client).import_catalog("demo", [other])

    assert names_in(client, "a1-s1-r") == ["ביסלי אסם 80 גרם"]
    assert catalog_ids(client, "במבה אסם") == []


def test_a_bad_export_changes_nothing(client: TestClient) -> None:
    registry = client.app.state.stores
    before = registry.get("demo")
    bad = row("7290000000022", item="ביסלי", department="garden")

    with pytest.raises(InvalidItemError, match="garden"):
        inventory(client).import_catalog("demo", [row(), bad])

    assert catalog_ids(client, "במבה אסם") == []
    assert registry.get("demo") is before


def test_an_unknown_zone_is_refused(client: TestClient) -> None:
    with pytest.raises(InvalidItemError, match="nowhere"):
        inventory(client).import_catalog("demo", [row(zone="nowhere")])


def test_a_product_a_manager_named_is_adopted_not_doubled(client: TestClient) -> None:
    snacks = next(
        category
        for category in client.get(f"{ADMIN}/categories", headers=AUTH).json()
        if category["slug"] == "snacks"
    )
    client.post(
        f"{ADMIN}/nodes/{zone_id(client, 'a2-s2-l')}/assignments/batch",
        json={"items": [{"name": "במבה אסם 80 גרם", "category_id": snacks["id"]}]},
        headers=AUTH,
    )

    inventory(client).import_catalog("demo", [row()])

    assert len(catalog_ids(client, "במבה אסם")) == 1
    assert names_in(client, "a2-s2-l") == []


def test_a_product_only_a_manager_added_survives_imports(client: TestClient) -> None:
    snacks = next(
        category
        for category in client.get(f"{ADMIN}/categories", headers=AUTH).json()
        if category["slug"] == "snacks"
    )
    client.post(
        f"{ADMIN}/nodes/{zone_id(client, 'a2-s2-l')}/assignments/batch",
        json={"items": [{"name": "מוצר של מנהל", "category_id": snacks["id"]}]},
        headers=AUTH,
    )

    inventory(client).import_catalog("demo", [row()])
    inventory(client).import_catalog("demo", [])

    assert names_in(client, "a2-s2-l") == ["מוצר של מנהל"]


def test_placeholders_retire_unless_a_manager_placed_them(
    client: TestClient, store: Store
) -> None:
    placed = client.get(f"{ADMIN}/catalog", params={"q": "קוטג"}, headers=AUTH).json()[0]
    client.post(
        f"{ADMIN}/nodes/{zone_id(client, 'a2-s2-l')}/assignments",
        json={"entity_type": "product", "entity_id": placed["entity_id"]},
        headers=AUTH,
    )

    inventory(client).import_catalog(
        "demo", [row()], retire_barcodes={product.barcode for product in store.products}
    )

    assert catalog_ids(client, "קורנפלקס") == []
    assert catalog_ids(client, "קוטג") == [placed["entity_id"]]


def test_removing_the_import_brings_the_placeholders_back(
    client: TestClient, store: Store
) -> None:
    repository = inventory(client)
    repository.import_catalog(
        "demo", [row()], retire_barcodes={product.barcode for product in store.products}
    )

    repository.remove_imported_catalog(store)

    assert catalog_ids(client, "במבה אסם") == []
    assert names_in(client, "a1-s1-r") == []
    assert catalog_ids(client, "קורנפלקס")


# ---- Zone labels


def test_a_zone_is_labelled_with_its_department(client: TestClient) -> None:
    zones = client.get(f"{ADMIN}/nodes", headers=AUTH).json()

    dairy = next(zone for zone in zones if zone["section_id"] == "a5-s2-r")

    assert dairy["preview"] == "מוצרי חלב וביצים"
    assert dairy["preview_en"] == "Dairy & Eggs"


def test_a_zone_of_only_products_is_labelled_with_their_department(client: TestClient) -> None:
    inventory(client).import_catalog("demo", [row()])
    zones = client.get(f"{ADMIN}/nodes", headers=AUTH).json()

    shelf = next(zone for zone in zones if zone["section_id"] == "a1-s1-r")

    assert shelf["preview"] == "חטיפים וממתקים"


def test_a_department_outranks_a_product_on_the_label(client: TestClient) -> None:
    inventory(client).import_catalog("demo", [row(zone="a5-s2-r")])
    zones = client.get(f"{ADMIN}/nodes", headers=AUTH).json()

    dairy = next(zone for zone in zones if zone["section_id"] == "a5-s2-r")

    assert dairy["preview"] == "מוצרי חלב וביצים"
    assert dairy["item_count"] == 2


def test_an_empty_zone_has_no_label(client: TestClient) -> None:
    zones = client.get(f"{ADMIN}/nodes", headers=AUTH).json()

    assert next(zone for zone in zones if zone["section_id"] == "a1-s1-r")["preview"] is None


def test_the_store_map_is_compressed_once_it_grows(
    client: TestClient, export: list[CatalogRow]
) -> None:
    inventory(client).import_catalog("demo", export)

    response = client.get(f"{SHOPPER}/map", headers={"Accept-Encoding": "gzip"})

    assert response.headers["content-encoding"] == "gzip"
    assert len(response.json()["product_stops"]) == len(export)

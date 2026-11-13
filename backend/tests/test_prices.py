"""Shelf prices: in the POS export, typed by a manager, and from a chain's published price file."""

import gzip
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.domain.inventory import InvalidItemError
from app.services.pos_import import parse_pos_export, shekels_to_agorot
from app.services.price_file import PriceFileError, parse_price_file
from tests.conftest import ADMIN_TOKEN

ADMIN = "/api/v1/admin/stores/demo"
AUTH = {"Authorization": f"Bearer {ADMIN_TOKEN}"}

HEADER = "barcode,department,subcategory,brand,item,size,zone"
LINE = "7290000000015,snacks,חטיפים מלוחים,אסם,במבה,80 גרם,a1-s1-r"

# The three wrappers chains use, as the open parsers of these files have met them.
ITEMS_LAYOUT = """<?xml version="1.0" encoding="utf-8"?>
<Root><ChainId>7290027600007</ChainId><StoreId>001</StoreId>
  <Items Count="2">
    <Item><ItemCode>7290000000015</ItemCode><ItemName>במבה 80 גרם</ItemName><ItemPrice>5.90</ItemPrice></Item>
    <Item><ItemCode>7290000002200</ItemCode><ItemName>חלב 3%</ItemName><ItemPrice>7.10</ItemPrice></Item>
  </Items>
</Root>"""
PRODUCTS_LAYOUT = """<root><Products>
  <Product><itemcode>7290000000015</itemcode><itemprice>6.20</itemprice></Product>
</Products></root>"""
DETAILS_LAYOUT = """<Root><Details>
  <Line><ItemCode>12345678905</ItemCode><ItemPrice>6.50</ItemPrice></Line>
  <Line><ItemCode>123</ItemCode><ItemPrice>not a price</ItemPrice></Line>
</Details></Root>"""


@pytest.fixture()
def admin(client: TestClient) -> TestClient:
    client.headers.update(AUTH)
    return client


def add(client: TestClient, **fields: Any) -> dict[str, Any]:
    response = client.post(f"{ADMIN}/products", json={"department": "produce", **fields})
    assert response.status_code == 201, response.text
    return response.json()


# ---- Reading prices


@pytest.mark.parametrize(
    ("text", "agorot"),
    [("7.10", 710), ("7.1", 710), ("7", 700), ("₪12.90", 1290), (" 1,299.00 ", 129900), ("0", 0)],
)
def test_shekels_read_as_agorot(text: str, agorot: int) -> None:
    assert shekels_to_agorot(text) == agorot


@pytest.mark.parametrize("text", ["", "abc", "-3", "7.105", "nan", "inf"])
def test_what_isnt_a_price_reads_as_none(text: str) -> None:
    assert shekels_to_agorot(text) is None


def test_a_pos_export_may_carry_a_price_column() -> None:
    [row] = parse_pos_export(f"{HEADER},price\n{LINE},5.90\n")
    assert row.price_agorot == 590


def test_a_pos_export_without_prices_still_imports() -> None:
    [row] = parse_pos_export(f"{HEADER}\n{LINE}\n")
    assert row.price_agorot is None


def test_a_blank_price_is_no_price_and_a_bad_one_names_its_line() -> None:
    [row] = parse_pos_export(f"{HEADER},price\n{LINE},\n")
    assert row.price_agorot is None
    with pytest.raises(InvalidItemError, match="Line 2: not a price"):
        parse_pos_export(f"{HEADER},price\n{LINE},five\n")


def test_a_price_file_reads_in_every_chains_layout() -> None:
    items = parse_price_file(ITEMS_LAYOUT.encode())
    assert [(line.barcode, line.price_agorot) for line in items] == [
        ("7290000000015", 590),
        ("7290000002200", 710),
    ]
    assert items[0].name == "במבה 80 גרם"
    assert [(line.barcode, line.price_agorot) for line in parse_price_file(PRODUCTS_LAYOUT.encode())] == [
        ("7290000000015", 620)
    ]


def test_a_bad_row_is_skipped_not_fatal() -> None:
    lines = parse_price_file(DETAILS_LAYOUT.encode())
    assert [(line.barcode, line.price_agorot) for line in lines] == [("12345678905", 650)]


def test_a_gzipped_price_file_reads_the_same() -> None:
    assert parse_price_file(gzip.compress(ITEMS_LAYOUT.encode())) == parse_price_file(ITEMS_LAYOUT.encode())


@pytest.mark.parametrize(
    "data",
    [b"", b"not xml at all", b"<Root><Items></Items></Root>", b"\x1f\x8bbroken"],
)
def test_what_isnt_a_price_file_is_refused(data: bytes) -> None:
    with pytest.raises(PriceFileError):
        parse_price_file(data)


def test_a_price_file_cant_expand_entities() -> None:
    bomb = b"""<?xml version="1.0"?>
<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]>
<Root><Items><Item><ItemCode>1</ItemCode><ItemPrice>&lol2;</ItemPrice></Item></Items></Root>"""
    with pytest.raises(Exception):
        parse_price_file(bomb)


# ---- Prices in the catalog


def test_a_manager_types_a_price_and_can_clear_it(admin: TestClient) -> None:
    created = add(admin, name="תפוחי עץ גאלה", price_agorot=1290)
    assert created["price_agorot"] == 1290
    assert created["price_updated_at"] is not None

    changed = admin.patch(f"{ADMIN}/products/{created['id']}", json={"price_agorot": 1190}).json()
    assert changed["price_agorot"] == 1190

    cleared = admin.patch(f"{ADMIN}/products/{created['id']}", json={"price_agorot": None}).json()
    assert cleared["price_agorot"] is None
    assert cleared["price_updated_at"] is None


def test_a_price_must_be_a_sane_number_of_agorot(admin: TestClient) -> None:
    for price in (-1, 10_000_001, "cheap"):
        response = admin.post(f"{ADMIN}/products", json={"name": "x", "department": "produce", "price_agorot": price})
        assert response.status_code == 422


def test_editing_something_else_leaves_the_price(admin: TestClient) -> None:
    created = add(admin, name="מלפפון", price_agorot=690)
    changed = admin.patch(f"{ADMIN}/products/{created['id']}", json={"brand": "מהדרין"}).json()
    assert changed["price_agorot"] == 690
    assert changed["price_updated_at"] == created["price_updated_at"]


# ---- Uploading a chain's price file


def test_the_price_file_needs_the_managers_token(client: TestClient) -> None:
    assert client.post(f"{ADMIN}/prices", content=ITEMS_LAYOUT.encode()).status_code == 401


def test_a_price_file_sets_prices_by_barcode(admin: TestClient) -> None:
    bamba = add(admin, name="במבה", barcode="7290000000015", department="snacks")
    milk = add(admin, name="חלב", barcode="7290000002200", department="dairy", price_agorot=700)
    other = add(admin, name="ללא ברקוד", price_agorot=100)

    response = admin.post(f"{ADMIN}/prices", content=gzip.compress(ITEMS_LAYOUT.encode()))

    assert response.status_code == 200, response.text
    result = response.json()
    assert (result["lines"], result["matched"], result["updated"]) == (2, 2, 2)
    products = {row["id"]: row for row in admin.get(f"{ADMIN}/products").json()}
    assert products[bamba["id"]]["price_agorot"] == 590
    assert products[milk["id"]]["price_agorot"] == 710
    assert products[other["id"]]["price_agorot"] == 100
    assert result["products_without_price"] == sum(1 for row in products.values() if row["price_agorot"] is None)


def test_barcodes_match_with_or_without_leading_zeros(admin: TestClient) -> None:
    bamba = add(admin, name="במבה", barcode="0012345678905", department="snacks")

    result = admin.post(f"{ADMIN}/prices", content=DETAILS_LAYOUT.encode()).json()

    assert result["matched"] == 1
    products = {row["id"]: row for row in admin.get(f"{ADMIN}/products").json()}
    assert products[bamba["id"]]["price_agorot"] == 650


def test_the_same_file_twice_changes_nothing_the_second_time(admin: TestClient) -> None:
    add(admin, name="במבה", barcode="7290000000015", department="snacks")
    admin.post(f"{ADMIN}/prices", content=ITEMS_LAYOUT.encode())

    again = admin.post(f"{ADMIN}/prices", content=ITEMS_LAYOUT.encode()).json()

    assert (again["matched"], again["updated"]) == (1, 0)


def test_a_file_that_isnt_a_price_file_is_a_422(admin: TestClient) -> None:
    response = admin.post(f"{ADMIN}/prices", content=b"barcode,price\n1,2\n")
    assert response.status_code == 422
    assert response.json()["detail"]

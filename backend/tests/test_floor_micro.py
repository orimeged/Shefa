"""Micro-categories on a drawn plan: a shelf for "פירות" inside produce, finer than the department."""

import pytest

from app.domain.floor_routing import GridRouter
from app.domain.models import Category, Product, Store
from app.services.navigation import NavigationService
from tests.floor_plans import plan_from


def category(
    id_: str,
    name: str,
    *aliases: str,
    department_id: str | None = None,
    subcategory: str | None = None,
) -> Category:
    return Category(
        id=id_,
        name=name,
        name_en=id_,
        section_id="unused",
        aliases=aliases,
        department_id=department_id,
        subcategory=subcategory,
    )


CATALOG = {
    c.id: c
    for c in (
        # As in the real catalog, search knows produce by the names of its parts too.
        category("produce", "ירקות ופירות", "פירות", "ירקות"),
        category("dairy", "מוצרי חלב"),
        category("beverages", "משקאות"),
        category("product-1", "תפוח עץ", department_id="produce", subcategory="פירות"),
        category("product-2", "מלפפון", department_id="produce", subcategory="ירקות"),
        category("product-3", "גבינה צהובה", department_id="dairy", subcategory="גבינות"),
        category("product-4", "קוקה קולה", department_id="beverages", subcategory="משקאות קלים"),
    )
}
SUBCATEGORIES = {"produce": ("ירקות", "פירות"), "dairy": ("גבינות",), "beverages": ("משקאות קלים",)}

# Produce drawn as two shelves, vegetables on the left and fruit on the right; no tile
# says "ירקות ופירות". Dairy is drawn whole; one tile is a single product, Coca-Cola.
STORE = [
    "##############",
    "#............#",
    "#.vvvv..ffff.#",
    "#............#",
    "#.dddd...bbk.#",
    "#............#",
    "#............#",
    "E.........CC.#",
]
LABELS = {"v": "ירקות", "f": "פירות", "d": "מוצרי חלב", "b": "משקאות", "k": "קוקה קולה"}


@pytest.fixture(scope="module")
def router() -> GridRouter:
    return GridRouter(plan_from(STORE, LABELS))


def tiles_of(char: str) -> set[tuple[int, int]]:
    return {(row, col) for row, line in enumerate(STORE) for col, mark in enumerate(line) if mark == char}


def beside(cell: tuple[int, int], char: str) -> bool:
    row, col = cell
    return any((row + d_row, col + d_col) in tiles_of(char) for d_row, d_col in ((-1, 0), (1, 0), (0, -1), (0, 1)))


def only_stop(router: GridRouter, category_id: str, start: tuple[int, int] | None = None):
    route = router.plan_route("demo", [category_id], CATALOG, start, SUBCATEGORIES)
    assert route.unplaced_category_ids == ()
    (stop,) = route.stops
    return stop


def test_a_product_goes_to_its_subcategory_shelf_not_the_whole_department(router: GridRouter) -> None:
    apple = only_stop(router, "product-1")
    assert apple.department == "פירות"
    assert beside((apple.row, apple.col), "f")

    cucumber = only_stop(router, "product-2")
    assert cucumber.department == "ירקות"
    assert beside((cucumber.row, cucumber.col), "v")


def test_its_own_name_drawn_on_a_tile_is_finer_still(router: GridRouter) -> None:
    cola = only_stop(router, "product-4")
    assert cola.department == "קוקה קולה"
    assert beside((cola.row, cola.col), "k")


def test_with_no_shelf_for_its_subcategory_it_goes_to_its_department(router: GridRouter) -> None:
    cheese = only_stop(router, "product-3")
    assert cheese.department == "מוצרי חלב"
    assert beside((cheese.row, cheese.col), "d")


def test_a_department_drawn_only_as_its_subcategories_goes_to_the_one_on_the_way(router: GridRouter) -> None:
    # From the door at the bottom left, the vegetables are nearer.
    from_door = only_stop(router, "produce")
    assert from_door.department == "ירקות"
    assert beside((from_door.row, from_door.col), "v")
    # From the right of the store, the fruit.
    from_right = only_stop(router, "produce", start=(1, 12))
    assert from_right.department == "פירות"
    assert beside((from_right.row, from_right.col), "f")


def test_without_its_subcategories_known_a_split_department_falls_back_on_searchs_aliases(router: GridRouter) -> None:
    # As before subcategories: one of its aliases names a drawn shelf, and that's where it goes.
    route = router.plan_route("demo", ["produce"], CATALOG)
    assert route.unplaced_category_ids == ()
    assert route.stops[0].department in {"פירות", "ירקות"}


def test_a_product_and_its_split_department_in_one_route_both_arrive(router: GridRouter) -> None:
    route = router.plan_route("demo", ["product-1", "produce", "dairy"], CATALOG, None, SUBCATEGORIES)
    assert {stop.category_id for stop in route.stops} == {"product-1", "produce", "dairy"}
    assert {stop.department for stop in route.stops if stop.category_id == "product-1"} == {"פירות"}


def test_placements_name_the_finest_place(router: GridRouter) -> None:
    placements = router.placements(CATALOG, SUBCATEGORIES)
    assert placements["product-1"] == "פירות"
    assert placements["product-3"] == "מוצרי חלב"
    assert placements["product-4"] == "קוקה קולה"
    assert placements["produce"] in {"ירקות", "פירות"}


def test_the_check_links_a_subcategory_shelf_to_its_department(router: GridRouter) -> None:
    check = router.check(CATALOG.values(), SUBCATEGORIES)
    by_label = {department.label: department for department in check.departments}
    assert (by_label["פירות"].category_id, by_label["פירות"].subcategory) == ("produce", "פירות")
    assert (by_label["מוצרי חלב"].category_id, by_label["מוצרי חלב"].subcategory) == ("dairy", None)
    # A product drawn by name links to the product.
    assert by_label["קוקה קולה"].category_id == "product-4"


def test_the_navigation_service_knows_each_departments_subcategories(store: Store) -> None:
    dairy = next(c for c in store.categories if c.id == "dairy")
    placed = Category(
        id="product-90",
        name="יוגורט",
        name_en="Yogurt",
        section_id=dairy.section_id,
        department_id="dairy",
        subcategory="גבינות ויוגורט",
    )
    shelved = Product(barcode="7290000000999", name="חלב 1%", category_id="dairy", subcategory="חלב וביצים")
    navigation = NavigationService(store.model_copy(update={"product_stops": (placed,), "products": (shelved,)}))
    assert set(navigation.subcategories["dairy"]) == {"גבינות ויוגורט", "חלב וביצים"}


def test_a_departments_alias_doesnt_send_it_to_just_one_of_its_parts(router: GridRouter) -> None:
    # "פירות" is one of produce's aliases, and the name of its fruit shelf: the whole
    # department still goes to whichever of its two shelves is on the way.
    from_right = only_stop(router, "produce", start=(1, 12))
    assert from_right.department == "פירות"
    from_door = only_stop(router, "produce")
    assert from_door.department == "ירקות"
    check = router.check(CATALOG.values(), SUBCATEGORIES)
    fruit = next(department for department in check.departments if department.label == "פירות")
    assert fruit.subcategory == "פירות"

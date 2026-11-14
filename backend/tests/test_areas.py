"""Areas: "מים" goes where the water stands, not to whichever beverages shelf is nearest."""

import pytest

from app.domain.areas import area_id, department_of_area, term_areas
from app.domain.dictionary import FoodDictionary
from app.domain.floor_routing import GridRouter
from app.domain.inventory import PricedProduct
from app.domain.lost_sales import PriceBook
from app.domain.models import Category, Store
from app.domain.search_text import normalize
from app.services.navigation import NavigationService
from tests.floor_plans import plan_from


def placed(id_: str, name: str, subcategory: str, part: int | None, department: str = "beverages") -> Category:
    return Category(
        id=id_,
        name=name,
        name_en=name,
        section_id="unused",
        department_id=department,
        subcategory=subcategory,
        shelf_part=part,
    )


PRODUCTS = (
    placed("product-1", "מים מינרליים נביעות 1.5 ליטר", "מים ומיצים", 0),
    placed("product-2", "מים בטעם לימון 1.5 ליטר", "מים ומיצים", 0),
    placed("product-3", "מיץ תפוזים פריגת 1 ליטר", "מים ומיצים", 2),
    placed("product-4", "קוקה קולה 1.5 ליטר", "משקאות קלים", 1),
    # A name the word is only the start of, which isn't water.
    placed("product-5", "מימיה לטיולים", "משקאות קלים", 3),
)


@pytest.fixture(scope="module")
def shop(store: Store) -> Store:
    beverages = next(category for category in store.categories if category.id == "beverages")
    stops = tuple(product.model_copy(update={"section_id": beverages.section_id}) for product in PRODUCTS)
    return store.model_copy(update={"product_stops": stops})


@pytest.fixture(scope="module")
def navigation(shop: Store, dictionary: FoodDictionary) -> NavigationService:
    return NavigationService(shop, dictionary)


def test_a_dictionary_word_whose_products_stand_together_is_an_area(shop: Store) -> None:
    areas = {area.id: area for area in term_areas(shop, [("מים", "beverages"), ("מיץ", "beverages")])}
    water = areas[area_id("beverages", "מים")]
    assert (water.name, water.department_id, water.subcategory, water.shelf_part) == ("מים", "beverages", "מים ומיצים", 0)
    assert areas[area_id("beverages", "מיץ")].shelf_part == 2


def test_an_area_costs_about_what_its_products_do(shop: Store) -> None:
    priced = shop.model_copy(
        update={
            "product_stops": tuple(
                product.model_copy(update={"price_agorot": price})
                for product, price in zip(PRODUCTS, (500, 700, 900, 1000, 300), strict=True)
            )
        }
    )
    [water] = term_areas(priced, [("מים", "beverages")])
    # Two waters, 500 and 700: the lower middle, as a generic word means the everyday one.
    assert water.price_agorot == 500
    [unpriced] = term_areas(shop, [("מים", "beverages")])
    assert unpriced.price_agorot is None


def test_no_area_without_a_known_quarter_or_a_product_by_that_name(shop: Store) -> None:
    unknown = shop.model_copy(update={"product_stops": tuple(p.model_copy(update={"shelf_part": None}) for p in PRODUCTS)})
    assert term_areas(unknown, [("מים", "beverages")]) == ()
    assert term_areas(shop, [("בירה", "beverages"), ("מים", "no-such-department")]) == ()


def test_an_area_names_its_department() -> None:
    assert department_of_area(area_id("beverages", "מים")) == "beverages"
    assert department_of_area("beverages") is None
    assert department_of_area("product-4") is None


def test_searching_the_word_finds_the_area_and_not_the_whole_department(navigation: NavigationService) -> None:
    hits = navigation.search("מים", 8)
    assert hits[0].category_id == area_id("beverages", "מים")
    assert hits[0].category_name == "מים"
    assert "beverages" not in [hit.category_id for hit in hits]
    # A specific product is still found as itself.
    assert navigation.search("מים בטעם לימון", 3)[0].category_id == "product-2"


def test_a_list_line_with_the_word_goes_to_the_area(navigation: NavigationService) -> None:
    [water, bread] = navigation.resolve_list(["מים", "לחם"])
    assert water.hit is not None and water.hit.category_id == area_id("beverages", "מים")
    # A word with no placed products of that name stays its department.
    assert bread.hit is not None and bread.hit.category_id == "bakery"


def test_a_departments_own_alias_makes_an_area_too(store: Store) -> None:
    bakery = next(category for category in store.categories if category.id == "bakery")
    assert "לחם" in bakery.aliases
    bread = placed("product-9", "לחם אחיד פרוס 750 גרם", "לחם ופיתות", 2, department="bakery")
    navigation = NavigationService(store.model_copy(update={"product_stops": (bread,)}), FoodDictionary({}))
    [hit] = navigation.search("לחם", 1)
    assert hit.category_id == area_id("bakery", "לחם")


def test_the_map_carries_areas_for_the_apps(navigation: NavigationService) -> None:
    area = next(stop for stop in navigation.store_map.product_stops if stop.id == area_id("beverages", "מים"))
    assert (area.subcategory, area.shelf_part) == ("מים ומיצים", 0)


def test_a_route_to_the_area_ends_beside_the_waters_quarter() -> None:
    rows = [
        "#######",
        "#.....#",
        *["#..w..#"] * 8,
        *["#..s..#"] * 8,
        "#.....#",
        "E...CC#",
    ]
    router = GridRouter(plan_from(rows, {"w": "מים ומיצים", "s": "משקאות קלים"}))
    beverages = Category(id="beverages", name="משקאות", name_en="beverages", section_id="unused")
    water = term_areas(
        Store.model_construct(categories=(beverages,), product_stops=PRODUCTS),
        [("מים", "beverages")],
    )[0]
    targets = {"beverages": beverages, water.id: water}
    route = router.plan_route("demo", [water.id], targets, None, {"beverages": ("מים ומיצים", "משקאות קלים")})
    [stop] = route.stops
    assert stop.department == "מים ומיצים"
    assert 2 <= stop.row <= 3 and stop.col in (2, 4)


def test_a_report_on_an_area_is_priced_from_its_departments_products_of_that_name() -> None:
    book = PriceBook(
        [
            PricedProduct(id=1, name="מים מינרליים", name_key=normalize("מים מינרליים"), department="beverages", price_agorot=500),
            PricedProduct(id=2, name="מים בטעם לימון", name_key=normalize("מים בטעם לימון"), department="beverages", price_agorot=700),
            PricedProduct(id=3, name="קוקה קולה", name_key=normalize("קוקה קולה"), department="beverages", price_agorot=1000),
        ]
    )
    estimate = book.estimate("מים", area_id("beverages", "מים"))
    assert estimate is not None and (estimate.agorot, estimate.basis) == (600, "similar")

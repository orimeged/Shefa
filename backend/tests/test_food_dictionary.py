import time
from collections import defaultdict

import pytest

from app.domain.models import Department, Store
from app.domain.search import normalize
from app.services.navigation import NavigationService


def category_of(navigation: NavigationService, text: str) -> str | None:
    item = navigation.resolve_list([text])[0]
    return item.hit.category_id if item.hit else None


def test_covers_exactly_the_stores_departments(
    departments: dict[str, Department], store: Store
) -> None:
    assert set(departments) == {category.id for category in store.categories}


def test_every_department_has_a_description_and_terms(departments: dict[str, Department]) -> None:
    for department in departments.values():
        assert department.description
        assert len(department.terms) >= 15


def test_no_term_points_to_two_departments(departments: dict[str, Department]) -> None:
    owners: dict[str, set[str]] = defaultdict(set)
    for category_id, department in departments.items():
        for term in department.terms:
            owners[normalize(term)].add(category_id)

    clashes = {term: ids for term, ids in owners.items() if len(ids) > 1}
    assert clashes == {}


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("banana", "produce"),
        ("Banana", "produce"),
        ("בננה", "produce"),
        ("nutella", "snacks"),
        ("נוטלה", "snacks"),
        ("chocolate", "snacks"),
        ("שוקולד", "snacks"),
        ("אבוקדו", "produce"),
        ("קינואה", "pasta"),
        ("סלמון", "meat"),
        ("קפסולות קפה", "coffee"),
        ("פמפרס", "baby"),
        ("שקיות זבל", "cleaning"),
        ("קמח", "sauces"),
        ("גלידה", "frozen"),
        ("חמאה", "dairy"),
        ("ספגטי", "pasta"),
        ("קולה", "beverages"),
    ],
)
def test_places_everyday_items(navigation: NavigationService, text: str, expected: str) -> None:
    assert category_of(navigation, text) == expected


def test_dictionary_items_are_found_while_typing(navigation: NavigationService) -> None:
    assert navigation.search("banana", limit=1)[0].category_id == "produce"
    assert navigation.search("נוטל", limit=1)[0].category_id == "snacks"


def test_splits_dictation_of_dictionary_items(navigation: NavigationService) -> None:
    items = navigation.resolve_list(["אבוקדו נוטלה קמח"])

    assert [(item.text, item.hit.category_id if item.hit else None) for item in items] == [
        ("אבוקדו", "produce"),
        ("נוטלה", "snacks"),
        ("קמח", "sauces"),
    ]


def test_still_leaves_non_food_unplaced(navigation: NavigationService) -> None:
    assert category_of(navigation, "מברגה חשמלית") is None


def test_a_long_list_resolves_fast(navigation: NavigationService) -> None:
    lines = ["אבוקדו נוטלה קמח", "חלב לחם ביצים", "מברגה חשמלית", "שמן זית", "משהו לא קיים בכלל"] * 4

    started = time.perf_counter()
    navigation.resolve_list(lines)

    assert time.perf_counter() - started < 0.5

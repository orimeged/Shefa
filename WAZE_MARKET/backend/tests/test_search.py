import pytest

from app.domain.search import normalize
from app.services.navigation import NavigationService


def top_category(navigation: NavigationService, query: str) -> str:
    return navigation.search(query, limit=5)[0].category_id


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("חלב", "dairy"),
        ("milk", "dairy"),
        ("MILK", "dairy"),
        ("קוטג'", "dairy"),
        ("קוטג", "dairy"),
        ("טחינה", "sauces"),
        ("תחינה", "sauces"),
        ("spagetti", "pasta"),
        ("לחם", "bakery"),
        ("פסטה", "pasta"),
    ],
)
def test_finds_the_right_category(navigation: NavigationService, query: str, expected: str) -> None:
    assert top_category(navigation, query) == expected


def test_product_match_reports_the_product(navigation: NavigationService) -> None:
    hit = navigation.search("גבינה לב", limit=1)[0]

    assert hit.matched_text == "גבינה לבנה 5%"
    assert hit.aisle_no == 5


def test_one_hit_per_category(navigation: NavigationService) -> None:
    hits = navigation.search("קפה", limit=20)

    assert len({hit.category_id for hit in hits}) == len(hits)


def test_unrelated_query_finds_nothing(navigation: NavigationService) -> None:
    assert navigation.search("מברגה", limit=5) == []


def test_punctuation_only_query_finds_nothing(navigation: NavigationService) -> None:
    assert navigation.search("'''", limit=5) == []


def resolved(navigation: NavigationService, *lines: str) -> list[tuple[str, str | None]]:
    return [
        (item.text, item.hit.category_id if item.hit else None)
        for item in navigation.resolve_list(lines)
    ]


def test_resolves_a_list_line_by_line(navigation: NavigationService) -> None:
    assert resolved(navigation, "חלב", "טחינה", "קפה") == [
        ("חלב", "dairy"),
        ("טחינה", "sauces"),
        ("קפה", "coffee"),
    ]


def test_splits_dictation_with_no_separators(navigation: NavigationService) -> None:
    assert resolved(navigation, "חלב לחם ביצים") == [
        ("חלב", "dairy"),
        ("לחם", "bakery"),
        ("ביצים", "dairy"),
    ]


def test_splits_words_joined_with_vav(navigation: NavigationService) -> None:
    assert resolved(navigation, "חלב ולחם") == [("חלב", "dairy"), ("ולחם", "bakery")]


def test_a_short_word_needs_a_real_match(navigation: NavigationService) -> None:
    assert resolved(navigation, "כפרי") == [("כפרי", None)]


def test_a_long_word_survives_a_typo(navigation: NavigationService) -> None:
    assert resolved(navigation, "תחינה") == [("תחינה", "sauces")]


def test_keeps_a_multi_word_product_whole(navigation: NavigationService) -> None:
    assert resolved(navigation, "גבינה לבנה") == [("גבינה לבנה", "dairy")]


def test_finds_a_product_inside_dictation(navigation: NavigationService) -> None:
    assert resolved(navigation, "שמן זית חלב") == [("שמן זית", "sauces"), ("חלב", "dairy")]


def test_an_unknown_word_stays_with_the_item_before_it(navigation: NavigationService) -> None:
    assert resolved(navigation, "לחם כפרי") == [("לחם כפרי", "bakery")]


def test_an_unknown_word_joins_the_item_after_it(navigation: NavigationService) -> None:
    assert resolved(navigation, "כפרי לחם") == [("כפרי לחם", "bakery")]


def test_keeps_an_unknown_item_instead_of_dropping_it(navigation: NavigationService) -> None:
    assert resolved(navigation, "מברגה חשמלית") == [("מברגה חשמלית", None)]


def test_a_blank_line_gives_nothing(navigation: NavigationService) -> None:
    assert resolved(navigation, "   ") == []


def test_reports_which_line_each_item_came_from(navigation: NavigationService) -> None:
    items = navigation.resolve_list(["חלב לחם", "קפה"])

    assert [item.line for item in items] == [0, 0, 1]


def test_normalize_folds_final_letters_niqqud_and_punctuation() -> None:
    assert normalize("לָחֶם") == normalize("לחמ")
    assert normalize("קוטג'  5%") == "קוטג 5"

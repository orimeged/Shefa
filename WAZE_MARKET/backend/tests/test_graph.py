import pytest

from app.domain.graph import StoreGraph


def test_picks_the_shorter_of_two_paths() -> None:
    graph = StoreGraph("abcd", [("a", "b", 1), ("b", "d", 1), ("a", "c", 1), ("c", "d", 5)])

    assert graph.distance("a", "d") == 2
    assert graph.path("a", "d") == ("a", "b", "d")


def test_paths_are_walkable_in_both_directions() -> None:
    graph = StoreGraph("abc", [("a", "b", 2), ("b", "c", 3)])

    assert graph.path("c", "a") == ("c", "b", "a")
    assert graph.distance("c", "a") == graph.distance("a", "c") == 5


def test_path_to_itself_is_a_single_node() -> None:
    graph = StoreGraph("ab", [("a", "b", 2)])

    assert graph.path("a", "a") == ("a",)
    assert graph.distance("a", "a") == 0


def test_disconnected_graph_is_rejected() -> None:
    with pytest.raises(ValueError, match="unreachable"):
        StoreGraph("abc", [("a", "b", 1)])

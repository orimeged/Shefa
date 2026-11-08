from itertools import combinations, pairwise, permutations

import pytest

from app.domain.graph import StoreGraph
from app.domain.models import Store
from app.domain.routing import order_stops
from app.services.navigation import NavigationService

START, END = "entrance", "checkout"


def tour_length(graph: StoreGraph, stops: tuple[str, ...] | list[str]) -> float:
    return sum(graph.distance(a, b) for a, b in pairwise([START, *stops, END]))


def section_nodes(store: Store) -> list[str]:
    return sorted({section.node_id for section in store.sections})


def test_visits_every_stop_once(graph: StoreGraph, store: Store) -> None:
    stops = section_nodes(store)

    assert sorted(order_stops(graph, START, stops, END)) == stops


def test_order_is_deterministic(graph: StoreGraph, store: Store) -> None:
    stops = section_nodes(store)

    assert order_stops(graph, START, stops, END) == order_stops(graph, START, stops[::-1], END)


def test_no_stops_means_straight_to_the_end(graph: StoreGraph) -> None:
    assert order_stops(graph, START, [], END) == []


@pytest.mark.parametrize("size", [1, 2, 3, 4, 5])
def test_matches_brute_force_on_every_small_list(
    graph: StoreGraph, store: Store, size: int
) -> None:
    for stops in combinations(section_nodes(store), size):
        best = min(tour_length(graph, order) for order in permutations(stops))
        assert tour_length(graph, order_stops(graph, START, stops, END)) == pytest.approx(best), stops


def test_legs_follow_real_edges_and_connect(store: Store, navigation: NavigationService) -> None:
    edges = {frozenset((edge.from_node, edge.to_node)) for edge in store.edges}
    route = navigation.plan_route([category.id for category in store.categories])

    assert route.legs[0].points[0].node_id == START
    assert route.legs[-1].points[-1].node_id == END
    for leg, next_leg in pairwise(route.legs):
        assert leg.points[-1].node_id == next_leg.points[0].node_id
    for leg in route.legs:
        for a, b in pairwise(leg.points):
            assert frozenset((a.node_id, b.node_id)) in edges


def test_total_length_is_the_sum_of_legs(store: Store, navigation: NavigationService) -> None:
    route = navigation.plan_route([category.id for category in store.categories])

    assert route.total_length_m == sum(leg.length_m for leg in route.legs)


def test_categories_on_one_node_share_a_leg(navigation: NavigationService) -> None:
    route = navigation.plan_route(["pasta", "sauces"])

    assert [stop.category_id for stop in route.stops] == ["pasta", "sauces"]
    assert route.stops[0].leg_index == route.stops[1].leg_index
    assert len(route.legs) == 2


def test_repeated_categories_appear_once(navigation: NavigationService) -> None:
    route = navigation.plan_route(["dairy", "dairy"])

    assert [stop.category_id for stop in route.stops] == ["dairy"]


def test_replans_from_the_shopper_position(navigation: NavigationService) -> None:
    route = navigation.plan_route(["produce"], start_node_id="a5_s3")

    assert route.start_node_id == "a5_s3"
    assert route.legs[0].points[0].node_id == "a5_s3"
    assert route.stops[0].category_id == "produce"


def test_stop_at_the_start_node_has_a_zero_length_leg(navigation: NavigationService) -> None:
    route = navigation.plan_route(["sauces"], start_node_id="a2_s1")

    assert route.legs[0].length_m == 0
    assert len(route.legs[0].points) == 1

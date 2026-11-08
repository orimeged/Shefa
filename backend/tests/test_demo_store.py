from app.domain.models import NodeType, Store


def test_store_has_the_required_layout(store: Store) -> None:
    assert len({section.aisle_no for section in store.sections}) == 5
    assert len(store.categories) == 15
    types = [node.type for node in store.nodes]
    assert types.count(NodeType.ENTRANCE) == 1
    assert types.count(NodeType.CHECKOUT) == 1


def test_edge_lengths_match_coordinates(store: Store) -> None:
    nodes = {node.id: node for node in store.nodes}
    for edge in store.edges:
        a, b = nodes[edge.from_node], nodes[edge.to_node]
        assert edge.length_m == abs(a.x - b.x) + abs(a.y - b.y), edge


def test_nodes_are_inside_the_store(store: Store) -> None:
    for node in store.nodes:
        assert 0 <= node.x <= store.width_m and 0 <= node.y <= store.height_m, node

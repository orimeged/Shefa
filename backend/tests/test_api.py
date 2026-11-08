from fastapi.testclient import TestClient

BASE = "/api/v1/stores/demo"


def test_health(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok"}


def test_map_has_what_the_client_draws_and_no_products(client: TestClient) -> None:
    body = client.get(f"{BASE}/map").json()

    assert body["id"] == "demo"
    assert len(body["categories"]) == 15
    assert body["nodes"] and body["edges"] and body["sections"]
    assert "products" not in body


def test_search(client: TestClient) -> None:
    response = client.get(f"{BASE}/search", params={"q": "חלב"})

    assert response.status_code == 200
    assert response.json()[0]["category_id"] == "dairy"


def test_search_requires_a_query(client: TestClient) -> None:
    assert client.get(f"{BASE}/search").status_code == 422


def test_resolve_list(client: TestClient) -> None:
    response = client.post(f"{BASE}/list/resolve", json={"lines": ["חלב לחם", "מברגה"]})

    assert response.status_code == 200
    body = response.json()
    assert [item["text"] for item in body] == ["חלב", "לחם", "מברגה"]
    assert body[0]["hit"]["category_id"] == "dairy"
    assert body[2]["hit"] is None


def test_resolve_list_needs_lines(client: TestClient) -> None:
    assert client.post(f"{BASE}/list/resolve", json={"lines": []}).status_code == 422


def test_resolve_list_limits_its_size(client: TestClient) -> None:
    response = client.post(f"{BASE}/list/resolve", json={"lines": ["חלב"] * 101})

    assert response.status_code == 422


def test_route(client: TestClient) -> None:
    response = client.post(f"{BASE}/routes", json={"category_ids": ["dairy", "pasta", "snacks"]})

    assert response.status_code == 200
    body = response.json()
    assert body["start_node_id"] == "entrance"
    assert body["end_node_id"] == "checkout"
    assert {stop["category_id"] for stop in body["stops"]} == {"dairy", "pasta", "snacks"}
    assert len(body["legs"]) == 4


def test_route_from_a_position(client: TestClient) -> None:
    response = client.post(
        f"{BASE}/routes", json={"category_ids": ["dairy"], "start_node_id": "a2_s1"}
    )

    assert response.json()["start_node_id"] == "a2_s1"


def test_unknown_store_is_404(client: TestClient) -> None:
    assert client.get("/api/v1/stores/nope/map").status_code == 404


def test_a_category_that_left_the_store_doesnt_cost_the_route(client: TestClient) -> None:
    response = client.post(f"{BASE}/routes", json={"category_ids": ["nope", "dairy"]})

    assert response.status_code == 200
    assert response.json()["unplaced_category_ids"] == ["nope"]
    assert [stop["category_id"] for stop in response.json()["stops"]] == ["dairy"]


def test_unknown_start_node_is_422(client: TestClient) -> None:
    response = client.post(
        f"{BASE}/routes", json={"category_ids": ["dairy"], "start_node_id": "nope"}
    )

    assert response.status_code == 422


def test_empty_list_is_422(client: TestClient) -> None:
    assert client.post(f"{BASE}/routes", json={"category_ids": []}).status_code == 422

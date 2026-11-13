"""Which sites may call the API from a browser: the frontend's domain, its previews, nothing else."""

from dataclasses import replace

from fastapi.testclient import TestClient

from app.config import Settings, parse_origins
from app.main import create_app

PREVIEWS = r"https://shefa-[a-z0-9-]+\.vercel\.app"


def test_api_calls_from_the_frontends_domain_get_cors_headers(settings: Settings) -> None:
    app = create_app(
        replace(settings, cors_origins=("https://shefa.vercel.app",), cors_origin_regex=PREVIEWS)
    )
    with TestClient(app) as client:
        for origin in ("https://shefa.vercel.app", "https://shefa-pr-12.vercel.app"):
            response = client.options(
                "/api/v1/stores/demo/map",
                headers={"origin": origin, "access-control-request-method": "GET"},
            )
            assert response.headers.get("access-control-allow-origin") == origin
        foreign = client.options(
            "/api/v1/stores/demo/map",
            headers={"origin": "https://evil.example", "access-control-request-method": "GET"},
        )
        assert "access-control-allow-origin" not in foreign.headers


def test_a_pasted_site_address_still_lets_its_search_through(settings: Settings) -> None:
    """The live failure: search answered 200 with no CORS header, so the page said unavailable."""
    pasted = parse_origins("https://shefa-sandy.vercel.app/kiosk")
    with TestClient(create_app(replace(settings, cors_origins=pasted))) as client:
        response = client.get(
            "/api/v1/stores/demo/search",
            params={"q": "חלב"},
            headers={"origin": "https://shefa-sandy.vercel.app"},
        )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "https://shefa-sandy.vercel.app"

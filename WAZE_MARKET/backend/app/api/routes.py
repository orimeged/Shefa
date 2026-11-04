"""HTTP endpoints."""

import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.schemas import ResolveListRequest, RouteRequest
from app.domain.analytics import AnalyticsStore, RouteTrip, misses_in, route_edges
from app.domain.models import ResolvedItem, Route, SearchHit, StoreMap
from app.services.navigation import NavigationService, UnknownReferenceError

logger = logging.getLogger(__name__)

router = APIRouter()
stores_router = APIRouter(prefix="/api/v1/stores/{store_id}", tags=["stores"])


def get_navigation(store_id: str, request: Request) -> NavigationService:
    navigation = request.app.state.stores.get(store_id)
    if navigation is None:
        raise HTTPException(404, f"Unknown store: {store_id}")
    return navigation


Navigation = Annotated[NavigationService, Depends(get_navigation)]


def _get_analytics(request: Request) -> AnalyticsStore:
    return request.app.state.analytics


Analytics = Annotated[AnalyticsStore, Depends(_get_analytics)]


def _record(write: Callable[[], None]) -> None:
    """Runs after the response: a shopper never waits for analytics or fails with them."""
    try:
        write()
    except SQLAlchemyError as error:
        logger.warning("Analytics weren't recorded: %s", error)


@router.get("/health", tags=["system"])
def health(request: Request) -> dict[str, str]:
    """For the host's health check: up means the database answers too."""
    try:
        with request.app.state.database.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as error:
        logger.error("The database isn't answering: %s", error)
        raise HTTPException(503, "Database unavailable") from error
    return {"status": "ok"}


@stores_router.get("/map")
def get_store_map(navigation: Navigation) -> StoreMap:
    return navigation.store_map


@stores_router.get("/search")
def search(
    navigation: Navigation,
    q: Annotated[str, Query(min_length=1, max_length=80)],
    limit: Annotated[int, Query(ge=1, le=20)] = 5,
) -> list[SearchHit]:
    return navigation.search(q, limit)


@stores_router.post("/list/resolve")
def resolve_list(
    store_id: str,
    navigation: Navigation,
    analytics: Analytics,
    background: BackgroundTasks,
    body: ResolveListRequest,
) -> list[ResolvedItem]:
    items = navigation.resolve_list(body.lines)
    misses = misses_in(items, store_id, body.session_id or str(uuid4()), datetime.now(UTC))
    if misses:
        background.add_task(_record, lambda: analytics.record_misses(misses))
    return items


@stores_router.post("/routes")
def create_route(
    store_id: str,
    navigation: Navigation,
    analytics: Analytics,
    background: BackgroundTasks,
    body: RouteRequest,
) -> Route:
    try:
        route = navigation.plan_route(body.category_ids, body.start_node_id)
    except UnknownReferenceError as error:
        raise HTTPException(422, str(error)) from error

    if route.stops:
        trip = RouteTrip(
            store_id=store_id,
            session_id=body.session_id or str(uuid4()),
            edges=route_edges(route),
            timestamp=datetime.now(UTC),
        )
        background.add_task(_record, lambda: analytics.record_trip(trip))
    return route


router.include_router(stores_router)

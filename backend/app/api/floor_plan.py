"""The floor plan managers draw in the dashboard, and routes across it.

Kiosks and phones draw and route on a store's plan once one is saved and
routable, and on the graph from `/map` before that. They load `/map` either way:
it carries the catalog.
"""

from datetime import UTC, datetime
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.admin import require_admin
from app.api.routes import Analytics, Navigation, record_in_background
from app.api.schemas import SessionId
from app.domain.analytics import RouteTrip
from app.domain.floor_plan import FloorPlan
from app.domain.floor_routing import (
    FloorPlanCheck,
    FloorPlanNotRoutableError,
    GridPoint,
    GridRoute,
    InvalidStartError,
    grid_route_edges,
)
from app.domain.models import Category, Model
from app.services.floor_plans import FloorPlanRegistry, LoadedFloorPlan
from app.services.navigation import NavigationService

router = APIRouter(prefix="/api/v1/stores/{store_id}/floor-plan", tags=["floor plan"])


def _floor_plans(request: Request) -> FloorPlanRegistry:
    return request.app.state.floor_plans


FloorPlans = Annotated[FloorPlanRegistry, Depends(_floor_plans)]


class SavedFloorPlan(Model):
    store_id: str
    floor_plan: FloorPlan
    updated_at: datetime
    # What a manager should fix before shoppers can walk it.
    check: FloorPlanCheck
    # Category or placed product id to the drawn department a route would go to.
    placements: dict[str, str]


class FloorRouteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_ids: list[str] = Field(min_length=1, max_length=50)
    # Re-plans from where the shopper stands; the entrance when absent.
    start: GridPoint | None = None
    # One shopping trip, so analytics count it once however often it re-plans.
    session_id: SessionId | None = None


@router.get(
    "",
    response_model=SavedFloorPlan,
    responses={204: {"description": "No floor plan saved for this store yet"}},
)
def get_floor_plan(
    store_id: str, navigation: Navigation, floor_plans: FloorPlans
) -> SavedFloorPlan | Response:
    """204 until a manager saves one: an empty answer, not an error browsers log on every visit."""
    loaded = floor_plans.get(store_id)
    if loaded is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return _saved(store_id, loaded, navigation)


@router.put("", dependencies=[Depends(require_admin)])
def save_floor_plan(
    store_id: str, plan: FloorPlan, navigation: Navigation, floor_plans: FloorPlans
) -> SavedFloorPlan:
    if not floor_plans.save(store_id, plan):
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown store: {store_id}")
    loaded = floor_plans.get(store_id)
    if loaded is None:  # Saved a moment ago; only a concurrent hand edit could do this.
        raise HTTPException(status.HTTP_409_CONFLICT, "The floor plan changed while saving")
    return _saved(store_id, loaded, navigation)


@router.post("/routes")
def plan_floor_route(
    store_id: str,
    body: FloorRouteRequest,
    navigation: Navigation,
    floor_plans: FloorPlans,
    analytics: Analytics,
    background: BackgroundTasks,
) -> GridRoute:
    loaded = floor_plans.get(store_id)
    if loaded is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No floor plan saved for this store yet")
    start = (body.start.row, body.start.col) if body.start else None
    try:
        route = loaded.router.plan_route(
            store_id, body.category_ids, _targets(navigation), start, navigation.subcategories
        )
    except FloorPlanNotRoutableError as error:
        raise HTTPException(
            status.HTTP_409_CONFLICT, {"problems": [problem.value for problem in error.problems]}
        ) from error
    except InvalidStartError as error:
        raise HTTPException(422, str(error)) from error

    # Into the same tables as the graph's routes: the dashboard counts both alike.
    if route.stops:
        trip = RouteTrip(
            store_id=store_id,
            session_id=body.session_id or str(uuid4()),
            edges=grid_route_edges(route),
            timestamp=datetime.now(UTC),
        )
        record_in_background(background, lambda: analytics.record_trip(trip))
    return route


def _saved(store_id: str, loaded: LoadedFloorPlan, navigation: NavigationService) -> SavedFloorPlan:
    return SavedFloorPlan(
        store_id=store_id,
        floor_plan=loaded.plan,
        updated_at=loaded.saved_at,
        # Products drawn by name count as linked, after the departments.
        check=loaded.router.check(_targets(navigation).values(), navigation.subcategories),
        placements=loaded.router.placements(_targets(navigation), navigation.subcategories),
    )


def _targets(navigation: NavigationService) -> dict[str, Category]:
    """Whatever a shopper can ask for: departments, and products managers placed."""
    store = navigation.store_map
    return {category.id: category for category in (*store.categories, *store.product_stops)}

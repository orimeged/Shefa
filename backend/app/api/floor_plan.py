"""The floor plan managers draw in the dashboard, and routes across it.

Apart from `/map`, which kiosks and phones draw the store from today: a saved
plan changes nothing there until those screens draw plans themselves.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.admin import require_admin
from app.api.routes import Navigation
from app.domain.floor_plan import FloorPlan
from app.domain.floor_routing import (
    FloorPlanCheck,
    FloorPlanNotRoutableError,
    GridPoint,
    GridRoute,
    InvalidStartError,
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


class FloorRouteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_ids: list[str] = Field(min_length=1, max_length=50)
    # Re-plans from where the shopper stands; the entrance when absent.
    start: GridPoint | None = None


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
    store_id: str, body: FloorRouteRequest, navigation: Navigation, floor_plans: FloorPlans
) -> GridRoute:
    loaded = floor_plans.get(store_id)
    if loaded is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No floor plan saved for this store yet")
    start = (body.start.row, body.start.col) if body.start else None
    try:
        return loaded.router.plan_route(store_id, body.category_ids, _targets(navigation), start)
    except FloorPlanNotRoutableError as error:
        raise HTTPException(
            status.HTTP_409_CONFLICT, {"problems": [problem.value for problem in error.problems]}
        ) from error
    except InvalidStartError as error:
        raise HTTPException(422, str(error)) from error


def _saved(store_id: str, loaded: LoadedFloorPlan, navigation: NavigationService) -> SavedFloorPlan:
    return SavedFloorPlan(
        store_id=store_id,
        floor_plan=loaded.plan,
        updated_at=loaded.saved_at,
        check=loaded.router.check(navigation.store_map.categories),
    )


def _targets(navigation: NavigationService) -> dict[str, Category]:
    """Whatever a shopper can ask for: departments, and products managers placed."""
    store = navigation.store_map
    return {category.id: category for category in (*store.categories, *store.product_stops)}

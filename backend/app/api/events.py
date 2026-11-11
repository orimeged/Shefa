"""Telemetry endpoints."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel

from app.domain.events import EventStore, NotFoundEvent, NotFoundReport
from app.services.floor_plans import FloorPlanRegistry
from app.services.navigation import NavigationService

router = APIRouter(prefix="/api/events", tags=["events"])


class EventReceipt(BaseModel):
    event_id: UUID
    stored: bool


@router.post("/not-found", status_code=status.HTTP_201_CREATED)
def record_not_found(report: NotFoundReport, request: Request, response: Response) -> EventReceipt:
    navigation: NavigationService | None = request.app.state.stores.get(report.store_id)
    if navigation is None:
        raise HTTPException(404, f"Unknown store: {report.store_id}")
    if not _is_in_store(request, navigation, report.store_id, report.x_coord, report.y_coord):
        raise HTTPException(422, "The location is outside the store")

    store: EventStore = request.app.state.events
    stored = store.append(NotFoundEvent.from_report(report))
    if not stored:
        # A retry of something already recorded. It succeeded, and it counts once.
        response.status_code = status.HTTP_200_OK
    return EventReceipt(event_id=report.event_id, stored=stored)


def _is_in_store(request: Request, navigation: NavigationService, store_id: str, x: float, y: float) -> bool:
    """Inside the map the shopper's app routes on: a drawn plan, when one routes, else the graph's.

    A shopper reports from the stop they were sent to, in that map's metres, and a
    drawn plan can be larger than the graph's store.
    """
    floor_plans: FloorPlanRegistry = request.app.state.floor_plans
    loaded = floor_plans.get(store_id)
    if loaded is not None and loaded.router.routable:
        plan = loaded.plan
        return 0 <= x <= plan.cols * plan.cell_size_m and 0 <= y <= plan.rows * plan.cell_size_m
    return navigation.is_on_map(x, y)

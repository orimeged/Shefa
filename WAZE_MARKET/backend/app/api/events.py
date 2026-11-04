"""Telemetry endpoints."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel

from app.domain.events import EventStore, NotFoundEvent, NotFoundReport
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
    if not navigation.is_on_map(report.x_coord, report.y_coord):
        raise HTTPException(422, "The location is outside the store")

    store: EventStore = request.app.state.events
    stored = store.append(NotFoundEvent.from_report(report))
    if not stored:
        # A retry of something already recorded. It succeeded, and it counts once.
        response.status_code = status.HTTP_200_OK
    return EventReceipt(event_id=report.event_id, stored=stored)

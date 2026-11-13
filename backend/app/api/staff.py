"""The floor staff's phone app: open alerts, closing them, and alerts pushed to the phone.

It sits behind its own token, so a shift manager's phone can close alerts and place
products without holding the dashboard's token, which also edits the map. The
dashboard's token opens it too.
"""

import secrets
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field

from app.api.admin import (
    NotFoundReportRow,
    ResolveNotFoundRequest,
    ResolveNotFoundResponse,
    alert_rows,
    close_alert,
    with_shelves,
)
from app.api.alerting import schedule_alert
from app.api.events import EventReceipt, is_in_store
from app.api.floor_plan import route_targets
from app.api.schemas import ResolveListRequest
from app.domain.events import NotFoundEvent, NotFoundReport, ShortId
from app.domain.models import ResolvedItem
from app.domain.floor_routing import GridRoute
from app.domain.picking import PickSession
from app.repositories.pick_store import SqlPickSessions
from app.domain.inventory import CatalogCategory, CatalogProduct, ProductDraft, StaffPlacement, StaffProductDraft
from app.repositories.inventory_repository import CatalogEditing, SqlInventoryRepository
from app.repositories.push_store import SqlPushSubscriptions
from app.services.push import AlertNotifier, PushSubscription

_bearer = HTTPBearer(auto_error=False)


def require_staff(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> None:
    accepted = [token for token in (request.app.state.staff_token, request.app.state.admin_token) if token]
    if not accepted:
        raise HTTPException(503, "The staff app is locked: neither STAFF_TOKEN nor ADMIN_TOKEN is set")
    supplied = (credentials.credentials if credentials else "").encode()
    # Every token is compared, so the time taken doesn't say which one was close.
    matches = [secrets.compare_digest(supplied, token.encode()) for token in accepted]
    if not any(matches):
        raise HTTPException(401, "Invalid token", headers={"WWW-Authenticate": "Bearer"})


router = APIRouter(prefix="/api/v1/staff", tags=["staff"], dependencies=[Depends(require_staff)])

StoreId = Annotated[str, Query(min_length=1, max_length=64)]


def _inventory(request: Request) -> SqlInventoryRepository:
    return request.app.state.inventory


def _notifier(request: Request) -> AlertNotifier:
    return request.app.state.notifier


def _subscriptions(request: Request) -> SqlPushSubscriptions:
    return request.app.state.push_subscriptions


Inventory = Annotated[SqlInventoryRepository, Depends(_inventory)]
Notifier = Annotated[AlertNotifier, Depends(_notifier)]
Subscriptions = Annotated[SqlPushSubscriptions, Depends(_subscriptions)]


class PushKey(BaseModel):
    """Null when the server has no VAPID key: alerts then only show while the app is open."""

    public_key: str | None


class SubscriptionKeys(BaseModel):
    model_config = ConfigDict(extra="ignore")

    p256dh: str = Field(min_length=1, max_length=200)
    auth: str = Field(min_length=1, max_length=100)


class SubscribeRequest(BaseModel):
    """A browser's PushSubscription, as `JSON.stringify` writes it, plus the store."""

    model_config = ConfigDict(extra="ignore")

    store_id: ShortId
    # Push services are all on https; anything else isn't one.
    endpoint: str = Field(pattern=r"^https://", max_length=1000)
    keys: SubscriptionKeys


class UnsubscribeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    endpoint: str = Field(min_length=1, max_length=1000)


class TestPushRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    store_id: ShortId


class TestPushResponse(BaseModel):
    sent: int


def _require_store(request: Request, store_id: str) -> None:
    if request.app.state.stores.get(store_id) is None:
        raise HTTPException(404, f"Unknown store: {store_id}")


@router.get("/session", status_code=status.HTTP_204_NO_CONTENT)
def check_session() -> Response:
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/alerts")
def open_alerts(request: Request, inventory: Inventory, store_id: StoreId) -> list[NotFoundReportRow]:
    """The same open alerts as the dashboard's table, each with its shelf."""
    return alert_rows(request, inventory, store_id)


@router.post("/alerts/resolve")
def resolve_alert(request: Request, body: ResolveNotFoundRequest) -> ResolveNotFoundResponse:
    return close_alert(request, body)


@router.get("/push/key")
def push_key(notifier: Notifier) -> PushKey:
    return PushKey(public_key=notifier.public_key)


@router.post("/push/subscriptions", status_code=status.HTTP_201_CREATED)
def subscribe(request: Request, body: SubscribeRequest, notifier: Notifier, subscriptions: Subscriptions) -> Response:
    if not notifier.enabled:
        raise HTTPException(503, "Push alerts aren't configured on this server")
    _require_store(request, body.store_id)
    subscriptions.save(body.store_id, PushSubscription(endpoint=body.endpoint, p256dh=body.keys.p256dh, auth=body.keys.auth))
    return Response(status_code=status.HTTP_201_CREATED)


@router.post("/push/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(body: UnsubscribeRequest, subscriptions: Subscriptions) -> Response:
    subscriptions.remove(body.endpoint)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/push/test")
def test_push(request: Request, body: TestPushRequest, notifier: Notifier) -> TestPushResponse:
    """A sample alert to every phone subscribed for the store, to see that alerts arrive."""
    _require_store(request, body.store_id)
    sent = notifier.notify(
        body.store_id,
        {
            "title": "בדיקה: התראות פועלות",
            "body": "כך תיראה התראה כשלקוח לא מוצא מוצר במדף.",
            "tag": "alert:test",
            "url": "/staff",
        },
    )
    return TestPushResponse(sent=sent)


# ---- Placing products by barcode


@router.get("/categories")
def staff_categories(request: Request, inventory: Inventory, store_id: StoreId) -> list[CatalogCategory]:
    _require_store(request, store_id)
    return inventory.categories(store_id)


@router.get("/products")
def find_product(
    request: Request,
    inventory: Inventory,
    store_id: StoreId,
    barcode: Annotated[str, Query(min_length=1, max_length=14, pattern=r"^\d+$")],
) -> list[CatalogProduct]:
    """The product with this barcode, in a list of one, or an empty list: unknown is an answer, not an error."""
    _require_store(request, store_id)
    found = CatalogEditing(inventory).find_by_barcode(store_id, barcode)
    return with_shelves(request, store_id, [found]) if found else []


@router.post("/products", status_code=status.HTTP_201_CREATED)
def add_scanned_product(request: Request, inventory: Inventory, store_id: StoreId, body: StaffProductDraft) -> CatalogProduct:
    _require_store(request, store_id)
    created = CatalogEditing(inventory).create(store_id, ProductDraft(**body.model_dump()))
    return with_shelves(request, store_id, [created])[0]


@router.patch("/products/{product_id}")
def place_product(
    request: Request, inventory: Inventory, store_id: StoreId, product_id: int, body: StaffPlacement
) -> CatalogProduct:
    """Moves a product to the shelf it was found on. Only where it stands changes."""
    _require_store(request, store_id)
    changed = CatalogEditing(inventory).update(store_id, product_id, body.model_dump(exclude_unset=True))
    return with_shelves(request, store_id, [changed])[0]


# ---- Picking online orders


class PickRouteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_ids: list[str] = Field(min_length=1, max_length=100)


class PickFinished(BaseModel):
    recorded: bool
    minutes: float


def _picks(request: Request) -> SqlPickSessions:
    return request.app.state.picks


Picks = Annotated[SqlPickSessions, Depends(_picks)]


@router.post("/picks/resolve")
def pick_resolve(request: Request, store_id: StoreId, body: ResolveListRequest) -> list[ResolvedItem]:
    """An order's lines matched to the catalog, like a shopper's list but kept out of the dashboard.

    An online order's line the catalog can't place is a gap in the map, not a shopper's
    demand the store doesn't carry, so it isn't counted among unfulfilled searches.
    """
    navigation = request.app.state.stores.get(store_id)
    if navigation is None:
        raise HTTPException(404, f"Unknown store: {store_id}")
    return navigation.resolve_list(body.lines)


@router.post("/picks/route")
def pick_route(request: Request, store_id: StoreId, body: PickRouteRequest) -> GridRoute:
    """An order's stops in walking order, on the drawn plan. Not counted as a shopper's trip."""
    navigation = request.app.state.stores.get(store_id)
    loaded = request.app.state.floor_plans.get(store_id)
    if navigation is None:
        raise HTTPException(404, f"Unknown store: {store_id}")
    if loaded is None or not loaded.router.routable:
        raise HTTPException(409, "Picking needs a drawn floor plan that routes")
    return loaded.router.plan_route(store_id, body.category_ids, route_targets(navigation), None, navigation.subcategories)


@router.post("/picks/missing", status_code=status.HTTP_201_CREATED)
def pick_missing(request: Request, report: NotFoundReport, background: BackgroundTasks, response: Response) -> EventReceipt:
    """A line a picker couldn't find on its shelf: a report like a shopper's, marked as a picker's.

    A picker looks for every item of every order, so these are the surest signal of an
    empty shelf, and each one rings the floor staff's phones.
    """
    navigation = request.app.state.stores.get(report.store_id)
    if navigation is None:
        raise HTTPException(404, f"Unknown store: {report.store_id}")
    if not is_in_store(request, navigation, report.store_id, report.x_coord, report.y_coord):
        raise HTTPException(422, "The location is outside the store")
    event = NotFoundEvent.from_report(report, source="picker")
    stored = request.app.state.events.append(event)
    if stored:
        schedule_alert(request, background, event)
    else:
        response.status_code = status.HTTP_200_OK
    return EventReceipt(event_id=report.event_id, stored=stored)


@router.post("/picks/finish")
def pick_finished(request: Request, body: PickSession, picks: Picks) -> PickFinished:
    _require_store(request, body.store_id)
    return PickFinished(recorded=picks.record(body), minutes=round(body.minutes, 1))

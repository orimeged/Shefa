"""The managers' dashboard: figures, lost demand and what goes on the map."""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from app.api.admin import require_admin
from app.domain.analytics import DashboardCounts, HeatPoint, edge_key
from app.domain.events import EventStore
from app.domain.floor_routing import CELL_PREFIX
from app.domain.lost_sales import Bucket, ItemState, PriceBasis, PriceBook, summarize
from app.domain.picking import PickingSummary, summarize_picks
from app.repositories.pick_store import SqlPickSessions
from app.repositories.analytics_store import SqlAnalyticsStore
from app.repositories.inventory_repository import CatalogEditing, SqlInventoryRepository
from app.services.navigation import NavigationService

_WINDOW = timedelta(days=7)
_TOP_ITEMS = 10
_TOP_NOT_CARRIED = 5

router = APIRouter(
    prefix="/api/v1/admin/analytics", tags=["analytics"], dependencies=[Depends(require_admin)]
)

StoreId = Annotated[str, Query(min_length=1, max_length=64)]


class LostItem(BaseModel):
    item: str
    category_id: str | None
    category_name: str | None
    category_name_en: str | None
    times: int


class LostCategory(BaseModel):
    """`category_id` is null for what nothing could place in a department."""

    category_id: str | None
    category_name: str | None
    category_name_en: str | None
    times: int
    share: float


class LostDemandReport(BaseModel):
    total: int
    items: list[LostItem]
    categories: list[LostCategory]


class LostSalesItem(BaseModel):
    item: str
    category_id: str | None
    category_name: str | None
    category_name_en: str | None
    reports: int
    open_reports: int
    picker_reports: int
    unit_price_agorot: int | None
    price_basis: PriceBasis | None
    value_agorot: int
    state: ItemState
    last_reported_at: datetime


class NotCarried(BaseModel):
    """Searches for what the catalog doesn't list: demand the till never sees."""

    searches: int
    previous_searches: int
    items: list[LostItem]


class LostSalesReport(BaseModel):
    """The last 7 days of "not found" reports in shekels, against the 7 before.

    `value_agorot` is the shelf price of every reported item, once per report: a
    floor for what walked out, since only shoppers who reported are counted.
    """

    days: int
    value_agorot: int
    previous_value_agorot: int
    reports: int
    previous_reports: int
    priced_reports: int
    exact_reports: int
    empty_shelf: Bucket
    misplaced: Bucket
    not_carried: NotCarried
    open_alerts: int
    open_value_agorot: int
    restocked_alerts: int
    restock_median_minutes: float | None
    previous_restock_median_minutes: float | None
    items: list[LostSalesItem]


class HeatmapReport(BaseModel):
    total: int
    points: list[HeatPoint]


class EdgeFlow(BaseModel):
    from_node: str
    to_node: str
    trips: int


class TrafficReport(BaseModel):
    trips: int
    edges: list[EdgeFlow]
    # Steps between floor-plan tiles ("cell:row:col"), only those someone walked.
    cell_edges: list[EdgeFlow] = []


def _analytics(request: Request) -> SqlAnalyticsStore:
    return request.app.state.analytics


def _inventory(request: Request) -> SqlInventoryRepository:
    return request.app.state.inventory


def _events(request: Request) -> EventStore:
    return request.app.state.events


Analytics = Annotated[SqlAnalyticsStore, Depends(_analytics)]
Inventory = Annotated[SqlInventoryRepository, Depends(_inventory)]
Events = Annotated[EventStore, Depends(_events)]


def _navigation(request: Request, store_id: StoreId) -> NavigationService:
    navigation = request.app.state.stores.get(store_id)
    if navigation is None:
        raise HTTPException(404, f"Unknown store: {store_id}")
    return navigation


Navigation = Annotated[NavigationService, Depends(_navigation)]


@router.get("/summary")
def summary(
    request: Request, store_id: StoreId, _navigation: Navigation, analytics: Analytics
) -> DashboardCounts:
    now = datetime.now(UTC)
    local = now.astimezone(request.app.state.store_timezone)
    day_start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return analytics.dashboard_counts(store_id, now, day_start.astimezone(UTC))


@router.get("/lost-demand")
def lost_demand(
    store_id: StoreId, _navigation: Navigation, analytics: Analytics, inventory: Inventory
) -> LostDemandReport:
    """What shoppers wanted and the catalog doesn't list, over the last 7 days."""
    since = datetime.now(UTC) - _WINDOW
    items = analytics.top_misses(store_id, since, _TOP_ITEMS)
    categories = analytics.misses_by_category(store_id, since)
    total = sum(tally.times for tally in categories)

    slugs = {row.category_id for row in (*items, *categories) if row.category_id}
    names = inventory.departments_of(store_id, slugs)

    def name_of(category_id: str | None) -> tuple[str | None, str | None]:
        department = names.get(category_id or "")
        return (department.name, department.name_en) if department else (None, None)

    return LostDemandReport(
        total=total,
        items=[
            LostItem(
                item=row.query,
                category_id=row.category_id,
                category_name=name_of(row.category_id)[0],
                category_name_en=name_of(row.category_id)[1],
                times=row.times,
            )
            for row in items
        ],
        categories=[
            LostCategory(
                category_id=row.category_id,
                category_name=name_of(row.category_id)[0],
                category_name_en=name_of(row.category_id)[1],
                times=row.times,
                share=row.times / total,
            )
            for row in categories
        ],
    )


@router.get("/lost-sales")
def lost_sales(
    store_id: StoreId,
    _navigation: Navigation,
    analytics: Analytics,
    inventory: Inventory,
    events: Events,
) -> LostSalesReport:
    """What shoppers reported missing, valued at shelf prices, by what the manager found."""
    now = datetime.now(UTC)
    since, previous_since = now - _WINDOW, now - 2 * _WINDOW
    # A week further back, for alerts refilled in the earlier week but first reported before it.
    records = events.report_records(store_id, previous_since - _WINDOW)
    prices = PriceBook(CatalogEditing(inventory).priced_products(store_id))
    current = summarize(records, prices, since, now)
    previous = summarize(records, prices, previous_since, since)

    not_carried = analytics.top_misses(store_id, since, _TOP_NOT_CARRIED)
    top = current.items[:_TOP_ITEMS]
    slugs = {row.category_id for row in (*top, *not_carried) if row.category_id}
    names = inventory.departments_of(store_id, slugs)

    def name_of(category_id: str | None) -> tuple[str | None, str | None]:
        department = names.get(category_id or "")
        return (department.name, department.name_en) if department else (None, None)

    return LostSalesReport(
        days=_WINDOW.days,
        value_agorot=current.value_agorot,
        previous_value_agorot=previous.value_agorot,
        reports=current.reports,
        previous_reports=previous.reports,
        priced_reports=current.priced_reports,
        exact_reports=current.exact_reports,
        empty_shelf=current.empty_shelf,
        misplaced=current.misplaced,
        not_carried=NotCarried(
            searches=analytics.miss_count(store_id, since, now),
            previous_searches=analytics.miss_count(store_id, previous_since, since),
            items=[
                LostItem(
                    item=row.query,
                    category_id=row.category_id,
                    category_name=name_of(row.category_id)[0],
                    category_name_en=name_of(row.category_id)[1],
                    times=row.times,
                )
                for row in not_carried
            ],
        ),
        open_alerts=current.open_alerts,
        open_value_agorot=current.open_value_agorot,
        restocked_alerts=current.restocked_alerts,
        restock_median_minutes=current.restock_median_minutes,
        previous_restock_median_minutes=previous.restock_median_minutes,
        items=[
            LostSalesItem(
                **item.model_dump(),
                category_name=name_of(item.category_id)[0],
                category_name_en=name_of(item.category_id)[1],
            )
            for item in top
        ],
    )


class PickingReport(BaseModel):
    """Orders picked with the route-sorted list: this week against the week before."""

    current: PickingSummary
    previous: PickingSummary


@router.get("/picking")
def picking(request: Request, store_id: StoreId, _navigation: Navigation) -> PickingReport:
    picks: SqlPickSessions = request.app.state.picks
    now = datetime.now(UTC)
    return PickingReport(
        current=summarize_picks(picks.sessions(store_id, now - _WINDOW, now)),
        previous=summarize_picks(picks.sessions(store_id, now - 2 * _WINDOW, now - _WINDOW)),
    )


@router.get("/not-found-heatmap")
def not_found_heatmap(
    store_id: StoreId, _navigation: Navigation, analytics: Analytics
) -> HeatmapReport:
    points = analytics.heat_points(store_id, datetime.now(UTC) - _WINDOW)
    return HeatmapReport(total=sum(point.count for point in points), points=points)


@router.get("/traffic-flow")
def traffic_flow(
    store_id: StoreId, navigation: Navigation, analytics: Analytics
) -> TrafficReport:
    """Every walkway on the floor plan, with how many planned trips crossed it."""
    now = datetime.now(UTC)
    since = now - _WINDOW
    traffic = analytics.edge_traffic(store_id, since)
    return TrafficReport(
        trips=analytics.trip_count(store_id, since, now),
        edges=[
            EdgeFlow(
                from_node=edge.from_node,
                to_node=edge.to_node,
                trips=traffic.get(edge_key(edge.from_node, edge.to_node), 0),
            )
            for edge in navigation.store_map.edges
        ],
        cell_edges=[
            EdgeFlow(from_node=node_a, to_node=node_b, trips=trips)
            for (node_a, node_b), trips in sorted(traffic.items())
            if node_a.startswith(CELL_PREFIX)
        ],
    )

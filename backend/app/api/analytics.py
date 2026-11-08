"""The managers' dashboard: figures, lost demand and what goes on the map."""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from app.api.admin import require_admin
from app.domain.analytics import DashboardCounts, HeatPoint, edge_key
from app.repositories.analytics_store import SqlAnalyticsStore
from app.repositories.inventory_repository import SqlInventoryRepository
from app.services.navigation import NavigationService

_WINDOW = timedelta(days=7)
_TOP_ITEMS = 10

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


def _analytics(request: Request) -> SqlAnalyticsStore:
    return request.app.state.analytics


def _inventory(request: Request) -> SqlInventoryRepository:
    return request.app.state.inventory


Analytics = Annotated[SqlAnalyticsStore, Depends(_analytics)]
Inventory = Annotated[SqlInventoryRepository, Depends(_inventory)]


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
    )

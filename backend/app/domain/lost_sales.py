"""What shoppers couldn't find, in money: the figures a store manager pays for.

A sale that doesn't happen leaves no receipt. A "not found" report is the trace it
does leave, and this module values each one at the shelf price of what was missing.
That is a floor, not an estimate of everything lost: it counts only the shoppers who
reported, and never multiplies them up to the whole store.

Reports fall into two kinds by what the manager found when closing them:

- empty shelf: the stock had run out ("restocked"), or nobody has looked yet;
- misplaced: the item was there, somewhere else or on its shelf all along. The
  shopper still left without it, so it is still money, but the fix is signage or the
  map, not ordering.

What shoppers searched for and the store doesn't carry is the third kind, counted by
the search analytics, since a store can't put a shelf price on what it doesn't sell.
"""

from collections import defaultdict
from collections.abc import Iterable, Sequence
from datetime import datetime
from statistics import median
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.domain.events import RESTOCKED, ReportRecord
from app.domain.inventory import PricedProduct, product_id_of_stop
from app.domain.search_text import normalize

# How a missing item's price was found, from most to least exact.
PriceBasis = Literal["product", "similar", "department"]
ItemState = Literal["open", "restocked", "misplaced"]

_SECONDS_PER_MINUTE = 60


class _Fact(BaseModel):
    model_config = ConfigDict(frozen=True)


class PriceEstimate(_Fact):
    agorot: int
    basis: PriceBasis


class PriceBook:
    """Prices a report from what the shopper asked for.

    In order: the product they were routed to, a product with exactly that name, the
    median of the department's products whose names contain the words (or are
    contained in them, for "חלב" against "חלב 3% תנובה 1 ליטר"), and last the median
    of the whole department.
    """

    def __init__(self, products: Iterable[PricedProduct]) -> None:
        self._by_id: dict[int, PricedProduct] = {}
        self._by_name: dict[str, PricedProduct] = {}
        self._by_department: dict[str, list[PricedProduct]] = defaultdict(list)
        for product in products:
            if product.price_agorot is None:
                continue
            self._by_id[product.id] = product
            self._by_name[product.name_key] = product
            self._by_department[product.department].append(product)

    def estimate(self, item_query: str, category_id: str | None) -> PriceEstimate | None:
        product_id = product_id_of_stop(category_id) if category_id else None
        product = self._by_id.get(product_id) if product_id is not None else None
        key = normalize(item_query)
        product = product or self._by_name.get(key)
        if product is not None and product.price_agorot is not None:
            return PriceEstimate(agorot=product.price_agorot, basis="product")

        department = self._by_department.get(category_id or "", [])
        similar = [
            candidate.price_agorot
            for candidate in department
            if key and candidate.price_agorot is not None and (key in candidate.name_key or candidate.name_key in key)
        ]
        if similar:
            return PriceEstimate(agorot=round(median(similar)), basis="similar")
        prices = [candidate.price_agorot for candidate in department if candidate.price_agorot is not None]
        if prices:
            return PriceEstimate(agorot=round(median(prices)), basis="department")
        return None


class Bucket(_Fact):
    reports: int
    items: int
    value_agorot: int


class LostItem(_Fact):
    item: str
    category_id: str | None
    reports: int
    open_reports: int
    picker_reports: int
    unit_price_agorot: int | None
    price_basis: PriceBasis | None
    value_agorot: int
    state: ItemState
    last_reported_at: datetime


class LostSalesSummary(_Fact):
    reports: int
    # How many had any price, and how many the product's own.
    priced_reports: int
    exact_reports: int
    value_agorot: int
    empty_shelf: Bucket
    misplaced: Bucket
    open_alerts: int
    open_value_agorot: int
    # Alerts closed as restocked in the period, and the median from first report to refilled.
    restocked_alerts: int
    restock_median_minutes: float | None
    items: list[LostItem]


def _is_misplaced(record: ReportRecord) -> bool:
    return record.resolution in ("relocated", "on_shelf")


def _is_restocked(record: ReportRecord) -> bool:
    # A report closed before closing asked why was closed from the restock button.
    return record.resolved_at is not None and record.resolution in (RESTOCKED, None)


def _bucket(records: Sequence[ReportRecord], values: dict[tuple[str, str | None], int]) -> Bucket:
    keys = {(record.item_query, record.category_id) for record in records}
    return Bucket(
        reports=len(records),
        items=len(keys),
        value_agorot=sum(values.get((record.item_query, record.category_id), 0) for record in records),
    )


def restock_minutes(records: Iterable[ReportRecord], since: datetime, until: datetime) -> list[float]:
    """Each alert refilled in the period: minutes from its first report to the manager closing it.

    One alert is the reports of one item closed together, which share their `resolved_at`.
    """
    first_report: dict[tuple[str, str | None, datetime], datetime] = {}
    for record in records:
        if not _is_restocked(record) or record.resolved_at is None:
            continue
        if not since <= record.resolved_at < until:
            continue
        key = (record.item_query, record.category_id, record.resolved_at)
        first_report[key] = min(first_report.get(key, record.timestamp), record.timestamp)
    return [
        max(0.0, (resolved_at - first).total_seconds() / _SECONDS_PER_MINUTE)
        for (_, _, resolved_at), first in first_report.items()
    ]


def summarize(
    records: Sequence[ReportRecord], prices: PriceBook, since: datetime, until: datetime
) -> LostSalesSummary:
    """The reports made in [since, until), valued; restock times for alerts closed in it.

    `records` may reach further back: an alert refilled this week can have been
    reported the week before.
    """
    in_period = [record for record in records if since <= record.timestamp < until]

    estimates: dict[tuple[str, str | None], PriceEstimate | None] = {}
    for record in in_period:
        key = (record.item_query, record.category_id)
        if key not in estimates:
            estimates[key] = prices.estimate(record.item_query, record.category_id)
    values = {key: estimate.agorot for key, estimate in estimates.items() if estimate is not None}

    by_item: dict[tuple[str, str | None], list[ReportRecord]] = defaultdict(list)
    for record in in_period:
        by_item[(record.item_query, record.category_id)].append(record)

    items: list[LostItem] = []
    for key, reports in by_item.items():
        estimate = estimates[key]
        open_reports = sum(1 for record in reports if record.resolved_at is None)
        latest = max(reports, key=lambda record: record.timestamp)
        state: ItemState = (
            "open" if open_reports else "misplaced" if _is_misplaced(latest) else "restocked"
        )
        items.append(
            LostItem(
                item=key[0],
                category_id=key[1],
                reports=len(reports),
                open_reports=open_reports,
                picker_reports=sum(1 for record in reports if record.source == "picker"),
                unit_price_agorot=estimate.agorot if estimate else None,
                price_basis=estimate.basis if estimate else None,
                value_agorot=(estimate.agorot if estimate else 0) * len(reports),
                state=state,
                last_reported_at=latest.timestamp,
            )
        )
    items.sort(key=lambda item: (-item.value_agorot, -item.reports, -item.last_reported_at.timestamp(), item.item))

    misplaced = [record for record in in_period if _is_misplaced(record)]
    empty = [record for record in in_period if not _is_misplaced(record)]
    still_open = [record for record in in_period if record.resolved_at is None]
    minutes = restock_minutes(records, since, until)
    priced = [record for record in in_period if estimates[(record.item_query, record.category_id)] is not None]
    exact = [
        record
        for record in priced
        if (estimate := estimates[(record.item_query, record.category_id)]) is not None and estimate.basis == "product"
    ]
    return LostSalesSummary(
        reports=len(in_period),
        priced_reports=len(priced),
        exact_reports=len(exact),
        value_agorot=sum(values.get((record.item_query, record.category_id), 0) for record in in_period),
        empty_shelf=_bucket(empty, values),
        misplaced=_bucket(misplaced, values),
        open_alerts=len({(record.item_query, record.category_id) for record in still_open}),
        open_value_agorot=_bucket(still_open, values).value_agorot,
        restocked_alerts=len(minutes),
        restock_median_minutes=round(median(minutes), 1) if minutes else None,
        items=items,
    )

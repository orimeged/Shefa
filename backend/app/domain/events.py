"""Facts recorded about what shoppers did. Events are appended and never changed."""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal, Protocol
from uuid import UUID, uuid4

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints

# One report can be a mistake. The dashboard treats this many as a real problem.
ALERT_THRESHOLD = 3
# How far back an open report still counts toward an item's alert.
ALERT_WINDOW = timedelta(days=7)

# A phone's clock can be wrong. An event can't have happened in the future.
_MAX_CLOCK_SKEW = timedelta(minutes=5)

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
ShortId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]

# What a manager found on closing a report. The first is stock that ran out; the
# other two mean the item was there and the shopper couldn't find it.
Resolution = Literal["restocked", "relocated", "on_shelf"]
RESTOCKED: Resolution = "restocked"

# Who reported it. Only staff can send "picker" reports, through their own endpoint.
Source = Literal["shopper", "picker"]


class NotFoundReport(BaseModel):
    """What the app sends when an item wasn't at the location it was navigated to.

    `event_id` comes from the client, so a retry on a weak signal can't count twice.
    `timestamp` is when it happened, which may be well before a queued report arrives.
    """

    model_config = ConfigDict(extra="forbid")

    event_id: UUID = Field(default_factory=uuid4)
    store_id: ShortId
    session_id: ShortId
    item_query: Text
    category_id: ShortId | None = None
    x_coord: float = Field(allow_inf_nan=False)
    y_coord: float = Field(allow_inf_nan=False)
    timestamp: AwareDatetime | None = None


class NotFoundEvent(BaseModel):
    model_config = ConfigDict(frozen=True)

    event_id: UUID
    store_id: str
    session_id: str
    item_query: str
    category_id: str | None
    x_coord: float
    y_coord: float
    timestamp: datetime
    source: Source = "shopper"

    @classmethod
    def from_report(
        cls, report: NotFoundReport, now: datetime | None = None, source: Source = "shopper"
    ) -> "NotFoundEvent":
        received_at = now or datetime.now(UTC)
        happened_at = (report.timestamp or received_at).astimezone(UTC)
        if happened_at > received_at + _MAX_CLOCK_SKEW:
            happened_at = received_at
        return cls(
            event_id=report.event_id,
            store_id=report.store_id,
            session_id=report.session_id,
            item_query=report.item_query,
            category_id=report.category_id,
            x_coord=report.x_coord,
            y_coord=report.y_coord,
            timestamp=happened_at,
            source=source,
        )


class NotFoundTally(BaseModel):
    """How often one item was reported missing, and when it last was."""

    model_config = ConfigDict(frozen=True)

    category_id: str | None
    item_query: str
    times_reported: int
    last_reported_at: datetime


class ReportRecord(BaseModel):
    """One report as stored, with how it was closed, for the reports that add them up."""

    model_config = ConfigDict(frozen=True)

    item_query: str
    category_id: str | None
    timestamp: datetime
    resolved_at: datetime | None
    # None on a report closed before closing said why, or one still open.
    resolution: Resolution | None
    source: Source


class EventStore(Protocol):
    def append(self, event: NotFoundEvent) -> bool:
        """Stores `event`. False means this event_id was already recorded."""
        ...

    def tally_not_found(self, store_id: str, since: datetime) -> list[NotFoundTally]:
        """Every item with an open alert since `since`, the most reported first."""
        ...

    def resolve_not_found(
        self,
        store_id: str,
        item_query: str,
        category_id: str | None,
        at: datetime,
        resolution: Resolution = RESTOCKED,
    ) -> int:
        """Closes an item's open reports and returns how many. A later report opens a new alert."""
        ...

    def report_records(self, store_id: str, since: datetime) -> list[ReportRecord]:
        """Every report made since `since`, open or closed, oldest first."""
        ...

    def open_reports(self, store_id: str, item_query: str, category_id: str | None, since: datetime) -> int:
        """An item's reports still open since `since`."""
        ...

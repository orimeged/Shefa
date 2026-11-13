"""Online orders picked in the store: the minutes each took, for the picking pilot's one figure."""

from collections.abc import Sequence
from datetime import datetime, timedelta
from statistics import median
from typing import Protocol
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

# An order picked in under a minute or over four hours wasn't really picked that way:
# a phone left open overnight shouldn't move the median.
MIN_PICK = timedelta(minutes=1)
MAX_PICK = timedelta(hours=4)
_MAX_LINES = 200


class PickSession(BaseModel):
    """One order, from the picker's first tap to "done"."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: UUID
    store_id: str = Field(min_length=1, max_length=64)
    started_at: AwareDatetime
    finished_at: AwareDatetime
    lines: int = Field(ge=1, le=_MAX_LINES)
    missing: int = Field(ge=0, le=_MAX_LINES)

    @model_validator(mode="after")
    def _sensible(self) -> "PickSession":
        if self.missing > self.lines:
            raise ValueError("more missing lines than lines")
        if self.finished_at < self.started_at:
            raise ValueError("finished before it started")
        return self

    @property
    def minutes(self) -> float:
        return (self.finished_at - self.started_at).total_seconds() / 60

    @property
    def counts(self) -> bool:
        """Whether it belongs in the median: neither a misfire nor a forgotten phone."""
        return MIN_PICK <= self.finished_at - self.started_at <= MAX_PICK


class PickingSummary(BaseModel):
    model_config = ConfigDict(frozen=True)

    orders: int
    lines: int
    missing: int
    median_minutes: float | None
    median_minutes_per_line: float | None


def summarize_picks(sessions: Sequence[PickSession]) -> PickingSummary:
    timed = [session for session in sessions if session.counts]
    return PickingSummary(
        orders=len(sessions),
        lines=sum(session.lines for session in sessions),
        missing=sum(session.missing for session in sessions),
        median_minutes=round(median(session.minutes for session in timed), 1) if timed else None,
        median_minutes_per_line=round(median(session.minutes / session.lines for session in timed), 2) if timed else None,
    )


class PickStore(Protocol):
    def record(self, session: PickSession) -> bool: ...

    def sessions(self, store_id: str, since: datetime, until: datetime) -> list[PickSession]: ...

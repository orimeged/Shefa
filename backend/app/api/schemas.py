"""Request bodies. Responses use the domain models directly."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

# One shopping trip, so analytics can count it once however often a list changes.
SessionId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


class RouteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_ids: list[str] = Field(min_length=1, max_length=50)
    start_node_id: str | None = None
    session_id: SessionId | None = None


class ResolveListRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lines: list[Annotated[str, StringConstraints(min_length=1, max_length=200)]] = Field(
        min_length=1, max_length=100
    )
    session_id: SessionId | None = None

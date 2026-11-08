"""Endpoints for store managers.

Everything here sits behind one shared token. It edits what shoppers are told, and
map-audio spends money on two paid APIs, so with no token set the whole area stays
closed instead of open.
"""

import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field

from app.domain.dictionary import NO_MATCH
from app.domain.events import EventStore, ShortId, Text
from app.domain.inventory import (
    MAX_ITEM_NAME,
    CatalogCategory,
    CatalogEntry,
    DictatedItem,
    EntityType,
    InvalidItemError,
    InventoryError,
    StagedItem,
    Zone,
    ZoneItem,
)
from app.domain.search_text import normalize
from app.domain.speech import SUPPORTED_AUDIO_TYPES, TranscriptionError, base_content_type
from app.repositories.inventory_repository import SqlInventoryRepository
from app.services.navigation import NavigationService
from app.services.transcription import TranscriptionService

_bearer = HTTPBearer(auto_error=False)

# Far above what the recorder sends. Safari ignores the bitrate it's asked for.
_MAX_AUDIO_BYTES = 16 * 1024 * 1024
_MAX_BATCH_ITEMS = 100
_MAX_CATALOG_RESULTS = 20
_REPORT_WINDOW = timedelta(days=7)


def require_admin(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> None:
    expected: str | None = request.app.state.admin_token
    if expected is None:
        raise HTTPException(503, "The dashboard is locked: ADMIN_TOKEN isn't set")
    supplied = credentials.credentials if credentials else ""
    if not secrets.compare_digest(supplied.encode(), expected.encode()):
        raise HTTPException(401, "Invalid token", headers={"WWW-Authenticate": "Bearer"})


router = APIRouter(prefix="/api/v1/admin", tags=["admin"], dependencies=[Depends(require_admin)])
stores_router = APIRouter(prefix="/stores/{store_id}")


def _inventory(request: Request) -> SqlInventoryRepository:
    return request.app.state.inventory


Inventory = Annotated[SqlInventoryRepository, Depends(_inventory)]


class AssignmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_type: EntityType
    entity_id: int
    # Takes a product off every other zone, instead of adding one more place it stands.
    relocate: bool = False


class BatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[StagedItem] = Field(min_length=1, max_length=_MAX_BATCH_ITEMS)
    relocate: bool = False


class MoveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    to_node_id: int


class NotFoundReportRow(BaseModel):
    item_query: str
    # What the shopper was routed to: a category slug or a product stop.
    category_id: str | None
    # Empty when a report named no category, or one the store has since dropped.
    catalog_category_id: int | None
    category_name: str | None
    category_name_en: str | None
    times_reported: int
    last_reported_at: datetime


class ResolveNotFoundRequest(BaseModel):
    """Names one row of the report, so `category_id` is null for a row without one."""

    model_config = ConfigDict(extra="forbid")

    store_id: ShortId
    item_query: Text
    category_id: ShortId | None = None


class ResolveNotFoundResponse(BaseModel):
    resolved: int


class MapAudioResponse(BaseModel):
    transcript: str
    items: list[DictatedItem]
    classified_by: Literal["claude", "dictionary"]


async def inventory_error_response(_request: Request, error: Exception) -> JSONResponse:
    code = 422 if isinstance(error, InvalidItemError) else 404
    return JSONResponse({"detail": str(error)}, status_code=code)


@router.get("/session", status_code=status.HTTP_204_NO_CONTENT)
def check_session() -> Response:
    """Lets the sign-in screen test a token. The dependency above does the work."""
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@stores_router.get("/nodes")
def list_zones(store_id: str, inventory: Inventory) -> list[Zone]:
    return inventory.zones(store_id)


@stores_router.get("/categories")
def list_categories(store_id: str, inventory: Inventory) -> list[CatalogCategory]:
    return inventory.categories(store_id)


@stores_router.get("/catalog")
def search_catalog(
    store_id: str,
    inventory: Inventory,
    q: Annotated[str, Query(min_length=1, max_length=120)],
    limit: Annotated[int, Query(ge=1, le=_MAX_CATALOG_RESULTS)] = 8,
) -> list[CatalogEntry]:
    return inventory.search_catalog(store_id, q, limit)


@stores_router.get("/nodes/{node_id}/assignments")
def list_assignments(store_id: str, node_id: int, inventory: Inventory) -> list[ZoneItem]:
    return inventory.zone_items(store_id, node_id)


@stores_router.post("/nodes/{node_id}/assignments", status_code=status.HTTP_201_CREATED)
def create_assignment(
    store_id: str, node_id: int, body: AssignmentRequest, inventory: Inventory
) -> list[ZoneItem]:
    return inventory.assign(
        store_id, node_id, body.entity_type, body.entity_id, relocate=body.relocate
    )


@stores_router.post("/nodes/{node_id}/assignments/batch", status_code=status.HTTP_201_CREATED)
def create_assignments(
    store_id: str, node_id: int, body: BatchRequest, inventory: Inventory
) -> list[ZoneItem]:
    return inventory.assign_batch(store_id, node_id, body.items, relocate=body.relocate)


@stores_router.patch("/nodes/{node_id}/assignments/{entity_type}/{entity_id}")
def move_assignment(
    store_id: str,
    node_id: int,
    entity_type: EntityType,
    entity_id: int,
    body: MoveRequest,
    inventory: Inventory,
) -> list[ZoneItem]:
    return inventory.move(store_id, node_id, entity_type, entity_id, body.to_node_id)


@stores_router.delete(
    "/nodes/{node_id}/assignments/{entity_type}/{entity_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_assignment(
    store_id: str, node_id: int, entity_type: EntityType, entity_id: int, inventory: Inventory
) -> Response:
    inventory.unassign(store_id, node_id, entity_type, entity_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


router.include_router(stores_router)


@router.get("/reports/not-found")
def not_found_report(
    request: Request,
    inventory: Inventory,
    store_id: Annotated[str, Query(min_length=1, max_length=64)],
) -> list[NotFoundReportRow]:
    """Open alerts from the last week, the most reported first."""
    if request.app.state.stores.get(store_id) is None:
        raise HTTPException(404, f"Unknown store: {store_id}")

    events: EventStore = request.app.state.events
    tallies = events.tally_not_found(store_id, datetime.now(UTC) - _REPORT_WINDOW)
    departments = inventory.departments_of(
        store_id, {tally.category_id for tally in tallies if tally.category_id}
    )
    rows: list[NotFoundReportRow] = []
    for tally in tallies:
        department = departments.get(tally.category_id or "")
        rows.append(
            NotFoundReportRow(
                item_query=tally.item_query,
                category_id=tally.category_id,
                catalog_category_id=department.id if department else None,
                category_name=department.name if department else None,
                category_name_en=department.name_en if department else None,
                times_reported=tally.times_reported,
                last_reported_at=tally.last_reported_at,
            )
        )
    return rows


@router.post("/reports/not-found/resolve")
def resolve_not_found(request: Request, body: ResolveNotFoundRequest) -> ResolveNotFoundResponse:
    """Closes one row's alert. Sending it twice is fine: the second closes nothing."""
    if request.app.state.stores.get(body.store_id) is None:
        raise HTTPException(404, f"Unknown store: {body.store_id}")

    events: EventStore = request.app.state.events
    resolved = events.resolve_not_found(
        body.store_id, body.item_query, body.category_id, datetime.now(UTC)
    )
    return ResolveNotFoundResponse(resolved=resolved)


def _describe_categories(request: Request, store_id: str) -> dict[str, str]:
    """Each category with its everyday terms, for the model to choose from."""
    departments = request.app.state.dictionary.departments
    described: dict[str, str] = {}
    for category in request.app.state.inventory.categories(store_id):
        department = departments.get(category.slug)
        terms = f" ({department.description}): {' | '.join(department.terms)}" if department else ""
        described[category.slug] = f"{category.name}{terms}"
    return described


async def _read_audio(request: Request) -> bytes:
    audio = bytearray()
    async for chunk in request.stream():
        audio += chunk
        if len(audio) > _MAX_AUDIO_BYTES:
            raise HTTPException(413, "Recording too large")
    return bytes(audio)


@router.post("/map-audio")
async def map_audio(
    request: Request,
    store_id: Annotated[str, Query(min_length=1, max_length=64)],
    content_type: Annotated[str, Header()],
    language: Annotated[str, Query(pattern="^(he|en)$")] = "he",
) -> MapAudioResponse:
    """Audio to a list for review. Nothing is saved until a manager approves it."""
    navigation: NavigationService | None = await run_in_threadpool(
        request.app.state.stores.get, store_id
    )
    if navigation is None:
        raise HTTPException(404, f"Unknown store: {store_id}")
    transcription: TranscriptionService | None = request.app.state.inventory_transcription
    if transcription is None:
        raise HTTPException(503, "Speech recognition isn't configured")
    if base_content_type(content_type) not in SUPPORTED_AUDIO_TYPES:
        raise HTTPException(415, "Unsupported audio type")

    audio = await _read_audio(request)
    if not audio:
        return MapAudioResponse(transcript="", items=[], classified_by="dictionary")
    try:
        transcript = await transcription.transcribe(audio, content_type, language)
    except TranscriptionError as error:
        raise HTTPException(502, "Transcription failed") from error
    if not transcript:
        return MapAudioResponse(transcript="", items=[], classified_by="dictionary")

    extractor = request.app.state.inventory_extractor
    if extractor is not None:
        categories = await run_in_threadpool(_describe_categories, request, store_id)
        items = await run_in_threadpool(extractor.extract, transcript, categories)
        if items is not None:
            return MapAudioResponse(transcript=transcript, items=items, classified_by="claude")

    # The audio is paid for and the words are good, so a Claude outage shouldn't lose them.
    guesses = await run_in_threadpool(navigation.read_items, transcript)
    return MapAudioResponse(
        transcript=transcript,
        items=_unique_items(guesses),
        classified_by="dictionary",
    )


def _unique_items(guesses: list[tuple[str, str | None]]) -> list[DictatedItem]:
    unique: dict[str, DictatedItem] = {}
    for text, category in guesses:
        # With no punctuation, unknown words can run on for a whole recording.
        name = text[:MAX_ITEM_NAME].strip()
        unique.setdefault(
            normalize(name),
            DictatedItem(normalized_name=name, inferred_category=category or NO_MATCH),
        )
    return list(unique.values())

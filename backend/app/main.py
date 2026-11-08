"""Application factory."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from zoneinfo import ZoneInfo

import anthropic
import openai
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api.admin import inventory_error_response
from app.api.admin import router as admin_router
from app.api.analytics import router as analytics_router
from app.api.events import router as events_router
from app.api.list_photo import router as list_photo_router
from app.api.routes import router
from app.api.transcription import router as transcription_router
from app.config import Settings
from app.domain.classifier import ItemClassifier
from app.domain.inventory import InventoryError
from app.domain.list_photo import ListPhotoReader
from app.domain.speech import SpeechToText
from app.repositories.analytics_store import SqlAnalyticsStore
from app.repositories.database import create_database_engine, migrate, printable_url
from app.repositories.event_store import SqlEventStore
from app.repositories.legacy_events import import_legacy_events
from app.repositories.inventory_repository import SqlInventoryRepository
from app.repositories.store_repository import JsonStoreRepository, load_dictionary
from app.services.claude_classifier import DEFAULT_MODEL as DEFAULT_LLM_MODEL
from app.services.claude_classifier import ClaudeItemClassifier
from app.services.claude_inventory import ClaudeInventoryExtractor
from app.services.openai_list_photo import DEFAULT_MODEL as DEFAULT_LIST_PHOTO_MODEL
from app.services.openai_list_photo import OpenAIListPhotoReader
from app.services.openai_speech import DEFAULT_MODEL as DEFAULT_STT_MODEL
from app.services.openai_speech import DEFAULT_TIMEOUT_SECONDS, OpenAISpeechToText
from app.services.store_registry import StoreRegistry
from app.services.stub_list_photo import StubListPhotoReader
from app.services.stub_speech import StubSpeechToText
from app.services.transcription import TranscriptionService

logger = logging.getLogger(__name__)

# A two-minute walk along a shelf, against a few seconds for a shopper's phrase.
_INVENTORY_SPEECH_TIMEOUT_SECONDS = 90.0
_INVENTORY_SPEECH_CALLS_PER_MINUTE = 20


def build_classifier(settings: Settings) -> ItemClassifier | None:
    """The dictionary covers common food, so the app runs fine without this."""
    if not settings.llm_enabled:
        logger.info("Smart categorization is off, using the food dictionary only")
        return None
    return ClaudeItemClassifier(anthropic.Anthropic(), settings.llm_model or DEFAULT_LLM_MODEL)


def build_inventory_extractor(settings: Settings) -> ClaudeInventoryExtractor | None:
    return (
        ClaudeInventoryExtractor(anthropic.Anthropic(), settings.llm_model or DEFAULT_LLM_MODEL)
        if settings.llm_enabled
        else None
    )


def build_list_photo_reader(settings: Settings) -> ListPhotoReader | None:
    """With none, the phone says so and the shopper types or pastes instead."""
    match settings.list_photo_engine:
        case "openai":
            model = settings.list_photo_model or DEFAULT_LIST_PHOTO_MODEL
            return OpenAIListPhotoReader(openai.AsyncOpenAI(), model)
        case "stub":
            logger.warning("List photos are a stub: every photo reads as the same list")
            return StubListPhotoReader()
        case _:
            logger.info("Reading list photos is off")
            return None


def build_speech_engine(
    settings: Settings, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
) -> SpeechToText | None:
    """With none, the app tells the phone to use the keyboard's own microphone."""
    match settings.stt_engine:
        case "openai":
            model = settings.stt_model or DEFAULT_STT_MODEL
            return OpenAISpeechToText(openai.AsyncOpenAI(), model, timeout_seconds)
        case "stub":
            logger.warning("Speech-to-text is a stub: dictation returns made-up words")
            return StubSpeechToText()
        case _:
            logger.info("Speech-to-text is off")
            return None


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Building every store here makes bad map data fail at startup.
        layouts = JsonStoreRepository(resolved.data_dir).list_stores()
        dictionary = load_dictionary(resolved.data_dir / "semantic" / "food_terms.json")
        database = create_database_engine(resolved.database_url)
        migrate(database)
        import_legacy_events(database, resolved.events_db)
        logger.info("Database: %s", printable_url(resolved.database_url))
        inventory = SqlInventoryRepository(database)
        for layout in layouts:
            inventory.sync_layout(layout)
        app.state.database = database
        app.state.inventory = inventory
        app.state.dictionary = dictionary
        app.state.stores = StoreRegistry(
            layouts, inventory, dictionary, build_classifier(resolved)
        )

        engine = build_speech_engine(resolved)
        app.state.transcription = TranscriptionService(engine) if engine else None
        inventory_engine = build_speech_engine(resolved, _INVENTORY_SPEECH_TIMEOUT_SECONDS)
        app.state.inventory_transcription = (
            TranscriptionService(inventory_engine, _INVENTORY_SPEECH_CALLS_PER_MINUTE)
            if inventory_engine
            else None
        )
        app.state.inventory_extractor = build_inventory_extractor(resolved)
        app.state.list_photo_reader = build_list_photo_reader(resolved)
        app.state.admin_token = resolved.admin_token
        app.state.allowed_origins = resolved.cors_origins
        app.state.allowed_origin_regex = resolved.cors_origin_regex
        app.state.events = SqlEventStore(database)
        app.state.analytics = SqlAnalyticsStore(database)
        app.state.store_timezone = ZoneInfo(resolved.store_timezone)
        yield
        database.dispose()

    app = FastAPI(title="Shefa API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved.cors_origins),
        allow_origin_regex=resolved.cors_origin_regex,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["*"],
    )
    # A full catalog makes the store map tens of kilobytes, on a store's weak signal.
    app.add_middleware(GZipMiddleware, minimum_size=2048)
    app.add_exception_handler(InventoryError, inventory_error_response)
    app.include_router(router)
    app.include_router(transcription_router)
    app.include_router(list_photo_router)
    app.include_router(events_router)
    app.include_router(admin_router)
    app.include_router(analytics_router)
    return app


app = create_app()

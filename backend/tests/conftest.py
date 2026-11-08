from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from app.config import Settings
from app.domain.dictionary import FoodDictionary
from app.domain.graph import StoreGraph
from app.domain.models import Department, Store
from app.main import create_app
from app.repositories.database import create_database_engine, migrate
from app.repositories.store_repository import JsonStoreRepository, load_dictionary
from app.services.navigation import NavigationService

ADMIN_TOKEN = "test-admin-token"


def migrated_engine(path: Path) -> Engine:
    """A database file with every migration applied, as the app would leave it."""
    engine = create_database_engine(f"sqlite:///{path.as_posix()}")
    migrate(engine)
    return engine


def database_file(settings: Settings) -> Path:
    """The SQLite file behind a test's settings, for reading it directly."""
    return Path(settings.database_url.removeprefix("sqlite:///"))


@pytest.fixture(autouse=True)
def _never_the_real_databases(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Whatever a test forgets, nothing it runs can reach backend/var."""
    monkeypatch.setenv("EVENTS_DB_PATH", str(tmp_path / "default-events.sqlite3"))
    monkeypatch.setenv(
        "DATABASE_URL", f"sqlite:///{(tmp_path / 'default-inventory.sqlite3').as_posix()}"
    )


@pytest.fixture(scope="session")
def store() -> Store:
    return JsonStoreRepository(Settings.from_env().data_dir).list_stores()[0]


@pytest.fixture(scope="session")
def dictionary() -> FoodDictionary:
    return load_dictionary(Settings.from_env().data_dir / "semantic" / "food_terms.json")


@pytest.fixture(scope="session")
def departments(dictionary: FoodDictionary) -> dict[str, Department]:
    return dict(dictionary.departments)


@pytest.fixture()
def settings(tmp_path: Path) -> Settings:
    """No paid services, and throwaway databases."""
    return replace(
        Settings.from_env(),
        llm_enabled=False,
        stt_engine="stub",
        list_photo_engine="stub",
        events_db=tmp_path / "events.sqlite3",
        database_url=f"sqlite:///{(tmp_path / 'inventory.sqlite3').as_posix()}",
        admin_token=ADMIN_TOKEN,
    )


@pytest.fixture(scope="session")
def graph(store: Store) -> StoreGraph:
    return StoreGraph.from_store(store)


@pytest.fixture(scope="session")
def navigation(store: Store, dictionary: FoodDictionary) -> NavigationService:
    return NavigationService(store, dictionary)


@pytest.fixture()
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client

"""Runtime settings, read from the environment and backend/.env."""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Self

from dotenv import load_dotenv

_ENV_FILE = Path(__file__).parent.parent / ".env"
_DEFAULT_DATA_DIR = Path(__file__).parent / "data"
_DEFAULT_EVENTS_DB = Path(__file__).parent.parent / "var" / "events.sqlite3"
_DEFAULT_DATABASE_URL = f"sqlite:///{(Path(__file__).parent.parent / 'var' / 'inventory.sqlite3').as_posix()}"
_DEFAULT_CORS_ORIGINS = "http://localhost:5173"
_DEFAULT_STORE_TIMEZONE = "Asia/Jerusalem"


@dataclass(frozen=True, slots=True)
class Settings:
    data_dir: Path
    cors_origins: tuple[str, ...]
    llm_enabled: bool
    llm_model: str | None
    stt_engine: str
    stt_model: str | None
    # Only read once: reports and analytics from before they moved into the database.
    events_db: Path
    database_url: str
    admin_token: str | None
    store_timezone: str
    list_photo_engine: str = "none"
    # Origins by pattern, for preview deployments whose address changes with each branch.
    cors_origin_regex: str | None = None
    list_photo_model: str | None = None

    @classmethod
    def from_env(cls) -> Self:
        # Fills os.environ because the API clients read their keys from there.
        # A variable already set in the shell wins over the file.
        load_dotenv(_ENV_FILE)
        origins = os.environ.get("CORS_ORIGINS", _DEFAULT_CORS_ORIGINS)
        has_llm_key = bool(
            os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
        )
        return cls(
            data_dir=Path(os.environ.get("STORE_DATA_DIR", _DEFAULT_DATA_DIR)),
            cors_origins=tuple(origin.strip() for origin in origins.split(",") if origin.strip()),
            llm_enabled=os.environ.get("LLM_ENABLED", "1" if has_llm_key else "0") == "1",
            llm_model=os.environ.get("LLM_MODEL") or None,
            stt_engine=os.environ.get(
                "STT_ENGINE", "openai" if os.environ.get("OPENAI_API_KEY") else "none"
            ),
            stt_model=os.environ.get("STT_MODEL") or None,
            events_db=Path(os.environ.get("EVENTS_DB_PATH", _DEFAULT_EVENTS_DB)),
            database_url=os.environ.get("DATABASE_URL", _DEFAULT_DATABASE_URL),
            admin_token=os.environ.get("ADMIN_TOKEN") or None,
            store_timezone=os.environ.get("STORE_TIMEZONE", _DEFAULT_STORE_TIMEZONE),
            list_photo_engine=os.environ.get(
                "LIST_PHOTO_ENGINE", "openai" if os.environ.get("OPENAI_API_KEY") else "none"
            ),
            list_photo_model=os.environ.get("LIST_PHOTO_MODEL") or None,
            cors_origin_regex=os.environ.get("CORS_ORIGIN_REGEX") or None,
        )

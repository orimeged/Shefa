import os
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import patch

import pytest

from app.config import Settings


@pytest.fixture()
def env_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Never the real .env, and whatever a test loads leaves with it."""
    path = tmp_path / ".env"
    monkeypatch.setattr("app.config._ENV_FILE", path)
    with patch.dict(os.environ):
        os.environ.pop("OPENAI_API_KEY", None)
        os.environ.pop("STT_ENGINE", None)
        yield path


def test_a_key_in_the_file_turns_dictation_on(env_file: Path) -> None:
    env_file.write_text("OPENAI_API_KEY=from-file\n")

    assert Settings.from_env().stt_engine == "openai"
    # The OpenAI client finds its key here, not in Settings.
    assert os.environ["OPENAI_API_KEY"] == "from-file"


def test_the_shell_wins_over_the_file(env_file: Path) -> None:
    env_file.write_text("OPENAI_API_KEY=from-file\n")
    os.environ["OPENAI_API_KEY"] = "from-shell"

    Settings.from_env()

    assert os.environ["OPENAI_API_KEY"] == "from-shell"


def test_no_file_leaves_dictation_off(env_file: Path) -> None:
    assert Settings.from_env().stt_engine == "none"


def test_cors_origins_are_cut_to_what_a_browser_sends(env_file: Path) -> None:
    # Copied from the address bar, with a slash, in quotes, in capitals.
    os.environ["CORS_ORIGINS"] = (
        "https://shefa-sandy.vercel.app/kiosk, https://Shop.Example.com/ ,"
        "'https://other.vercel.app', , http://localhost:5173"
    )

    assert Settings.from_env().cors_origins == (
        "https://shefa-sandy.vercel.app",
        "https://shop.example.com",
        "https://other.vercel.app",
        "http://localhost:5173",
    )


def test_a_star_or_a_bare_host_passes_through_unchanged(env_file: Path) -> None:
    os.environ["CORS_ORIGINS"] = "*,shefa.vercel.app"

    assert Settings.from_env().cors_origins == ("*", "shefa.vercel.app")

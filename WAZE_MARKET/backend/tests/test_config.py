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

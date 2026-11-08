"""The dictation endpoints, over a real WebSocket session in the test client."""

import json
import struct
from dataclasses import replace
from typing import Any

import httpx
import openai
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.config import Settings, parse_origins
from app.domain.speech import TranscriptionError
from app.main import create_app
from app.services.openai_speech import OpenAISpeechToText
from app.services.stub_speech import StubSpeechToText
from app.services.transcription import TranscriptionService, clean_transcript

WEBM = b"\x1a\x45\xdf\xa3" + b"audio" * 20
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"audio" * 20
START = {"type": "start", "mime_type": "audio/webm;codecs=opus", "language": "he"}


def frame(segment: int, audio: bytes) -> bytes:
    return struct.pack(">I", segment) + audio


def start(socket: Any, **overrides: Any) -> None:
    socket.send_text(json.dumps({**START, **overrides}))
    assert socket.receive_json() == {"type": "ready"}


def end_segment(socket: Any, segment: int) -> None:
    socket.send_text(json.dumps({"type": "segment_end", "segment": segment}))


def finish(socket: Any) -> None:
    socket.send_text(json.dumps({"type": "finish"}))


def test_transcribes_a_segment_sent_in_chunks(client: TestClient) -> None:
    with client.websocket_connect("/ws/transcribe") as socket:
        start(socket)
        socket.send_bytes(frame(0, WEBM[:30]))
        socket.send_bytes(frame(0, WEBM[30:]))
        end_segment(socket, 0)

        assert socket.receive_json() == {"type": "transcript", "segment": 0, "text": "חלב"}


def test_a_late_chunk_of_the_old_segment_lands_in_the_right_buffer(client: TestClient) -> None:
    with client.websocket_connect("/ws/transcribe") as socket:
        start(socket)
        socket.send_bytes(frame(0, WEBM[:30]))
        socket.send_bytes(frame(1, WEBM[:30]))
        socket.send_bytes(frame(0, WEBM[30:]))
        socket.send_bytes(frame(1, WEBM[30:]))
        end_segment(socket, 0)
        end_segment(socket, 1)

        texts = {socket.receive_json()["segment"] for _ in range(2)}
        assert texts == {0, 1}


def test_a_headerless_chunk_isnt_a_file(client: TestClient) -> None:
    with client.websocket_connect("/ws/transcribe") as socket:
        start(socket)
        socket.send_bytes(frame(0, b"only the middle of a recording"))
        end_segment(socket, 0)

        assert socket.receive_json() == {"type": "segment_failed", "segment": 0}


def test_a_failed_segment_doesnt_end_the_session(client: TestClient) -> None:
    with client.websocket_connect("/ws/transcribe") as socket:
        start(socket)
        socket.send_bytes(frame(0, b"broken"))
        end_segment(socket, 0)
        assert socket.receive_json()["type"] == "segment_failed"

        socket.send_bytes(frame(1, WEBM))
        end_segment(socket, 1)
        assert socket.receive_json()["type"] == "transcript"


def test_a_discarded_segment_costs_nothing(client: TestClient) -> None:
    with client.websocket_connect("/ws/transcribe") as socket:
        start(socket)
        socket.send_bytes(frame(0, WEBM))
        socket.send_text(json.dumps({"type": "segment_discard", "segment": 0}))
        socket.send_bytes(frame(0, WEBM))
        finish(socket)

        assert socket.receive_json() == {"type": "done"}


def test_an_empty_segment_is_an_empty_transcript(client: TestClient) -> None:
    with client.websocket_connect("/ws/transcribe") as socket:
        start(socket)
        end_segment(socket, 0)

        assert socket.receive_json() == {"type": "transcript", "segment": 0, "text": ""}


def test_finish_waits_for_transcripts_then_closes(client: TestClient) -> None:
    with client.websocket_connect("/ws/transcribe") as socket:
        start(socket)
        socket.send_bytes(frame(0, WEBM))
        end_segment(socket, 0)
        finish(socket)

        assert socket.receive_json()["type"] == "transcript"
        assert socket.receive_json() == {"type": "done"}
        with pytest.raises(WebSocketDisconnect):
            socket.receive_json()


def test_accepts_mp4_from_ios(client: TestClient) -> None:
    with client.websocket_connect("/ws/transcribe") as socket:
        start(socket, mime_type="audio/mp4")
        socket.send_bytes(frame(0, MP4))
        end_segment(socket, 0)

        assert socket.receive_json()["type"] == "transcript"


@pytest.mark.parametrize(
    "bad",
    [
        {"type": "start", "mime_type": "audio/ogg", "language": "he"},
        {"type": "start", "mime_type": "audio/webm", "language": "fr"},
        {"type": "hello"},
    ],
)
def test_a_bad_start_is_refused(client: TestClient, bad: dict[str, str]) -> None:
    with client.websocket_connect("/ws/transcribe") as socket:
        socket.send_text(json.dumps(bad))
        with pytest.raises(WebSocketDisconnect) as closed:
            socket.receive_json()

    assert closed.value.code == 1008


def test_a_binary_first_message_is_refused(client: TestClient) -> None:
    with client.websocket_connect("/ws/transcribe") as socket:
        socket.send_bytes(frame(0, WEBM))
        with pytest.raises(WebSocketDisconnect):
            socket.receive_json()


def test_an_oversized_segment_is_refused(client: TestClient) -> None:
    with client.websocket_connect("/ws/transcribe") as socket:
        start(socket)
        socket.send_bytes(frame(0, b"x" * (2 * 1024 * 1024 + 1)))
        with pytest.raises(WebSocketDisconnect) as closed:
            socket.receive_json()

    assert closed.value.code == 1009


def test_an_unknown_control_is_refused(client: TestClient) -> None:
    with client.websocket_connect("/ws/transcribe") as socket:
        start(socket)
        socket.send_text("not json")
        with pytest.raises(WebSocketDisconnect):
            socket.receive_json()


def test_a_foreign_origin_is_refused(client: TestClient) -> None:
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            "/ws/transcribe", headers={"origin": "https://evil.example"}
        ):
            pass


def test_the_same_host_is_allowed(client: TestClient) -> None:
    with client.websocket_connect(
        "/ws/transcribe",
        headers={"origin": "https://192.168.1.20:4173", "host": "192.168.1.20:4173"},
    ) as socket:
        start(socket)


PREVIEWS = r"https://shefa-[a-z0-9-]+\.vercel\.app"


def test_a_frontend_on_its_own_domain_is_allowed(settings: Settings) -> None:
    app = create_app(replace(settings, cors_origins=("https://shefa.vercel.app",)))
    with TestClient(app) as client, client.websocket_connect(
        "/ws/transcribe", headers={"origin": "https://shefa.vercel.app"}
    ) as socket:
        start(socket)


def test_a_preview_deployment_matching_the_pattern_is_allowed(settings: Settings) -> None:
    app = create_app(replace(settings, cors_origin_regex=PREVIEWS))
    with TestClient(app) as client, client.websocket_connect(
        "/ws/transcribe", headers={"origin": "https://shefa-git-main-team.vercel.app"}
    ) as socket:
        start(socket)


def test_the_pattern_must_match_the_whole_origin(settings: Settings) -> None:
    app = create_app(replace(settings, cors_origin_regex=PREVIEWS))
    with TestClient(app) as client, pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            "/ws/transcribe", headers={"origin": "https://shefa-x.vercel.app.evil.example"}
        ):
            pass


def test_api_calls_from_the_frontends_domain_get_cors_headers(settings: Settings) -> None:
    app = create_app(
        replace(settings, cors_origins=("https://shefa.vercel.app",), cors_origin_regex=PREVIEWS)
    )
    with TestClient(app) as client:
        for origin in ("https://shefa.vercel.app", "https://shefa-pr-12.vercel.app"):
            response = client.options(
                "/api/v1/stores/demo/map",
                headers={"origin": origin, "access-control-request-method": "GET"},
            )
            assert response.headers.get("access-control-allow-origin") == origin
        foreign = client.options(
            "/api/v1/stores/demo/map",
            headers={"origin": "https://evil.example", "access-control-request-method": "GET"},
        )
        assert "access-control-allow-origin" not in foreign.headers


def test_a_pasted_site_address_still_lets_its_search_through(settings: Settings) -> None:
    """The live failure: search answered 200 with no CORS header, so the page said unavailable."""
    pasted = parse_origins("https://shefa-sandy.vercel.app/kiosk")
    with TestClient(create_app(replace(settings, cors_origins=pasted))) as client:
        response = client.get(
            "/api/v1/stores/demo/search",
            params={"q": "חלב"},
            headers={"origin": "https://shefa-sandy.vercel.app"},
        )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "https://shefa-sandy.vercel.app"


def test_with_no_engine_the_socket_says_so(settings: Settings) -> None:
    with TestClient(create_app(replace(settings, stt_engine="none"))) as client:
        with client.websocket_connect("/ws/transcribe") as socket:
            with pytest.raises(WebSocketDisconnect) as closed:
                socket.receive_json()

    assert closed.value.code == 1013


def test_the_status_says_whether_dictation_can_work(
    client: TestClient, settings: Settings
) -> None:
    assert client.get("/api/v1/transcribe/status").json() == {"available": True}

    with TestClient(create_app(replace(settings, stt_engine="none"))) as without:
        assert without.get("/api/v1/transcribe/status").json() == {"available": False}


def test_the_upload_path_transcribes_a_whole_segment(client: TestClient) -> None:
    response = client.post(
        "/api/v1/transcribe?language=he",
        content=WEBM,
        headers={"content-type": "audio/webm;codecs=opus"},
    )

    assert response.status_code == 200
    assert response.json() == {"text": "חלב"}


def test_the_upload_path_refuses_an_unknown_type(client: TestClient) -> None:
    response = client.post(
        "/api/v1/transcribe", content=WEBM, headers={"content-type": "audio/ogg"}
    )

    assert response.status_code == 415


def test_the_upload_path_refuses_an_oversized_segment(client: TestClient) -> None:
    response = client.post(
        "/api/v1/transcribe",
        content=b"x" * (2 * 1024 * 1024 + 1),
        headers={"content-type": "audio/webm"},
    )

    assert response.status_code == 413


def test_the_upload_path_reports_a_failed_transcription(client: TestClient) -> None:
    response = client.post(
        "/api/v1/transcribe", content=b"broken", headers={"content-type": "audio/webm"}
    )

    assert response.status_code == 502


def test_the_upload_path_says_when_theres_no_engine(settings: Settings) -> None:
    with TestClient(create_app(replace(settings, stt_engine="none"))) as client:
        response = client.post(
            "/api/v1/transcribe", content=WEBM, headers={"content-type": "audio/webm"}
        )

    assert response.status_code == 503


@pytest.mark.parametrize("phrase", ["תודה", "תודה רבה.", "Thank you.", "Thanks for watching!", "  you "])
def test_drops_what_speech_models_invent_on_noise(phrase: str) -> None:
    assert clean_transcript(phrase) == ""


def test_keeps_real_items() -> None:
    assert clean_transcript("  חלב  ") == "חלב"
    assert clean_transcript("תודה על החלב") == "תודה על החלב"


async def test_the_service_refuses_past_its_budget() -> None:
    service = TranscriptionService(StubSpeechToText(), calls_per_minute=1)

    await service.transcribe(WEBM, "audio/webm", "he")
    with pytest.raises(TranscriptionError):
        await service.transcribe(WEBM, "audio/webm", "he")


def engine_with(handler: Any, model: str = "gpt-transcribe") -> tuple[OpenAISpeechToText, list[httpx.Request]]:
    requests: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    client = openai.AsyncOpenAI(
        api_key="test-key",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(record)),
    )
    return OpenAISpeechToText(client, model), requests


async def test_openai_sends_a_named_file_and_the_language_list() -> None:
    engine, requests = engine_with(lambda _: httpx.Response(200, json={"text": "חלב"}))

    assert await engine.transcribe(WEBM, "audio/webm;codecs=opus", "he") == "חלב"

    request = requests[0]
    body = request.content
    assert request.url.path.endswith("/audio/transcriptions")
    assert b'filename="segment.webm"' in body
    assert b"gpt-transcribe" in body
    assert b'name="languages[]"' in body or b'name="languages"' in body
    assert WEBM in body


async def test_older_models_get_the_single_language_hint() -> None:
    engine, requests = engine_with(lambda _: httpx.Response(200, json={"text": "milk"}), "whisper-1")

    await engine.transcribe(MP4, "audio/mp4", "en")

    body = requests[0].content
    assert b'name="language"' in body
    assert b'filename="segment.mp4"' in body


@pytest.mark.parametrize("status", [400, 401, 429, 500])
async def test_openai_failures_become_transcription_errors(status: int) -> None:
    engine, _ = engine_with(lambda _: httpx.Response(status, json={"error": {"message": "x"}}))

    with pytest.raises(TranscriptionError):
        await engine.transcribe(WEBM, "audio/webm", "he")


async def test_a_lost_connection_becomes_a_transcription_error() -> None:
    def fail(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    engine, _ = engine_with(fail)

    with pytest.raises(TranscriptionError):
        await engine.transcribe(WEBM, "audio/webm", "he")


async def test_refuses_a_type_it_cant_name() -> None:
    engine, requests = engine_with(lambda _: httpx.Response(200, json={"text": "x"}))

    with pytest.raises(TranscriptionError):
        await engine.transcribe(WEBM, "audio/ogg", "he")

    assert requests == []

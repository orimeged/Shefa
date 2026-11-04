"""Dictation endpoints.

The WebSocket is the main path. Audio arrives in binary frames, each starting
with a 4-byte big-endian segment number, because one recorder may still be
flushing while the next has started. A segment is a whole audio file: MediaRecorder
only writes a header in its first chunk, so chunks can't be transcribed alone, and
the client starts a new recorder at every pause instead.

The POST endpoint takes the same segments one at a time. iOS refuses wss:// to a
self-signed certificate even after the page's warning is accepted, and a dropped
socket in an aisle shouldn't lose what was said.
"""

import asyncio
import json
import re
import logging
import struct
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Header, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.domain.speech import (
    SUPPORTED_AUDIO_TYPES,
    SUPPORTED_LANGUAGES,
    TranscriptionError,
    base_content_type,
)
from app.services.transcription import TranscriptionService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["dictation"])

_SEGMENT_PREFIX = struct.Struct(">I")
_MAX_SEGMENT_BYTES = 2 * 1024 * 1024
_MAX_SEGMENTS = 120
_MAX_PENDING_SEGMENTS = 3
_IDLE_TIMEOUT_SECONDS = 45.0
_SESSION_TIMEOUT_SECONDS = 300.0
_FINISH_TIMEOUT_SECONDS = 30.0

_POLICY_VIOLATION = 1008
_TOO_BIG = 1009
_TRY_LATER = 1013


class TranscriptResponse(BaseModel):
    text: str


class DictationStatus(BaseModel):
    available: bool


def _origin_allowed(
    websocket: WebSocket, allowed: tuple[str, ...], pattern: str | None = None
) -> bool:
    """CORS doesn't cover WebSockets, so a site can't be stopped from opening one here."""
    origin = websocket.headers.get("origin")
    if origin is None:
        return True
    if origin in allowed:
        return True
    # The same rule CORS applies, which doesn't cover WebSockets.
    if pattern and re.fullmatch(pattern, origin):
        return True
    return urlsplit(origin).netloc == websocket.headers.get("host")


class _TranscriptionStream:
    def __init__(self, websocket: WebSocket, service: TranscriptionService) -> None:
        self._websocket = websocket
        self._service = service
        self._buffers: dict[int, bytearray] = {}
        self._closed_segments: set[int] = set()
        self._tasks: set[asyncio.Task[None]] = set()
        self._slots = asyncio.Semaphore(_MAX_PENDING_SEGMENTS)
        self._send_lock = asyncio.Lock()
        self._content_type = ""
        self._language = ""

    async def run(self) -> None:
        try:
            async with asyncio.timeout(_SESSION_TIMEOUT_SECONDS):
                if await self._handshake():
                    await self._receive_audio()
        except TimeoutError:
            await self._websocket.close(code=_POLICY_VIOLATION, reason="timeout")
        except WebSocketDisconnect:
            pass
        finally:
            for task in self._tasks:
                task.cancel()

    async def _next_message(self) -> dict[str, object]:
        message = await asyncio.wait_for(self._websocket.receive(), _IDLE_TIMEOUT_SECONDS)
        if message["type"] == "websocket.disconnect":
            raise WebSocketDisconnect(message.get("code", 1000))
        return message

    async def _handshake(self) -> bool:
        message = await self._next_message()
        control = self._parse_control(message.get("text"))
        content_type = base_content_type(str(control.get("mime_type", "")))
        language = control.get("language")
        if (
            control.get("type") != "start"
            or content_type not in SUPPORTED_AUDIO_TYPES
            or language not in SUPPORTED_LANGUAGES
        ):
            await self._websocket.close(code=_POLICY_VIOLATION, reason="bad start")
            return False
        self._content_type = content_type
        self._language = str(language)
        await self._send({"type": "ready"})
        return True

    async def _receive_audio(self) -> None:
        while True:
            message = await self._next_message()
            audio = message.get("bytes")
            if isinstance(audio, bytes):
                if not await self._store_frame(audio):
                    return
                continue

            control = self._parse_control(message.get("text"))
            kind = control.get("type")
            segment = control.get("segment")
            if kind == "segment_end" and isinstance(segment, int):
                await self._end_segment(segment)
            elif kind == "segment_discard" and isinstance(segment, int):
                self._buffers.pop(segment, None)
                self._closed_segments.add(segment)
            elif kind == "finish":
                await self._finish()
                return
            else:
                await self._websocket.close(code=_POLICY_VIOLATION, reason="bad message")
                return

    async def _store_frame(self, frame: bytes) -> bool:
        if len(frame) <= _SEGMENT_PREFIX.size:
            return True
        (segment,) = _SEGMENT_PREFIX.unpack_from(frame)
        if segment in self._closed_segments:
            return True
        if segment >= _MAX_SEGMENTS:
            await self._websocket.close(code=_POLICY_VIOLATION, reason="too many segments")
            return False
        buffer = self._buffers.setdefault(segment, bytearray())
        buffer += frame[_SEGMENT_PREFIX.size :]
        if len(buffer) > _MAX_SEGMENT_BYTES:
            await self._websocket.close(code=_TOO_BIG, reason="segment too large")
            return False
        return True

    async def _end_segment(self, segment: int) -> None:
        audio = self._buffers.pop(segment, None)
        self._closed_segments.add(segment)
        if not audio:
            await self._send({"type": "transcript", "segment": segment, "text": ""})
            return
        # Waiting here slows reading the socket, so a client can't queue unlimited work.
        await self._slots.acquire()
        task = asyncio.create_task(self._transcribe(segment, bytes(audio)))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _transcribe(self, segment: int, audio: bytes) -> None:
        try:
            text = await self._service.transcribe(audio, self._content_type, self._language)
            await self._send({"type": "transcript", "segment": segment, "text": text})
        except TranscriptionError as error:
            logger.warning("Segment %s failed: %s", segment, error)
            await self._send({"type": "segment_failed", "segment": segment})
        finally:
            self._slots.release()

    async def _finish(self) -> None:
        if self._tasks:
            await asyncio.wait(self._tasks, timeout=_FINISH_TIMEOUT_SECONDS)
        await self._send({"type": "done"})
        await self._websocket.close()

    async def _send(self, payload: dict[str, object]) -> None:
        async with self._send_lock:
            await self._websocket.send_text(json.dumps(payload, ensure_ascii=False))

    @staticmethod
    def _parse_control(text: object) -> dict[str, object]:
        if not isinstance(text, str):
            return {}
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}


@router.websocket("/ws/transcribe")
async def transcribe_stream(websocket: WebSocket) -> None:
    service: TranscriptionService | None = websocket.app.state.transcription
    if not _origin_allowed(
        websocket, websocket.app.state.allowed_origins, websocket.app.state.allowed_origin_regex
    ):
        await websocket.close(code=_POLICY_VIOLATION)
        return

    await websocket.accept()
    if service is None:
        await websocket.close(code=_TRY_LATER, reason="unavailable")
        return
    await _TranscriptionStream(websocket, service).run()


@router.get("/api/v1/transcribe/status")
async def dictation_status(request: Request) -> DictationStatus:
    return DictationStatus(available=request.app.state.transcription is not None)


@router.post("/api/v1/transcribe")
async def transcribe_segment(
    request: Request,
    content_type: Annotated[str, Header()],
    language: Annotated[str, Query(pattern="^(he|en)$")] = "he",
) -> TranscriptResponse:
    service: TranscriptionService | None = request.app.state.transcription
    if service is None:
        raise HTTPException(503, "Speech recognition isn't configured")
    if base_content_type(content_type) not in SUPPORTED_AUDIO_TYPES:
        raise HTTPException(415, "Unsupported audio type")

    audio = bytearray()
    async for chunk in request.stream():
        audio += chunk
        if len(audio) > _MAX_SEGMENT_BYTES:
            raise HTTPException(413, "Segment too large")
    if not audio:
        return TranscriptResponse(text="")

    try:
        text = await service.transcribe(bytes(audio), content_type, language)
    except TranscriptionError as error:
        raise HTTPException(502, "Transcription failed") from error
    return TranscriptResponse(text=text)

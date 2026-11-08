import { apiUrl } from "../api/backend";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Language } from "../i18n/strings";
import type { DictationStatus } from "../lib/dictation/dictationSession";
import { DictationSession } from "../lib/dictation/dictationSession";
import { openMicrophone } from "../lib/dictation/microphone";
import {
  browserRecorderFactory,
  pickMimeType,
  SegmentRecorder,
} from "../lib/dictation/segmentRecorder";
import { socketUrlFor, TranscriptionClient } from "../lib/dictation/transcriptionClient";

interface Options {
  language: Language;
  onTranscript: (text: string) => void;
}

/** Plain HTTP has no microphone, and older phones have no MediaRecorder. */
function supportedMimeType(): string | null {
  return window.isSecureContext && navigator.mediaDevices && typeof MediaRecorder !== "undefined"
    ? pickMimeType((type) => MediaRecorder.isTypeSupported(type))
    : null;
}

/**
 * Dictation recorded here and transcribed on the server. "unavailable" tells the
 * UI to fall back on the keyboard's own microphone, which every phone has.
 */
export function useDictation({ language, onTranscript }: Options) {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [failedSegments, setFailedSegments] = useState(0);
  const session = useRef<DictationSession | null>(null);

  /** Call from a tap: the microphone and audio only start inside one. */
  const start = useCallback(() => {
    const mimeType = supportedMimeType();
    if (!mimeType) {
      setStatus("unavailable");
      return;
    }

    session.current?.cancel();
    setFailedSegments(0);
    session.current = new DictationSession(
      {
        openMicrophone,
        createTransport: (events) =>
          new TranscriptionClient(
            {
              mimeType,
              language,
              socketUrl: socketUrlFor(window.location),
              uploadUrl: apiUrl("/api/v1/transcribe"),
              statusUrl: apiUrl("/api/v1/transcribe/status"),
            },
            events,
          ),
        createRecorder: (stream, sink) =>
          new SegmentRecorder(browserRecorderFactory(stream), mimeType, sink),
      },
      {
        status: setStatus,
        transcript: setTranscript,
        speaking: setIsSpeaking,
        failedSegments: setFailedSegments,
        finished: onTranscript,
      },
    );
    void session.current.start();
  }, [language, onTranscript]);

  const finish = useCallback(() => void session.current?.finish(), []);
  const cancel = useCallback(() => session.current?.cancel(), []);
  const dismissUnavailable = useCallback(
    () => setStatus((current) => (current === "unavailable" ? "idle" : current)),
    [],
  );

  useEffect(() => () => session.current?.cancel(), []);

  return {
    status,
    transcript,
    isSpeaking,
    failedSegments,
    start,
    finish,
    cancel,
    dismissUnavailable,
  };
}

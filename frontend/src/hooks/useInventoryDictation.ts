import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import type { MapAudioResult } from "../api/types";
import { ClipRecorder } from "../lib/admin/clipRecorder";
import type { Microphone } from "../lib/dictation/microphone";
import { openMicrophone } from "../lib/dictation/microphone";
import { browserRecorderFactory, pickMimeType } from "../lib/dictation/segmentRecorder";

export const MAX_RECORDING_SECONDS = 120;

export type DictationPhase = "idle" | "starting" | "recording" | "sending";
export type DictationProblem = "denied" | "unsupported" | "unavailable" | "failed" | "empty";

interface Options {
  send: (clip: Blob) => Promise<MapAudioResult>;
  onResult: (result: MapAudioResult) => void;
}

interface Session {
  microphone: Microphone;
  recorder: ClipRecorder;
  ticker: ReturnType<typeof setInterval>;
  wakeLock: Promise<WakeLockSentinel | null>;
}

/** The screen going dark would stop the microphone halfway along a shelf. */
function keepScreenOn(): Promise<WakeLockSentinel | null> {
  return navigator.wakeLock?.request("screen").catch(() => null) ?? Promise.resolve(null);
}

export function useInventoryDictation({ send, onResult }: Options) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [problem, setProblem] = useState<DictationProblem | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [canResend, setCanResend] = useState(false);
  const session = useRef<Session | null>(null);
  const clip = useRef<Blob | null>(null);
  // Goes up when a recording is called off, so a slow start can tell it was.
  const attempt = useRef(0);

  const latest = useRef({ send, onResult });
  useEffect(() => {
    latest.current = { send, onResult };
  });

  const release = useCallback(() => {
    const current = session.current;
    session.current = null;
    if (current) {
      clearInterval(current.ticker);
      current.microphone.close();
      void current.wakeLock.then((lock) => lock?.release());
    }
  }, []);

  const upload = useCallback(async (recorded: Blob) => {
    const thisAttempt = attempt.current;
    setPhase("sending");
    setProblem(null);
    setCanResend(false);
    try {
      const result = await latest.current.send(recorded);
      if (thisAttempt !== attempt.current) {
        return;
      }
      clip.current = null;
      setPhase("idle");
      if (result.items.length === 0) {
        setProblem("empty");
      } else {
        latest.current.onResult(result);
      }
    } catch (error) {
      if (thisAttempt !== attempt.current) {
        return;
      }
      setPhase("idle");
      const unavailable = error instanceof ApiError && error.status === 503;
      setProblem(unavailable ? "unavailable" : "failed");
      // A dropped signal in an aisle shouldn't mean walking the shelf again.
      setCanResend(!unavailable);
    }
  }, []);

  const start = useCallback(async () => {
    attempt.current += 1;
    const thisAttempt = attempt.current;
    clip.current = null;
    setCanResend(false);
    setProblem(null);
    setSeconds(0);

    const mimeType =
      typeof MediaRecorder === "undefined"
        ? null
        : pickMimeType((type) => MediaRecorder.isTypeSupported(type));
    if (!navigator.mediaDevices || !mimeType) {
      setProblem("unsupported");
      return;
    }

    setPhase("starting");
    let microphone: Microphone;
    try {
      microphone = await openMicrophone();
    } catch {
      if (thisAttempt === attempt.current) {
        setPhase("idle");
        setProblem("denied");
      }
      return;
    }
    if (thisAttempt !== attempt.current) {
      microphone.close();
      return;
    }

    const recorder = new ClipRecorder(browserRecorderFactory(microphone.stream), mimeType, (recorded) => {
      release();
      if (thisAttempt !== attempt.current) {
        return;
      }
      if (recorded) {
        clip.current = recorded;
        void upload(recorded);
      } else {
        setPhase("idle");
        setProblem("empty");
      }
    });

    const startedAt = Date.now();
    const ticker = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      setSeconds(elapsed);
      if (elapsed >= MAX_RECORDING_SECONDS) {
        recorder.stop();
      }
    }, 250);
    session.current = { microphone, recorder, ticker, wakeLock: keepScreenOn() };
    recorder.start();
    setPhase("recording");
  }, [release, upload]);

  const stop = useCallback(() => session.current?.recorder.stop(), []);

  const cancel = useCallback(() => {
    attempt.current += 1;
    session.current?.recorder.discard();
    release();
    clip.current = null;
    setCanResend(false);
    setProblem(null);
    setPhase("idle");
  }, [release]);

  const resend = useCallback(() => {
    if (clip.current) {
      void upload(clip.current);
    }
  }, [upload]);

  useEffect(
    () => () => {
      attempt.current += 1;
      session.current?.recorder.discard();
      release();
    },
    [release],
  );

  return { phase, problem, seconds, canResend, start, stop, cancel, resend };
}

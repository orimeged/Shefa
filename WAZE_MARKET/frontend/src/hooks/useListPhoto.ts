import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, readListPhoto } from "../api/client";
import { shrinkPhoto } from "../lib/list/photo";

const NOT_CONFIGURED = 503;

export type ListPhotoStatus = "idle" | "reading" | "read" | "unreadable" | "unavailable";

/** Reads a photo of a list. A newer photo, or `reset`, abandons the one before it. */
export function useListPhoto(onLines: (lines: readonly string[]) => void) {
  const [status, setStatus] = useState<ListPhotoStatus>("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    inFlight.current?.abort();
    setStatus("idle");
    setPreview(null);
  }, []);

  useEffect(() => {
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);

  useEffect(() => () => inFlight.current?.abort(), []);

  const read = useCallback(
    async (photo: File) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setStatus("reading");
      setPreview(null);

      const shrunk = await shrinkPhoto(photo);
      if (controller.signal.aborted) {
        return;
      }
      setPreview(URL.createObjectURL(shrunk));

      try {
        const lines = await readListPhoto(shrunk, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        onLines(lines);
        setStatus(lines.length > 0 ? "read" : "unreadable");
      } catch (error) {
        if (!controller.signal.aborted) {
          const notConfigured = error instanceof ApiError && error.status === NOT_CONFIGURED;
          setStatus(notConfigured ? "unavailable" : "unreadable");
        }
      }
    },
    [onLines],
  );

  return { status, preview, read, reset };
}

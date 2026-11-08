import { useCallback, useEffect, useRef, useState } from "react";

// The dashboard stays open on a manager's screen while shoppers walk the store.
const REFRESH_MS = 60_000;

/** Loads a report now and keeps it fresh. A failed refresh keeps the last one on screen. */
export function usePolledReport<T>(
  load: (signal: AbortSignal) => Promise<T>,
  refreshKey: number = 0,
) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      latest
        .current(controller.signal)
        .then((next) => {
          setData(next);
          setFailed(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setFailed(true);
          }
        });
    };

    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [attempt, refreshKey]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  return { data, failed, retry };
}

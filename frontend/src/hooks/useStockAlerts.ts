import { useCallback, useEffect, useRef, useState } from "react";

import type { NotFoundReportRow, Resolution } from "../api/types";
import { reportRowKey } from "../lib/admin/stockAlerts";

// Reports arrive from the aisles while the dashboard stays open.
const REFRESH_MS = 30_000;

/** What both the dashboard's API and the staff app's can do with alerts. */
export interface AlertSource {
  notFoundReport: (signal?: AbortSignal) => Promise<NotFoundReportRow[]>;
  resolveNotFound: (row: NotFoundReportRow, resolution?: Resolution) => Promise<unknown>;
}

interface Options {
  refreshMs?: number;
  /** Rows that weren't there at the last refresh. Never called for the first load. */
  onNew?: (rows: NotFoundReportRow[]) => void;
}

export function useStockAlerts(api: AlertSource, { refreshMs = REFRESH_MS, onNew }: Options = {}) {
  const [rows, setRows] = useState<NotFoundReportRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  // Keys seen so far; null until the first load, which is not news.
  const seen = useRef<Set<string> | null>(null);
  const latestOnNew = useRef(onNew);
  useEffect(() => {
    latestOnNew.current = onNew;
  });

  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      api
        .notFoundReport(controller.signal)
        .then((next) => {
          const known = seen.current;
          if (known) {
            const fresh = next.filter((row) => !known.has(reportRowKey(row)));
            if (fresh.length > 0) latestOnNew.current?.(fresh);
          }
          seen.current = new Set([...(known ?? []), ...next.map(reportRowKey)]);
          setRows(next);
          setFailed(false);
        })
        .catch(() => {
          // A failed refresh leaves the last report on screen, with a notice above it.
          if (!controller.signal.aborted) {
            setFailed(true);
          }
        });
    };

    load();
    const timer = setInterval(load, refreshMs);
    document.addEventListener("visibilitychange", load);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [api, attempt, refreshMs]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  /**
   * Closes an alert with what the manager found, and resolves to whether it closed.
   * Its row goes at once, and the report refreshes.
   */
  const resolve = useCallback(
    async (row: NotFoundReportRow, resolution: Resolution = "restocked"): Promise<boolean> => {
      const key = reportRowKey(row);
      setResolvingKey(key);
      try {
        await api.resolveNotFound(row, resolution);
        setRows((current) => current && current.filter((other) => reportRowKey(other) !== key));
        // A later report of the same item is a new alert, and news again.
        seen.current?.delete(key);
        // Restarting the effect also cancels any refresh that would bring the row back.
        retry();
        return true;
      } catch {
        return false;
      } finally {
        setResolvingKey(null);
      }
    },
    [api, retry],
  );

  return { rows, failed, retry, resolve, resolvingKey };
}

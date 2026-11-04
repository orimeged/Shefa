import { useCallback, useEffect, useState } from "react";

import type { AdminApi } from "../api/adminClient";
import type { NotFoundReportRow } from "../api/types";
import { reportRowKey } from "../lib/admin/stockAlerts";

// Reports arrive from the aisles while the dashboard stays open.
const REFRESH_MS = 30_000;

export function useStockAlerts(api: AdminApi) {
  const [rows, setRows] = useState<NotFoundReportRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      api
        .notFoundReport(controller.signal)
        .then((next) => {
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
    const timer = setInterval(load, REFRESH_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [api, attempt]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  /** Resolves to whether the alert closed. Its row goes at once, and the report refreshes. */
  const resolve = useCallback(
    async (row: NotFoundReportRow): Promise<boolean> => {
      const key = reportRowKey(row);
      setResolvingKey(key);
      try {
        await api.resolveNotFound(row);
        setRows((current) => current && current.filter((other) => reportRowKey(other) !== key));
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

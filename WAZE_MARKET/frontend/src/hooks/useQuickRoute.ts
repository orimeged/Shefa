import { useEffect, useState } from "react";

import { createRoute } from "../api/client";
import type { Route } from "../api/types";

interface QuickRoute {
  key: string;
  route: Route | null;
  failed: boolean;
}

/**
 * A walk from the entrance through a few items. Only the latest list's answer is
 * kept, but the last route stays up while the next one loads: blanking the map
 * on every change would flash it, and pins couldn't animate in or out.
 */
export function useQuickRoute(categoryIds: readonly string[], sessionId: string) {
  const key = categoryIds.join(",");
  const [result, setResult] = useState<QuickRoute>({ key: "", route: null, failed: false });

  useEffect(() => {
    if (!key) {
      return;
    }
    const controller = new AbortController();
    createRoute({ category_ids: key.split(","), session_id: sessionId }, controller.signal)
      .then((route) => setResult({ key, route, failed: false }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setResult({ key, route: null, failed: true });
        }
      });
    return () => controller.abort();
  }, [key, sessionId]);

  const failed = result.key === key && result.failed;
  return {
    // A failed re-plan shows nothing rather than the walk for the previous list.
    route: failed ? null : result.route,
    failed,
  };
}

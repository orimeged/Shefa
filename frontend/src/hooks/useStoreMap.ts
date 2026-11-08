import { useCallback, useEffect, useState } from "react";

import { getStoreMap } from "../api/client";
import type { StoreMap } from "../api/types";

export function useStoreMap() {
  const [map, setMap] = useState<StoreMap | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    getStoreMap(controller.signal)
      .then(setMap)
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
        }
      });
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  return { map, failed, retry };
}

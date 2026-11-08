import { useCallback, useEffect, useState } from "react";

import type { AdminApi } from "../api/adminClient";
import type { ZoneItem } from "../api/types";

/** What stands in one zone, and every change to it. */
export function useZoneInventory(api: AdminApi, nodeId: number, onChanged: () => void) {
  const [items, setItems] = useState<ZoneItem[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoadFailed(false);
    api
      .zoneItems(nodeId, controller.signal)
      .then(setItems)
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadFailed(true);
        }
      });
    return () => controller.abort();
  }, [api, nodeId, attempt]);

  const reload = useCallback(() => setAttempt((current) => current + 1), []);

  /** Resolves to whether it was saved. A failure reloads, since another manager may have got there first. */
  const save = useCallback(
    async (change: () => Promise<ZoneItem[]>): Promise<boolean> => {
      setIsSaving(true);
      setSaveFailed(false);
      try {
        setItems(await change());
        onChanged();
        return true;
      } catch {
        setSaveFailed(true);
        reload();
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [onChanged, reload],
  );

  return { items, loadFailed, saveFailed, isSaving, reload, save };
}

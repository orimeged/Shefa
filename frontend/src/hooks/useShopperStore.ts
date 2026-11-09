import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, createFloorRoute, createRoute, getFloorPlan, getStoreMap } from "../api/client";
import type { Route, RouteRequest, StoreMap } from "../api/types";
import type { FloorMap } from "../lib/floorPlanMap";
import { parseCellId, readFloorMap, routeFromGrid } from "../lib/floorPlanMap";
import type { MapLayout } from "../lib/mapGeometry";
import { buildMapLayout } from "../lib/mapGeometry";

export type PlanRoute = (request: RouteRequest, signal?: AbortSignal) => Promise<Route>;

interface Loaded {
  map: StoreMap;
  floor: FloorMap | null;
}

/**
 * The store as a shopper's screen needs it. `map` is the catalog, always loaded:
 * departments, and products managers placed. Once managers have drawn a plan
 * that can be walked, it is the map and its routes are the routes; until then,
 * the graph's.
 */
export function useShopperStore() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    Promise.all([getStoreMap(controller.signal), getFloorPlan(controller.signal)])
      .then(([map, saved]) => setLoaded({ map, floor: readFloorMap(saved) }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
        }
      });
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  const map = loaded?.map ?? null;
  const floor = loaded?.floor ?? null;
  const layout = useMemo<MapLayout | null>(
    () => floor?.layout ?? (map ? buildMapLayout(map) : null),
    [floor, map],
  );
  const planRoute = useMemo(() => routePlanner(floor), [floor]);

  return { map, floor, layout, planRoute, failed, retry };
}

/** Plans on the drawn plan when there is one, on the graph otherwise; the same shape back. */
export function routePlanner(floor: FloorMap | null): PlanRoute {
  if (!floor) {
    return createRoute;
  }
  return async ({ category_ids, start_node_id, session_id }, signal) => {
    const start = start_node_id ? parseCellId(start_node_id) : null;
    const body = { category_ids, session_id };
    try {
      return routeFromGrid(
        await createFloorRoute(start ? { ...body, start } : body, signal),
        floor.frame,
      );
    } catch (error) {
      // A plan saved since may have put a shelf where the shopper stood: go from the door.
      if (start && error instanceof ApiError && error.status === 422) {
        return routeFromGrid(await createFloorRoute(body, signal), floor.frame);
      }
      throw error;
    }
  };
}

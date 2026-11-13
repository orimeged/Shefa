import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Route, RouteRequest, RouteStop } from "../api/types";
import type { FoundSet } from "../lib/routeProgress";
import { applyToggle, currentPoint, pendingStops } from "../lib/routeProgress";
import type { PlanRoute } from "./useShopperStore";

interface Options {
  categoryIds: readonly string[];
  found: FoundSet;
  setFound: (found: FoundSet) => void;
  /** Where a reloaded trip left off. */
  restoredNodeId: string | null;
  sessionId: string;
  /** The graph's planner or the drawn plan's; both answer with the same route shape. */
  planRoute: PlanRoute;
  /**
   * Where an aisle-end sign said the shopper stands. Each new `seq` re-plans what's
   * left from there; a trip not yet planned starts there through `restoredNodeId`.
   */
  anchor?: { nodeId: string; seq: number } | null;
}

/**
 * The live route for a shopping list.
 *
 * Ticking the next stop only advances along the current route, so it works with
 * no signal. Any other change, including an item added mid-store, asks the
 * backend to re-plan from where the shopper is. A newer request cancels an older
 * one.
 */
export function useShoppingRoute({
  categoryIds,
  found,
  setFound,
  restoredNodeId,
  sessionId,
  planRoute,
  anchor = null,
}: Options) {
  const [route, setRoute] = useState<Route | null>(null);
  // Every stop seen so far: later routes leave out found items.
  const [knownStops, setKnownStops] = useState<ReadonlyMap<string, RouteStop>>(() => new Map());
  const [isUpdating, setIsUpdating] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  const latest = useRef({ route, found, sessionId, planRoute });
  useEffect(() => {
    latest.current = { route, found, sessionId, planRoute };
  });

  const plan = useCallback((request: RouteRequest) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setIsUpdating(true);
    setFailed(false);

    latest.current
      .planRoute({ ...request, session_id: latest.current.sessionId }, controller.signal)
      .then((next) => {
        setRoute(next);
        setKnownStops((known) => {
          const merged = new Map(known);
          next.stops.forEach((stop) => merged.set(stop.category_id, stop));
          return merged;
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
        }
      })
      .finally(() => {
        if (inFlight.current === controller) {
          inFlight.current = null;
          setIsUpdating(false);
        }
      });
  }, []);

  const planFromHere = useCallback(
    (ids: readonly string[]) => {
      const { route: current, found: ticked } = latest.current;
      // The last station reached: the shopper is standing at it.
      const start = current ? currentPoint(current, ticked).node_id : restoredNodeId;
      const remaining = ids.filter((id) => !ticked.has(id));

      if (remaining.length > 0) {
        plan({ category_ids: remaining, start_node_id: start ?? undefined });
      } else if (!current) {
        // A reloaded trip with everything found: the route is just the way out.
        plan({ category_ids: [ids.at(-1)!], start_node_id: start ?? undefined });
      }
    },
    [plan, restoredNodeId],
  );

  const categoryKey = categoryIds.join(",");
  useEffect(() => {
    if (categoryKey) {
      planFromHere(categoryKey.split(","));
      return;
    }
    inFlight.current?.abort();
    setRoute(null);
    setKnownStops(new Map());
    setFailed(false);
    setIsUpdating(false);
  }, [categoryKey, planFromHere]);

  const anchorSeq = anchor?.seq ?? 0;
  const anchorNode = anchor?.nodeId ?? null;
  useEffect(() => {
    const { route: current, found: ticked } = latest.current;
    if (!anchorNode || !current || !categoryKey) {
      return;
    }
    const remaining = categoryKey.split(",").filter((id) => !ticked.has(id));
    if (remaining.length > 0) {
      plan({ category_ids: remaining, start_node_id: anchorNode });
    }
    // Only a new sign re-plans: the list changing has its own effect above, and the
    // node and the plan are read when the sign arrives, not watched.
  }, [anchorSeq]);

  useEffect(() => () => inFlight.current?.abort(), []);

  const toggleFound = useCallback(
    (categoryId: string) => {
      const stop = knownStops.get(categoryId);
      if (!route || !stop) {
        return;
      }
      const result = applyToggle({
        route,
        found,
        categoryIds,
        categoryId,
        nodeId: stop.node_id,
        routeIsStale: failed || inFlight.current !== null,
      });
      setFound(result.found);
      if (result.replan) {
        plan(result.replan);
      }
    },
    [route, found, knownStops, categoryIds, failed, plan, setFound],
  );

  const retry = useCallback(() => {
    setFailed(false);
    planFromHere(categoryIds);
  }, [categoryIds, planFromHere]);

  const pending = useMemo(() => {
    const onList = new Set(categoryIds);
    return route
      ? pendingStops(route, found).filter((stop) => onList.has(stop.category_id))
      : [];
  }, [route, found, categoryIds]);

  return { route, pending, knownStops, isUpdating, failed, toggleFound, retry };
}

/**
 * What a shopper has left to do on a route, derived from the route and the set
 * of found categories. The shopper's position needs no state of its own: it is
 * always the start of the first leg still to walk.
 */

import type { Route, RouteLeg, RoutePoint, RouteRequest, RouteStop } from "../api/types";

export type FoundSet = ReadonlySet<string>;

function firstLegToWalk(route: Route, found: FoundSet): number {
  return route.stops.reduce(
    (next, stop) => (found.has(stop.category_id) ? Math.max(next, stop.leg_index + 1) : next),
    0,
  );
}

/** Always holds at least the leg to the checkout. */
export function remainingLegs(route: Route, found: FoundSet): RouteLeg[] {
  return route.legs.slice(firstLegToWalk(route, found));
}

/** The leg walked to the last found stop. Null until a stop on this route is found. */
export function lastWalkedLeg(route: Route, found: FoundSet): RouteLeg | null {
  return route.legs[firstLegToWalk(route, found) - 1] ?? null;
}

export function pendingStops(route: Route, found: FoundSet): RouteStop[] {
  return route.stops.filter((stop) => !found.has(stop.category_id));
}

export function currentPoint(route: Route, found: FoundSet): RoutePoint {
  return remainingLegs(route, found)[0]!.points[0]!;
}

export function remainingDistance(route: Route, found: FoundSet): number {
  return remainingLegs(route, found).reduce((total, leg) => total + leg.length_m, 0);
}

/**
 * Metres to the next stop, or to the checkout when nothing is left. Null while
 * an out-of-sequence tick waits for a new route: this one no longer leads there.
 */
export function distanceToNextStop(route: Route, found: FoundSet): number | null {
  const next = pendingStops(route, found)[0];
  const leg = remainingLegs(route, found)[0]!;
  if (!next || next.node_id === leg.to_node_id) {
    return leg.length_m;
  }
  return next.node_id === leg.points[0]!.node_id ? 0 : null;
}

/** True for every stop on the next leg, so two stops on one node can go in either order. */
export function isNextStop(route: Route, found: FoundSet, categoryId: string): boolean {
  const next = pendingStops(route, found)[0];
  const stop = route.stops.find((candidate) => candidate.category_id === categoryId);
  return next !== undefined && stop?.leg_index === next.leg_index;
}

/**
 * True when ticking this category finishes the list. Asks the list, not the
 * route: a route being re-planned can be missing an item just added.
 */
export function completesList(
  categoryIds: readonly string[],
  found: FoundSet,
  categoryId: string,
): boolean {
  return !found.has(categoryId) && categoryIds.every((id) => id === categoryId || found.has(id));
}

interface ToggleInput {
  route: Route;
  found: FoundSet;
  categoryIds: readonly string[];
  categoryId: string;
  /** The category's node. A later route omits found items, so it may not be on `route`. */
  nodeId: string;
  /** `route` is out of date: a re-plan is in flight or the last one failed. */
  routeIsStale: boolean;
}

interface ToggleResult {
  found: FoundSet;
  /** The route to request, or null when the current one still holds. */
  replan: RouteRequest | null;
}

export function applyToggle({
  route,
  found,
  categoryIds,
  categoryId,
  nodeId,
  routeIsStale,
}: ToggleInput): ToggleResult {
  const next = new Set(found);

  if (next.delete(categoryId)) {
    return {
      found: next,
      replan: {
        category_ids: categoryIds.filter((id) => !next.has(id)),
        start_node_id: currentPoint(route, found).node_id,
      },
    };
  }

  next.add(categoryId);
  if (!routeIsStale && isNextStop(route, found, categoryId)) {
    return { found: next, replan: null };
  }

  const remaining = categoryIds.filter((id) => !next.has(id));
  return {
    found: next,
    replan: {
      // The API needs a category. With none left, re-planning from the one just
      // found gives a zero-length stop followed by the walk to the checkout.
      category_ids: remaining.length > 0 ? remaining : [categoryId],
      start_node_id: nodeId,
    },
  };
}

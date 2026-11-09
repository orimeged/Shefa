import type { RefObject } from "react";
import { useEffect, useMemo } from "react";

import type { Route } from "../../api/types";
import { useLiveIndoorPositioning } from "../../hooks/useLiveIndoorPositioning";
import type { MapLayout, Point } from "../../lib/mapGeometry";
import type { WalkingMap } from "../../lib/positioning/gridWalking";
import type { WalkGraph } from "../../lib/positioning/walkGraph";
import type { FoundSet } from "../../lib/routeProgress";
import { remainingLegs } from "../../lib/routeProgress";
import { LiveLocationControl } from "./LiveLocationControl";
import { StoreMapView } from "./StoreMapView";

interface LiveStoreMapProps {
  layout: MapLayout;
  /** Where the dot may go and where it starts: the graph's aisles or a drawn plan's tiles. */
  walking: WalkingMap;
  /** The same walkways, for gliding the dot between readings. */
  graph: WalkGraph;
  route: Route;
  found: FoundSet;
  /** Keep the dot to the route still ahead; the drawn plan's open floor needs it most. */
  followsRoute: boolean;
  /** The last ticked shelf, the one spot known for sure. */
  fix: Point | null;
  /** Filled with the live position, for re-planning from where the shopper is. */
  livePosition: RefObject<Point | null>;
  /** Told each time the live position moves, and given null when it stops. */
  onLiveMove: (point: Point | null) => void;
}

export function LiveStoreMap({
  layout,
  walking,
  graph,
  route,
  found,
  followsRoute,
  fix,
  livePosition,
  onLiveMove,
}: LiveStoreMapProps) {
  const engineOptions = useMemo(
    () => ({ initialBearing: walking.initialBearing, tuning: walking.tuning }),
    [walking],
  );
  // Only what's still to walk: a leg already behind the shopper shouldn't pull the dot back.
  const routeAhead = useMemo(
    () =>
      followsRoute
        ? remainingLegs(route, found).map((leg) => leg.points.map((point) => point.node_id))
        : null,
    [followsRoute, route, found],
  );
  const { x, y, heading, fixes, status, start, stop, anchorTo } = useLiveIndoorPositioning({
    startNode: walking.start,
    edges: walking.edges,
    obstacles: walking.obstacles,
    engineOptions,
    route: routeAhead,
  });

  // A tick says exactly where the shopper stands, which clears any drift.
  useEffect(() => {
    if (fix) {
      anchorTo(fix);
    }
  }, [anchorTo, fix]);

  const isLive = status === "calibrating" || status === "tracking";

  useEffect(() => {
    livePosition.current = isLive ? { x, y } : null;
    onLiveMove(livePosition.current);
  }, [isLive, x, y, livePosition, onLiveMove]);

  return (
    <>
      <StoreMapView
        layout={layout}
        graph={graph}
        route={route}
        found={found}
        live={isLive ? { x, y, heading, fixes } : null}
      />
      <LiveLocationControl
        status={status}
        canStart={found.size === 0}
        onStart={() => void start()}
        onStop={stop}
      />
    </>
  );
}

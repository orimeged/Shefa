import type { RefObject } from "react";
import { useEffect, useMemo, useState } from "react";

import type { Route } from "../../api/types";
import { useLiveIndoorPositioning } from "../../hooks/useLiveIndoorPositioning";
import type { MapLayout, Point } from "../../lib/mapGeometry";
import type { WalkingMap } from "../../lib/positioning/gridWalking";
import type { WalkGraph } from "../../lib/positioning/walkGraph";
import { parseViewBox } from "../../lib/mapCamera";
import type { FoundSet } from "../../lib/routeProgress";
import { remainingLegs } from "../../lib/routeProgress";
import { NavigationHud, NavigationStart } from "./NavigationControls";
import { StoreMapView } from "./StoreMapView";

/** Navigation mode: the map fills the screen between the next stop's card and the Found it bar. */
const FOCUSED_MAP = "block h-[calc(100dvh-13rem)] min-h-[50dvh] w-full";

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
  /** Told when navigation mode starts and ends, so the screen around the map can step aside. */
  onNavigatingChange?: (isNavigating: boolean) => void;
  /** Brings the search bar back while navigating, to add an item. */
  onSearch?: () => void;
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
  onNavigatingChange,
  onSearch,
}: LiveStoreMapProps) {
  const [dismissed, setDismissed] = useState(false);
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

  useEffect(() => {
    onNavigatingChange?.(isLive);
  }, [isLive, onNavigatingChange]);

  // Tracking starts from the entrance, so it can only begin before the first tick.
  const offersStart = !isLive && found.size === 0 && !dismissed;
  const wayIn = useMemo(
    () => ({ at: walking.start, bearing: walking.initialBearing ?? graph.bearingOutOf(walking.start) }),
    [walking, graph],
  );
  // The start sheet covers half the map: the half without the entrance and its arrow.
  const sheetPlacement = useMemo(() => {
    const view = parseViewBox(layout.viewBox);
    const door = layout.toSvg(walking.start);
    return door.y - view.y > view.height / 2 ? "top" : "bottom";
  }, [layout, walking]);

  return (
    <>
      <StoreMapView
        layout={layout}
        graph={graph}
        route={route}
        found={found}
        live={isLive ? { x, y, heading, fixes } : null}
        follow={isLive}
        wayIn={offersStart ? wayIn : null}
        className={isLive ? FOCUSED_MAP : undefined}
      />
      {offersStart && (
        <NavigationStart
          status={status}
          placement={sheetPlacement}
          onStart={() => void start()}
          onDismiss={() => setDismissed(true)}
        />
      )}
      {isLive && <NavigationHud status={status} onStop={stop} onSearch={onSearch} />}
    </>
  );
}

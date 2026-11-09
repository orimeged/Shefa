import type { RefObject } from "react";
import { useEffect, useMemo } from "react";

import type { Route, StoreMap } from "../../api/types";
import { useLiveIndoorPositioning } from "../../hooks/useLiveIndoorPositioning";
import type { Point } from "../../lib/mapGeometry";
import { buildMapLayout } from "../../lib/mapGeometry";
import { storeObstacles } from "../../lib/positioning/obstacles";
import { toWalkableEdges, WalkGraph } from "../../lib/positioning/walkGraph";
import type { FoundSet } from "../../lib/routeProgress";
import { LiveLocationControl } from "./LiveLocationControl";
import { StoreMapView } from "./StoreMapView";

interface LiveStoreMapProps {
  map: StoreMap;
  route: Route;
  found: FoundSet;
  /** The last ticked shelf, the one spot known for sure. */
  fix: Point | null;
  /** Filled with the live position, for re-planning from where the shopper is. */
  livePosition: RefObject<Point | null>;
  /** Told each time the live position moves, and given null when it stops. */
  onLiveMove: (point: Point | null) => void;
}

export function LiveStoreMap({
  map,
  route,
  found,
  fix,
  livePosition,
  onLiveMove,
}: LiveStoreMapProps) {
  const edges = useMemo(() => toWalkableEdges(map), [map]);
  const layout = useMemo(() => buildMapLayout(map), [map]);
  const graph = useMemo(() => new WalkGraph(edges), [edges]);
  const obstacles = useMemo(() => storeObstacles(map), [map]);
  const startNode = useMemo(() => map.nodes.find((node) => node.type === "entrance")!, [map]);
  const { x, y, heading, status, start, stop, anchorTo } = useLiveIndoorPositioning({
    startNode,
    edges,
    obstacles,
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
        live={isLive ? { x, y, heading } : null}
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

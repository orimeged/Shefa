import { useLayoutEffect, useMemo, useRef } from "react";

import type { Route, StoreMap } from "../../api/types";
import { useFollowedDot } from "../../hooks/useFollowedDot";
import { useLanguage } from "../../i18n/LanguageProvider";
import {
  buildMapLayout,
  polylinePoints,
  stopPins,
  translateTo,
  walkKeyframes,
} from "../../lib/mapGeometry";
import type { FoundSet } from "../../lib/routeProgress";
import {
  currentPoint,
  lastWalkedLeg,
  pendingStops,
  remainingLegs,
} from "../../lib/routeProgress";
import type { LivePosition } from "../../lib/positioning/engine";
import { toWalkableEdges, WalkGraph } from "../../lib/positioning/walkGraph";
import { MapEndpoint, MapFloor } from "../MapFloor";
import type { ZonePin } from "../ZonePins";
import { ZonePins } from "../ZonePins";

const WALK_TIMING = { duration: 700, easing: "ease-in-out" };

interface StoreMapViewProps {
  map: StoreMap;
  route: Route;
  found: FoundSet;
  /** Where the sensors place the shopper. Without it, the dot follows the ticks. */
  live?: LivePosition | null;
  /** Shelf codes to pin on the map, by stop, in place of the numbered pins. */
  zoneBadges?: ReadonlyMap<string, { code: string; tone: number }>;
  className?: string;
}

export function StoreMapView({
  map,
  route,
  found,
  live = null,
  zoneBadges,
  // A short phone keeps room for the list under the sticky map and the answer bar.
  className = "block h-auto max-h-[46dvh] w-full [@media(max-height:700px)]:max-h-[34dvh]",
}: StoreMapViewProps) {
  const { t } = useLanguage();
  const layout = useMemo(() => buildMapLayout(map), [map]);
  const graph = useMemo(() => new WalkGraph(toWalkableEdges(map)), [map]);

  const path = polylinePoints(remainingLegs(route, found), layout);
  const pins = useMemo(() => stopPins(pendingStops(route, found), layout), [route, found, layout]);
  const zonePins = useMemo<ZonePin[] | null>(
    () =>
      zoneBadges
        ? pins.flatMap((pin) => {
            const badge = zoneBadges.get(pin.key);
            return badge ? [{ key: pin.key, x: pin.x, y: pin.y, ...badge }] : [];
          })
        : null,
    [pins, zoneBadges],
  );
  const here = currentPoint(route, found);
  const position = layout.toSvg(live ?? here);
  const walked = lastWalkedLeg(route, found);
  const isLive = live !== null;

  const marker = useRef<SVGGElement>(null);
  const cone = useRef<SVGPathElement>(null);
  const walkedLine = useRef<SVGPolylineElement>(null);
  const cameFrom = useRef(here);

  useFollowedDot(live, graph, layout, marker, cone);

  useLayoutEffect(() => {
    const from = cameFrom.current;
    cameFrom.current = here;
    // Only a step along the route. A reloaded trip has no step to replay, and a
    // tick further on is a jump that waits for its new route.
    if (
      from === here ||
      walked?.points[0]!.node_id !== from.node_id ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    // The same timing keeps the end of the line under the dot, rubbing it out.
    walkedLine.current?.animate(
      [
        { strokeDashoffset: 0, opacity: 1 },
        { strokeDashoffset: -1, opacity: 1 },
      ],
      WALK_TIMING,
    );
    // The sensors already move a live dot.
    if (!isLive) {
      marker.current?.animate(walkKeyframes(walked.points.map(layout.toSvg)), WALK_TIMING);
    }
  }, [here, walked, isLive, layout]);

  return (
    <svg
      viewBox={layout.viewBox}
      role="img"
      aria-label={t.mapLabel}
      className={className}
    >
      <MapFloor layout={layout} shelfClassName="fill-shelf-strong" />

      <g className="pointer-events-none">
        <polyline
          points={path}
          fill="none"
          className="stroke-surface"
          strokeWidth={1}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          key={polylinePoints(route.legs, layout)}
          points={path}
          pathLength={1}
          fill="none"
          className="route-draw stroke-brand"
          strokeWidth={0.62}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={path}
          fill="none"
          className="route-flow stroke-white"
          strokeWidth={0.16}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          ref={walkedLine}
          points={walked ? polylinePoints([walked], layout) : ""}
          pathLength={1}
          fill="none"
          className="route-walked stroke-brand"
          strokeWidth={0.62}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {pins.length === 0 && (
        <circle
          cx={layout.checkout.x}
          cy={layout.checkout.y}
          r={1.5}
          className="pulse-ring fill-next"
        />
      )}
      <MapEndpoint point={layout.entrance} label={t.entrance} />
      <MapEndpoint point={layout.checkout} label={t.checkout} />

      {zonePins && <ZonePins pins={zonePins} />}
      {!zonePins && pins.map((pin) => (
        <g key={pin.key}>
          {pin.isNext && <circle cx={pin.x} cy={pin.y} r={1.5} className="pulse-ring fill-next" />}
          <circle
            cx={pin.x}
            cy={pin.y}
            r={1.15}
            className={pin.isNext ? "fill-next stroke-ink" : "fill-surface stroke-brand"}
            strokeWidth={0.2}
          />
          <text
            x={pin.x}
            y={pin.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={1.2}
            fontWeight={700}
            className={pin.isNext ? "fill-ink" : "fill-brand-strong"}
          >
            {pin.order}
          </text>
        </g>
      ))}

      {/* A live dot is placed and turned every frame by useFollowedDot, not here. */}
      <g
        ref={marker}
        className={isLive ? "map-marker is-live" : "map-marker"}
        style={isLive ? undefined : { transform: translateTo(position) }}
      >
        {isLive && (
          <path
            ref={cone}
            d="M0 0 L-1.6 -3.3 A3.7 3.7 0 0 1 1.6 -3.3 Z"
            className="fill-you/35"
          />
        )}
        <circle r={1.3} className="pulse-ring fill-you" />
        <circle r={0.8} className="fill-you stroke-white" strokeWidth={0.28} />
      </g>
    </svg>
  );
}

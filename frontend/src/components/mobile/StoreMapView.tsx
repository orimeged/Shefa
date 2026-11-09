import { useId, useLayoutEffect, useMemo, useRef } from "react";

import type { Route } from "../../api/types";
import { useFollowedDot } from "../../hooks/useFollowedDot";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { MapLayout, Point } from "../../lib/mapGeometry";
import {
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
import type { WalkGraph } from "../../lib/positioning/walkGraph";
import { MapEndpoint, MapFloor } from "../MapFloor";
import type { ZonePin } from "../ZonePins";
import { ZonePins } from "../ZonePins";

const WALK_TIMING = { duration: 700, easing: "ease-in-out" };
/** --color-you: a gradient stop takes a colour, not a class. */
const YOU = "#2563eb";
/** A beam the way the phone faces, fading out ahead of the dot. */
const CONE_PATH = "M0 0 L-2.7 -5.8 A6.4 6.4 0 0 1 2.7 -5.8 Z";
/** How far ahead of the entrance the way-in arrow stands, so the dot doesn't cover it. */
const WAY_IN_AHEAD = 3.4;

interface StoreMapViewProps {
  /** The graph's aisles or a drawn floor plan; the route's points are in metres on either. */
  layout: MapLayout;
  /** The walkways a live dot glides along. */
  graph?: WalkGraph | null;
  route: Route;
  found: FoundSet;
  /** Where the sensors place the shopper. Without it, the dot follows the ticks. */
  live?: LivePosition | null;
  /** Navigation mode: the map follows the live dot, closer in, its heading pointing up. */
  follow?: boolean;
  /** Before live location starts: where to stand and which way to face, in metres and degrees. */
  wayIn?: { at: Point; bearing: number } | null;
  /** Shelf codes to pin on the map, by stop, in place of the numbered pins. */
  zoneBadges?: ReadonlyMap<string, { code: string; tone: number }>;
  className?: string;
}

export function StoreMapView({
  layout,
  graph = null,
  route,
  found,
  live = null,
  follow = false,
  wayIn = null,
  zoneBadges,
  // A short phone keeps room for the list under the sticky map and the answer bar.
  className = "block h-auto max-h-[46dvh] w-full [@media(max-height:700px)]:max-h-[34dvh]",
}: StoreMapViewProps) {
  const { t } = useLanguage();
  const ids = useId().replace(/:/g, "");
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

  const world = useRef<SVGGElement>(null);
  const marker = useRef<SVGGElement>(null);
  const cone = useRef<SVGPathElement>(null);
  const walkedLine = useRef<SVGPolylineElement>(null);
  const cameFrom = useRef(here);

  useFollowedDot(live, graph, layout, marker, cone, { world, follow });

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

  const arrow = wayIn ? layout.toSvg(wayIn.at) : null;

  return (
    <svg
      viewBox={layout.viewBox}
      role="img"
      aria-label={t.mapLabel}
      data-map={layout.kind ?? "graph"}
      data-following={follow && isLive ? "" : undefined}
      className={className}
    >
      <defs>
        <linearGradient id={`${ids}-beam`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="-6.4">
          <stop offset="0%" stopColor={YOU} stopOpacity={0.6} />
          <stop offset="100%" stopColor={YOU} stopOpacity={0} />
        </linearGradient>
        <filter id={`${ids}-lift`} x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="0.15" stdDeviation="0.25" floodColor="#0f172a" floodOpacity="0.35" />
        </filter>
      </defs>

      {/* Everything the camera moves in navigation mode; useFollowedDot sets its transform. */}
      <g ref={world}>
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
              data-upright="up"
              data-x={pin.x}
              data-y={pin.y}
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

        {/* Which way to face when starting live location: into the store from the entrance. */}
        {arrow && wayIn && (
          <g
            data-way-in=""
            className="way-in pointer-events-none"
            transform={`translate(${arrow.x} ${arrow.y}) rotate(${wayIn.bearing}) translate(0 ${-WAY_IN_AHEAD})`}
          >
            <path
              d="M0 -2.2 L1.7 -0.2 L0.65 -0.2 L0.65 1.6 L-0.65 1.6 L-0.65 -0.2 L-1.7 -0.2 Z"
              className="fill-you stroke-white"
              strokeWidth={0.28}
              strokeLinejoin="round"
            />
          </g>
        )}

        {/* A live dot is placed, sized and turned every frame by useFollowedDot, not here. */}
        <g
          ref={marker}
          className={isLive ? "map-marker is-live" : "map-marker"}
          style={isLive ? undefined : { transform: translateTo(position) }}
        >
          {isLive && <path ref={cone} d={CONE_PATH} fill={`url(#${ids}-beam)`} />}
          <circle r={1.9} className="pulse-ring fill-you" />
          <circle
            r={1.05}
            className="fill-you stroke-white"
            strokeWidth={0.34}
            filter={`url(#${ids}-lift)`}
          />
        </g>
      </g>
    </svg>
  );
}

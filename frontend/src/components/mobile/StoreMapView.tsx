import { DoorOpen, ShoppingCart } from "lucide-react";
import type { CSSProperties } from "react";
import { useMemo, useRef } from "react";

import type { Route, RouteStop } from "../../api/types";
import { useMapCamera } from "../../hooks/useMapCamera";
import { usePlacements } from "../../hooks/usePlace";
import { useLanguage } from "../../i18n/LanguageProvider";
import { departmentCategories, departmentColours, PLAIN_SHELF } from "../../lib/departments";
import type { Insets, ViewBox } from "../../lib/mapCamera";
import { boundsOf, NO_INSETS, parseViewBox, toScreen, unitsPerPixel } from "../../lib/mapCamera";
import type { MapLayout, Point, Rect } from "../../lib/mapGeometry";
import { polylinePoints, stopPins } from "../../lib/mapGeometry";
import type { ScreenBox } from "../../lib/mapLabels";
import { BADGE_HEIGHT_PX, badgeWidth, COMPACT_BADGE_PX, placeBadges } from "../../lib/mapLabels";
import type { FoundSet, Trail } from "../../lib/routeProgress";
import { advanceTrail, currentPoint, NO_TRAIL, pendingStops, remainingLegs, trailLegs } from "../../lib/routeProgress";
import { hasCategoryIcon } from "../CategoryIcon";
import { BLOCK_LIFT, MapFloor } from "../MapFloor";
import {
  CheckoutPin,
  DepartmentBadge,
  DoneStationPin,
  EndpointBadge,
  HereMarker,
  NextStationPin,
  StationPin,
} from "../map/MapMarkers";
import type { ZonePin } from "../ZonePins";
import { ZonePins } from "../ZonePins";

/** Room round the walk to the next station when framing it, in map units. */
const FRAME_MARGIN = 1.6;
/** Framing one leg, never closer than this many units across: the aisle and both its sides. */
const ROUTE_MIN_SPAN = 11;
/** The next station's pin stands this many pixels above its point; the frame leaves it room. */
const PIN_HEADROOM_PX = 48;
const LONGEST_BADGE_NAME = 16;
/** Places tried for one badge: along the visible parts of its biggest shelves. */
const BADGE_CANDIDATES = 21;
/** A badge with no room on its shelf may sit this far out from the shelf's edge, in pixels to its middle. */
const BESIDE_PX = 13;
/** The entrance and till badges sit this far below their point, clear of what stands on it. */
const ENDPOINT_DROP_PX = 26;

/** A stroke this many pixels wide on screen at any zoom: `--u` is map units per pixel. */
const px = (pixels: number) => ({ strokeWidth: `calc(var(--u, 0.08) * ${pixels}px)` });

interface StoreMapViewProps {
  /** The graph's aisles or a drawn floor plan; the route's points are in metres on either. */
  layout: MapLayout;
  route: Route;
  found: FoundSet;
  /** Stations already reached, wherever later routes go; drawn ticked off. */
  reached?: readonly RouteStop[];
  /** Categories given up as not on the shelf: their stations show it. */
  missing?: ReadonlySet<string>;
  /**
   * "route" frames the walk to the next station and lights it; "overview" shows
   * the whole store.
   */
  focus?: "route" | "overview";
  /** "next" draws the walk to the next station boldest; "all", for the kiosk, the whole route alike. */
  emphasis?: "next" | "all";
  /** Screen pixels covered by the header and the station sheet: the camera frames what's left. */
  insets?: Insets;
  /** The next station's number in the trip, counting the ones done. */
  firstNumber?: number;
  /** Shelf codes to pin on the map, by stop, in place of the numbered pins. */
  zoneBadges?: ReadonlyMap<string, { code: string; tone: number }>;
  /** Markers and badges larger than on a phone, for a big screen. */
  markerScale?: number;
  className?: string;
}

/**
 * The store and the trip through it. The walk already done fades to grey, the
 * walk to the next station glows, and the rest waits faintly; the camera frames
 * the glowing part and flies on at each station.
 */
export function StoreMapView({
  layout,
  route,
  found,
  reached = [],
  missing,
  focus = "route",
  emphasis = "next",
  insets = NO_INSETS,
  firstNumber = 1,
  zoneBadges,
  markerScale = 1,
  className = "block h-full w-full",
}: StoreMapViewProps) {
  const { t } = useLanguage();
  const isRtl = t.direction === "rtl";
  // Which drawn department each category is in, for the departments' badges and icons.
  const placements = usePlacements();
  const svg = useRef<SVGSVGElement>(null);

  // The grey trail outlives a re-plan, which starts the new route where the shopper stands.
  const trailRef = useRef<Trail>(NO_TRAIL);
  const trail = useMemo(() => {
    trailRef.current = advanceTrail(trailRef.current, route, found);
    return trailRef.current;
  }, [route, found]);

  const ahead = remainingLegs(route, found);
  const pending = useMemo(() => pendingStops(route, found), [route, found]);
  const pins = useMemo(() => stopPins(pending, layout), [pending, layout]);
  const next = emphasis === "next" ? pending[0] : undefined;
  const current = emphasis === "next" ? ahead.slice(0, 1) : ahead;
  const later = emphasis === "next" ? ahead.slice(1) : [];
  const here = layout.toSvg(currentPoint(route, found));
  const isFraming = focus === "route" && emphasis === "next";

  const overview = useMemo(() => parseViewBox(layout.viewBox), [layout]);
  const target = useMemo<ViewBox>(() => {
    if (!isFraming || current.length === 0) {
      return overview;
    }
    const points = current[0]!.points.map(layout.toSvg);
    if (next) {
      points.push(layout.toSvg(next));
    }
    return boundsOf(points, FRAME_MARGIN);
  }, [isFraming, current, next, layout, overview]);
  const cameraInsets = isFraming ? { ...insets, top: insets.top + PIN_HEADROOM_PX } : insets;
  const { screen, resting } = useMapCamera(svg, target, {
    insets: cameraInsets,
    minSpan: isFraming ? ROUTE_MIN_SPAN : 0.01,
  });

  const departmentOf = useMemo(
    () => (placements ? departmentCategories(placements, hasCategoryIcon) : new Map<string, string>()),
    [placements],
  );
  const colours = useMemo(() => departmentColours(layout.shelfNames?.map((name) => name.key) ?? []), [layout]);
  const nextDepartment = next && placements ? (placements[next.category_id] ?? null) : null;
  const comingDepartments = useMemo(
    () => new Set(pending.slice(1).flatMap((stop) => placements?.[stop.category_id] ?? [])),
    [pending, placements],
  );

  const badges = useMemo(
    () =>
      (layout.shelfNames ?? []).map((name) => ({
        key: name.key,
        text: name.key.length > LONGEST_BADGE_NAME ? `${name.key.slice(0, LONGEST_BADGE_NAME - 1)}…` : name.key,
        // Its shelves' raised tops, biggest first: a badge sits on whichever part is in view.
        tops: layout.shelves
          .filter((shelf) => shelf.label === name.key)
          .map((shelf) => ({ ...shelf, y: shelf.y - BLOCK_LIFT.shelf }))
          .sort((a, b) => b.width * b.height - a.width * a.height),
        // Where its name was, for before the camera has a view.
        at: { x: name.x, y: name.y - BLOCK_LIFT.shelf },
      })),
    [layout],
  );

  // Where badges go once the camera lands: on the visible part of their shelves,
  // clear of each other and of the pins. None while it flies.
  const { top: insetTop, right: insetRight, bottom: insetBottom, left: insetLeft } = cameraInsets;
  const placedBadges = useMemo(() => {
    if (!resting || !screen) {
      return new Map<string, Point & { compact: boolean }>();
    }
    const perPixel = unitsPerPixel(resting, screen);
    const box = (point: Point, width: number, height: number, lift = 0): ScreenBox => {
      const at = toScreen(point, resting, screen);
      return { x: at.x, y: at.y - lift * markerScale, width: width * markerScale, height: height * markerScale };
    };
    const drop = (point: Point) => ({ x: point.x, y: point.y + ENDPOINT_DROP_PX * markerScale * perPixel });
    const obstacles = [
      ...pins.map((pin) => (pin.key === next?.category_id ? box(pin, 34, 46, 24) : box(pin, 26, 26))),
      ...reached.map((stop) => box(layout.toSvg(stop), 22, 22)),
      ...(emphasis === "next" ? [box(here, 24, 24)] : []),
      ...(emphasis === "next" && !next && current[0] ? [box(layout.toSvg(current[0].points.at(-1)!), 34, 46, 24)] : []),
      box(drop(layout.entrance), badgeWidth(t.entrance), BADGE_HEIGHT_PX),
      box(drop(layout.checkout), badgeWidth(t.checkout), BADGE_HEIGHT_PX),
    ];
    // The part of the map the header and the sheet leave clear, in map units.
    const clear: Rect = {
      x: resting.x + insetLeft * perPixel,
      y: resting.y + insetTop * perPixel,
      width: (screen.width - insetLeft - insetRight) * perPixel,
      height: (screen.height - insetTop - insetBottom) * perPixel,
    };
    const placed = placeBadges(
      badges.map((badge) => ({
        key: badge.key,
        priority: badge.key === nextDepartment ? 3 : comingDepartments.has(badge.key) ? 2 : 1,
        width: badgeWidth(badge.text) * markerScale,
        height: BADGE_HEIGHT_PX * markerScale,
        compactSize: COMPACT_BADGE_PX * markerScale,
        candidates: badge.tops
          .flatMap((top) => {
            const part = overlap(top, clear);
            return part ? alongPart(part) : [];
          })
          .slice(0, BADGE_CANDIDATES)
          // Failing all those, right beside its biggest shelf in view.
          .concat(
            badge.tops.flatMap((top) => {
              const part = overlap(top, clear);
              return part ? besidePart(part, BESIDE_PX * markerScale * perPixel) : [];
            }).slice(0, 4),
          )
          .map((point) => toScreen(point, resting, screen)),
      })),
      obstacles,
      screen,
    );
    // Back to map units, where the badges are drawn.
    return new Map(
      [...placed].map(([key, point]) => [
        key,
        { x: resting.x + point.x * perPixel, y: resting.y + point.y * perPixel, compact: point.compact },
      ]),
    );
  }, [
    resting,
    screen,
    badges,
    pins,
    reached,
    here,
    next,
    current,
    emphasis,
    nextDepartment,
    comingDepartments,
    layout,
    markerScale,
    t,
    insetTop,
    insetRight,
    insetBottom,
    insetLeft,
  ]);

  // The entrance and till badges, hidden where the camera would cut them off.
  const endpointsShown = useMemo(() => {
    if (!resting || !screen) {
      return { entrance: true, checkout: true };
    }
    const whole = (point: Point, text: string) => {
      const at = toScreen(point, resting, screen);
      const half = (badgeWidth(text) * markerScale) / 2;
      const top = at.y + (ENDPOINT_DROP_PX - BADGE_HEIGHT_PX / 2) * markerScale;
      // Whole, and clear of the header and the sheet floating over the map.
      return (
        at.x - half >= insetLeft &&
        at.x + half <= screen.width - insetRight &&
        top >= insetTop &&
        top + BADGE_HEIGHT_PX * markerScale <= screen.height - insetBottom
      );
    };
    return { entrance: whole(layout.entrance, t.entrance), checkout: whole(layout.checkout, t.checkout) };
  }, [resting, screen, layout, markerScale, t, insetTop, insetRight, insetBottom, insetLeft]);

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

  const walkedPoints = polylinePoints(trailLegs(trail), layout);
  const currentPoints = polylinePoints(current, layout);
  const laterPoints = polylinePoints(later, layout);

  return (
    <svg
      ref={svg}
      viewBox={layout.viewBox}
      role="img"
      aria-label={t.mapLabel}
      data-map={layout.kind ?? "graph"}
      data-focus={isFraming ? "route" : "overview"}
      className={className}
      style={{ "--marker-scale": markerScale } as CSSProperties}
    >
      <MapFloor layout={layout} highlight={nextDepartment} showShelfNames={false} />

      <g className="pointer-events-none" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {walkedPoints && (
          <polyline data-route="done" points={walkedPoints} stroke="#b7b0a3" strokeOpacity={0.9} style={px(5)} />
        )}
        {laterPoints && (
          <polyline data-route="ahead" points={laterPoints} className="stroke-brand" strokeOpacity={0.3} style={px(4)} />
        )}
        {currentPoints && (
          // Keyed by the walk itself, so each new leg draws itself in.
          <g data-route="current" key={currentPoints}>
            <polyline points={currentPoints} className="stroke-brand" strokeOpacity={0.16} style={px(18)} />
            <polyline points={currentPoints} stroke="#ffffff" style={px(11)} />
            <polyline points={currentPoints} pathLength={1} className="route-draw stroke-brand" style={px(7)} />
            <polyline points={currentPoints} className="route-flow stroke-white" strokeOpacity={0.85} style={px(2)} />
          </g>
        )}
      </g>

      {badges.map((badge) => (
        <DepartmentBadge
          key={badge.key}
          at={placedBadges.get(badge.key) ?? badge.at}
          name={badge.text}
          categoryId={departmentOf.get(badge.key)}
          accent={(colours.get(badge.key) ?? PLAIN_SHELF).accent}
          isRtl={isRtl}
          shown={placedBadges.has(badge.key)}
          compact={placedBadges.get(badge.key)?.compact}
          isNext={badge.key === nextDepartment}
        />
      ))}

      <EndpointBadge
        at={layout.entrance}
        dropPx={ENDPOINT_DROP_PX}
        text={t.entrance}
        icon={DoorOpen}
        isRtl={isRtl}
        shown={endpointsShown.entrance}
      />
      <EndpointBadge
        at={layout.checkout}
        dropPx={ENDPOINT_DROP_PX}
        text={t.checkout}
        icon={ShoppingCart}
        isRtl={isRtl}
        shown={endpointsShown.checkout}
      />

      {reached.map((stop) => (
        <DoneStationPin key={stop.category_id} at={layout.toSvg(stop)} missing={missing?.has(stop.category_id)} />
      ))}

      {zonePins ? (
        <ZonePins pins={zonePins} />
      ) : (
        pins.map((pin, index) =>
          pin.key === next?.category_id ? null : (
            <StationPin key={pin.key} at={pin} number={firstNumber + index} />
          ),
        )
      )}

      {emphasis === "next" && <HereMarker at={here} />}

      {next && (
        // Keyed by station, so each new one drops in.
        <NextStationPin key={next.category_id} at={pins[0]!} categoryId={next.category_id} />
      )}
      {emphasis === "next" && !next && current[0] && (
        <CheckoutPin at={layout.toSvg(current[0].points.at(-1)!)} icon={ShoppingCart} />
      )}
    </svg>
  );
}

/** Where two boxes overlap, or null. */
function overlap(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** Along a stretch of shelf, the middle first and then outwards: room to step past a neighbour's badge. */
const ALONG = [0.5, 0.25, 0.75, 0.125, 0.875, 0.375, 0.625];

/** Where on a stretch of shelf a badge could sit, best first, down its length. */
function alongPart(part: Rect): Point[] {
  const middle = { x: part.x + part.width / 2, y: part.y + part.height / 2 };
  if (part.height > part.width) {
    return ALONG.map((share) => ({ x: middle.x, y: part.y + part.height * share }));
  }
  if (part.width > part.height) {
    return ALONG.map((share) => ({ x: part.x + part.width * share, y: middle.y }));
  }
  return [middle];
}

/** Just outside a stretch of shelf, `gap` out from its long sides, middle first. */
function besidePart(part: Rect, gap: number): Point[] {
  const middle = { x: part.x + part.width / 2, y: part.y + part.height / 2 };
  return part.height > part.width
    ? [
        { x: part.x + part.width + gap, y: middle.y },
        { x: part.x - gap, y: middle.y },
      ]
    : [
        { x: middle.x, y: part.y + part.height + gap },
        { x: middle.x, y: part.y - gap },
      ];
}

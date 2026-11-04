/**
 * Maps store coordinates to SVG. One SVG unit is one metre, and y is flipped so
 * the store front sits at the bottom of the screen, the way a shopper walks in.
 * The backend only sends nodes, so shelves are derived from the aisle positions.
 */

import type { RouteLeg, RouteStop, Section, Side, StoreMap } from "../api/types";

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export interface Line {
  key: string;
  from: Point;
  to: Point;
}

export interface AisleLabel extends Point {
  aisleNo: number;
}

export interface StopPin extends Point {
  key: string;
  order: number;
  isNext: boolean;
}

/** One shelf face. `elementId` is its DOM id, which the database knows it by. */
export interface ZoneShape extends Rect {
  elementId: string;
}

export interface MapLayout {
  viewBox: string;
  floor: Rect;
  shelves: Rect[];
  zones: ZoneShape[];
  walkways: Line[];
  sectionDots: Point[];
  aisleLabels: AisleLabel[];
  entrance: Point;
  checkout: Point;
  toSvg: (point: Point) => Point;
  shelfSideOffset: (side: Side) => number;
}

// Just enough for the floor's outline: every metre of margin is map not drawn.
const PADDING_M = 0.3;
const LABEL_STRIP_M = 2.6;
const SHELF_DEPTH_RATIO = 0.46;
const SHELF_OVERHANG_M = 2.5;
const PIN_OFFSET_RATIO = 0.27;
const AISLE_LABEL_INSET_M = 1.6;
const ZONE_GAP_M = 0.12;

const LABEL_PADDING_M = 0.25;
const LETTER_WIDTH_EM = 0.52;
const LARGEST_LABEL_M = 0.8;
const SMALLEST_LABEL_M = 0.46;

export interface ZoneLabel {
  text: string;
  fontSize: number;
}

/** Fits a name along a zone: full size when it can, smaller, and shortened only past that. */
export function fitZoneLabel(name: string, zoneLength: number): ZoneLabel {
  const room = zoneLength - 2 * LABEL_PADDING_M;
  const fit = room / (name.length * LETTER_WIDTH_EM);
  if (fit >= SMALLEST_LABEL_M) {
    return { text: name, fontSize: Math.min(fit, LARGEST_LABEL_M) };
  }
  const letters = Math.floor(room / (SMALLEST_LABEL_M * LETTER_WIDTH_EM));
  return { text: `${name.slice(0, letters - 1)}…`, fontSize: SMALLEST_LABEL_M };
}

/** Matches zone_element_id in the backend, which stores it as `svg_element_id`. */
export function zoneElementId(sectionId: string): string {
  return `zone-${sectionId}`;
}

/**
 * Splits each aisle-facing half of a shelf into one zone per section, with the
 * borders halfway between sections so the zones fill the shelf end to end.
 */
function zoneShapes(
  map: StoreMap,
  svgY: (nodeId: string) => number,
  shelfCentre: (section: Section) => number,
  shelfWidth: number,
  shelfTop: number,
  shelfBottom: number,
): ZoneShape[] {
  const faces = new Map<string, Section[]>();
  for (const section of map.sections) {
    const face = `${section.aisle_no}:${section.side}`;
    faces.set(face, [...(faces.get(face) ?? []), section]);
  }

  return [...faces.values()].flatMap((sections) => {
    const ordered = [...sections].sort((a, b) => svgY(a.node_id) - svgY(b.node_id));
    const ys = ordered.map((section) => svgY(section.node_id));
    return ordered.map((section, index) => {
      const top = index === 0 ? shelfTop : (ys[index - 1]! + ys[index]!) / 2;
      const bottom = index === ys.length - 1 ? shelfBottom : (ys[index]! + ys[index + 1]!) / 2;
      const centre = shelfCentre(section);
      return {
        elementId: zoneElementId(section.id),
        x: section.side === "left" ? centre : centre - shelfWidth / 2,
        y: top + ZONE_GAP_M / 2,
        width: shelfWidth / 2,
        height: bottom - top - ZONE_GAP_M,
      };
    });
  });
}

export function buildMapLayout(map: StoreMap): MapLayout {
  const toSvg = ({ x, y }: Point): Point => ({ x, y: map.height_m - y });
  const nodes = new Map(map.nodes.map((node) => [node.id, node]));

  const aisleX = new Map(map.sections.map((s) => [s.aisle_no, nodes.get(s.node_id)!.x]));
  const aisles = [...aisleX.entries()].sort(([a], [b]) => a - b);
  const xs = aisles.map(([, x]) => x);
  const spacing = (xs[1] ?? 0) - (xs[0] ?? 0) || 5;

  const sectionNodes = map.nodes.filter((node) => node.type === "section");
  const sectionYs = sectionNodes.map((node) => node.y);
  const shelfTop = toSvg({ x: 0, y: Math.max(...sectionYs) + SHELF_OVERHANG_M }).y;
  const shelfBottom = toSvg({ x: 0, y: Math.min(...sectionYs) - SHELF_OVERHANG_M }).y;

  const shelfCentres = [...xs.map((x) => x - spacing / 2), xs.at(-1)! + spacing / 2];
  const shelfWidth = spacing * SHELF_DEPTH_RATIO;

  const entrance = map.nodes.find((node) => node.type === "entrance")!;
  const checkout = map.nodes.find((node) => node.type === "checkout")!;

  return {
    viewBox: `${-PADDING_M} ${-PADDING_M} ${map.width_m + 2 * PADDING_M} ${
      map.height_m + PADDING_M + LABEL_STRIP_M
    }`,
    floor: { x: 0, y: 0, width: map.width_m, height: map.height_m },
    shelves: shelfCentres.map((centre) => ({
      x: centre - shelfWidth / 2,
      y: shelfTop,
      width: shelfWidth,
      height: shelfBottom - shelfTop,
    })),
    zones: zoneShapes(
      map,
      (nodeId) => toSvg(nodes.get(nodeId)!).y,
      // Left of the aisle is the shelf before it, right is the shelf after it.
      (section) =>
        aisleX.get(section.aisle_no)! + ((section.side === "left" ? -1 : 1) * spacing) / 2,
      shelfWidth,
      shelfTop,
      shelfBottom,
    ),
    walkways: map.edges.map((edge) => ({
      key: `${edge.from_node}-${edge.to_node}`,
      from: toSvg(nodes.get(edge.from_node)!),
      to: toSvg(nodes.get(edge.to_node)!),
    })),
    sectionDots: sectionNodes.map(toSvg),
    aisleLabels: aisles.map(([aisleNo, x]) => ({ aisleNo, x, y: AISLE_LABEL_INSET_M })),
    entrance: toSvg(entrance),
    checkout: toSvg(checkout),
    toSvg,
    shelfSideOffset: (side) => (side === "left" ? -1 : 1) * spacing * PIN_OFFSET_RATIO,
  };
}

/** SVG `points` for a walk along `legs`, without repeating the node where two legs meet. */
export function polylinePoints(legs: readonly RouteLeg[], layout: MapLayout): string {
  const points = legs.flatMap((leg, index) => (index === 0 ? leg.points : leg.points.slice(1)));
  return points
    .map(layout.toSvg)
    .map(({ x, y }) => `${x},${y}`)
    .join(" ");
}

export function translateTo({ x, y }: Point): string {
  return `translate(${x}px, ${y}px)`;
}

/**
 * Keyframes that carry a marker along a path at a steady pace, around the
 * shelves rather than through them. Empty for a path of no length.
 */
export function walkKeyframes(points: readonly Point[]): Keyframe[] {
  const lengths = points
    .slice(1)
    .map((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total === 0) {
    return [];
  }

  let walked = 0;
  return points.map((point, index) => {
    walked += index > 0 ? lengths[index - 1]! : 0;
    return { offset: walked / total, transform: translateTo(point) };
  });
}

/** One numbered pin per stop, set against the shelf it is on. */
export function stopPins(stops: readonly RouteStop[], layout: MapLayout): StopPin[] {
  const nextLeg = stops[0]?.leg_index;
  return stops.map((stop, index) => {
    const { x, y } = layout.toSvg(stop);
    return {
      key: stop.category_id,
      x: x + layout.shelfSideOffset(stop.side),
      y,
      order: index + 1,
      isNext: stop.leg_index === nextLeg,
    };
  });
}

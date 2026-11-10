/**
 * The map's camera: which part of the store the screen shows. It frames what
 * matters now, the walk to the next station, inside the part of the map that
 * the header and the station sheet leave clear, and flies there when it changes.
 *
 * The camera is the SVG's viewBox, kept to the screen's own proportions so the
 * map is never stretched or letterboxed. Everything is in the map's units.
 */

import type { Point } from "./mapGeometry";

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Screen pixels covered by something floating over the map, on each side. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface FrameOptions {
  /** Never closer than this many units across the clear part: an aisle and what's either side. */
  minSpan?: number;
}

const DEFAULT_MIN_SPAN = 9;

export function parseViewBox(text: string): ViewBox {
  const [x = 0, y = 0, width = 1, height = 1] = text.trim().split(/[\s,]+/).map(Number);
  return { x, y, width, height };
}

export function formatViewBox({ x, y, width, height }: ViewBox): string {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return `${round(x)} ${round(y)} ${round(width)} ${round(height)}`;
}

/** The box around `points`, `margin` wider on every side. */
export function boundsOf(points: readonly Point[], margin = 0): ViewBox {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs) - margin;
  const y = Math.min(...ys) - margin;
  return { x, y, width: Math.max(...xs) + margin - x, height: Math.max(...ys) + margin - y };
}

/**
 * The viewBox showing `focus` whole and as large as it fits in the clear part of
 * a `screen`-sized map, centred there. Its proportions are the screen's.
 */
export function frameFocus(
  focus: ViewBox,
  screen: Size,
  insets: Insets = NO_INSETS,
  { minSpan = DEFAULT_MIN_SPAN }: FrameOptions = {},
): ViewBox {
  const clearWidth = Math.max(1, screen.width - insets.left - insets.right);
  const clearHeight = Math.max(1, screen.height - insets.top - insets.bottom);
  // Pixels per unit: the focus fits both ways, and no closer than minSpan across.
  const scale = Math.min(
    clearWidth / Math.max(focus.width, 1e-6),
    clearHeight / Math.max(focus.height, 1e-6),
    clearWidth / minSpan,
  );
  const centre = { x: focus.x + focus.width / 2, y: focus.y + focus.height / 2 };
  return {
    x: centre.x - (insets.left + clearWidth / 2) / scale,
    y: centre.y - (insets.top + clearHeight / 2) / scale,
    width: screen.width / scale,
    height: screen.height / scale,
  };
}

/** Units per screen pixel under `view`: what keeps a marker the same size on screen at any zoom. */
export function unitsPerPixel(view: ViewBox, screen: Size): number {
  return view.width / Math.max(1, screen.width);
}

/** Where a point of the map lands on the screen under `view`, in pixels. */
export function toScreen(point: Point, view: ViewBox, screen: Size): Point {
  const perPixel = unitsPerPixel(view, screen);
  return { x: (point.x - view.x) / perPixel, y: (point.y - view.y) / perPixel };
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** How much wider the view grows halfway through a long flight, to show where it's going. */
const FLIGHT_LIFT = 0.45;

/**
 * The camera's path from one view to another, for t from 0 to 1. The centre
 * glides, the zoom changes evenly in scale rather than in units, and a flight
 * across the store rises a little in the middle and settles, so the eye keeps
 * its place. Exactly `from` at 0 and `to` at 1.
 */
export function flight(from: ViewBox, to: ViewBox): (t: number) => ViewBox {
  const fromCentre = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCentre = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const travel = Math.hypot(toCentre.x - fromCentre.x, toCentre.y - fromCentre.y);
  const lift = FLIGHT_LIFT * Math.min(1, travel / Math.max(from.width, to.width));
  return (t: number) => {
    if (t <= 0) return from;
    if (t >= 1) return to;
    const eased = easeInOutCubic(t);
    const rise = 1 + lift * Math.sin(Math.PI * t);
    const width = from.width * (to.width / from.width) ** eased * rise;
    const height = from.height * (to.height / from.height) ** eased * rise;
    const centre = {
      x: fromCentre.x + (toCentre.x - fromCentre.x) * eased,
      y: fromCentre.y + (toCentre.y - fromCentre.y) * eased,
    };
    return { x: centre.x - width / 2, y: centre.y - height / 2, width, height };
  };
}

/**
 * Moving the map by hand: a finger drags it, two fingers pinch it, a wheel or a
 * double tap zooms it. Every gesture is a change to the camera's viewBox, in
 * the map's units, from movements on the screen, in pixels.
 */

import type { Point } from "./mapGeometry";
import type { Size, ViewBox } from "./mapCamera";
import { unitsPerPixel } from "./mapCamera";

/** The view after the map is dragged `dx`, `dy` pixels: the map follows the finger. */
export function panBy(view: ViewBox, dx: number, dy: number, screen: Size): ViewBox {
  const perPixel = unitsPerPixel(view, screen);
  return { ...view, x: view.x - dx * perPixel, y: view.y - dy * perPixel };
}

/**
 * The view zoomed in by `factor` (below 1 zooms out) about a point on the
 * screen, which stays under the finger or the cursor.
 */
export function zoomAt(view: ViewBox, factor: number, at: Point, screen: Size): ViewBox {
  const perPixel = unitsPerPixel(view, screen);
  const under = { x: view.x + at.x * perPixel, y: view.y + at.y * perPixel };
  const width = view.width / factor;
  const height = view.height / factor;
  return {
    x: under.x - (at.x / screen.width) * width,
    y: under.y - (at.y / screen.height) * height,
    width,
    height,
  };
}

/**
 * Two fingers moved from `before` to `after`: the map follows their middle and
 * scales with the distance between them.
 */
export function pinch(view: ViewBox, before: readonly [Point, Point], after: readonly [Point, Point], screen: Size): ViewBox {
  const middle = ([a, b]: readonly [Point, Point]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const spread = ([a, b]: readonly [Point, Point]) => Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  const [from, to] = [middle(before), middle(after)];
  const moved = panBy(view, to.x - from.x, to.y - from.y, screen);
  return zoomAt(moved, spread(after) / spread(before), to, screen);
}

export interface ViewLimits {
  /** The store's extent: the middle of the view stays inside it. */
  bounds: ViewBox;
  /** Closest in and furthest out, as the view's width in map units. */
  minWidth: number;
  maxWidth: number;
}

/** Inside the limits: no closer or further than allowed, and never off the store. */
export function clampView(view: ViewBox, { bounds, minWidth, maxWidth }: ViewLimits): ViewBox {
  const width = Math.min(maxWidth, Math.max(minWidth, view.width));
  const height = view.height * (width / view.width);
  const centre = {
    x: Math.min(bounds.x + bounds.width, Math.max(bounds.x, view.x + view.width / 2)),
    y: Math.min(bounds.y + bounds.height, Math.max(bounds.y, view.y + view.height / 2)),
  };
  return { x: centre.x - width / 2, y: centre.y - height / 2, width, height };
}

/** A flick's speed in pixels a millisecond, from the moves of its last `windowMs`. */
export function flickVelocity(
  moves: readonly { time: number; dx: number; dy: number }[],
  now: number,
  windowMs = 100,
): Point {
  const recent = moves.filter((move) => now - move.time <= windowMs);
  if (recent.length === 0) {
    // Held still before letting go.
    return { x: 0, y: 0 };
  }
  // Over at least a frame: a single move can't make a flick faster than the finger.
  const span = Math.max(16, now - recent[0]!.time);
  return {
    x: recent.reduce((sum, move) => sum + move.dx, 0) / span,
    y: recent.reduce((sum, move) => sum + move.dy, 0) / span,
  };
}

/** How quickly a flick dies down: the time for its speed to fall to a third, as on a phone's own lists. */
export const GLIDE_DECAY_MS = 325;
/** Slower than this, in pixels a millisecond, a flick has stopped. */
export const GLIDE_STOP = 0.02;

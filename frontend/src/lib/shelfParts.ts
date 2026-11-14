/**
 * A shelf's quarters, cut the way the server cuts them (`shelf_part_tiles` in
 * floor_routing.py): along its longer side, numbered from its top end for a shelf
 * that runs down the map, from its left end for one that runs across. The map's
 * units are tiles, so a drawn shelf's blocks give its tiles back exactly.
 */

import type { Rect } from "./mapGeometry";

export const SHELF_PARTS = 4;

export type ShelfAxis = "down" | "across";

interface Extent {
  axis: ShelfAxis;
  low: number;
  length: number;
}

function extentOf(rects: readonly Rect[]): Extent | null {
  if (rects.length === 0) {
    return null;
  }
  const top = Math.min(...rects.map((rect) => rect.y));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  const left = Math.min(...rects.map((rect) => rect.x));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  return bottom - top >= right - left
    ? { axis: "down", low: top, length: Math.round(bottom - top) }
    : { axis: "across", low: left, length: Math.round(right - left) };
}

/** Which way a shelf runs on the map: its quarters follow it. */
export function shelfAxis(rects: readonly Rect[]): ShelfAxis {
  return extentOf(rects)?.axis ?? "across";
}

/**
 * The blocks of one quarter of a shelf, cut from its drawn blocks. A shelf shorter
 * than four tiles has empty quarters; the nearest one stands in, as on the server.
 */
export function shelfPartRects(rects: readonly Rect[], part: number): Rect[] {
  const extent = extentOf(rects);
  if (!extent || extent.length === 0) {
    return [...rects];
  }
  const partOf = (tile: number) => Math.min(SHELF_PARTS - 1, Math.floor((tile * SHELF_PARTS) / extent.length));
  const tiles = Array.from({ length: extent.length }, (_, tile) => tile);
  const used = [...new Set(tiles.map(partOf))];
  const nearest = used.reduce((best, candidate) =>
    Math.abs(candidate - part) < Math.abs(best - part) || (Math.abs(candidate - part) === Math.abs(best - part) && candidate < best)
      ? candidate
      : best,
  );
  const mine = tiles.filter((tile) => partOf(tile) === nearest);
  const from = extent.low + mine[0]!;
  const to = extent.low + mine[mine.length - 1]! + 1;
  return rects.flatMap((rect) => {
    const start = extent.axis === "down" ? rect.y : rect.x;
    const end = start + (extent.axis === "down" ? rect.height : rect.width);
    const clipStart = Math.max(start, from);
    const clipEnd = Math.min(end, to);
    if (clipEnd <= clipStart) {
      return [];
    }
    return extent.axis === "down"
      ? [{ ...rect, y: clipStart, height: clipEnd - clipStart }]
      : [{ ...rect, x: clipStart, width: clipEnd - clipStart }];
  });
}

/** The middle of some blocks, where a pin stands on them. */
export function middleOf(rects: readonly Rect[]): { x: number; y: number } {
  return {
    x: rects.reduce((sum, rect) => sum + rect.x + rect.width / 2, 0) / rects.length,
    y: rects.reduce((sum, rect) => sum + rect.y + rect.height / 2, 0) / rects.length,
  };
}

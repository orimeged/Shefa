/**
 * What the positioning engine walks on, built from a manager's drawn floor plan.
 *
 * The walkways join the middles of neighbouring open tiles, straight and
 * diagonally. A diagonal needs both tiles beside it open, the same rule the
 * server's A* follows, so every point of every walkway lies inside open tiles:
 * a dot kept on them can't stand in a shelf, a wall or a checkout counter.
 * Everything that isn't open floor is also an obstacle for the dead-reckoned
 * track, which slides along it as a shopper slides along a shelf.
 *
 * All in metres, y up (see floorPlanMap), so headings turn the way the shopper does.
 */

import type { StoreMap } from "../../api/types";
import type { FloorGrid, TileKind } from "../admin/floorGrid";
import type { FloorFrame } from "../floorPlanMap";
import { cellCentre, cellId } from "../floorPlanMap";
import type { Point } from "../mapGeometry";
import type { MatcherTuning } from "./mapMatcher";
import type { Polygon } from "./obstacles";
import { ObstacleField, storeObstacles } from "./obstacles";
import type { WalkableEdge, WalkableNode } from "./walkGraph";
import { toWalkableEdges } from "./walkGraph";

const WALKABLE: ReadonlySet<TileKind> = new Set(["aisle", "entrance"]);

/**
 * How far a shelf or wall can be and still line a walkway: an aisle's width.
 * In an aisle people walk along it, even down its middle; further from every
 * edge than this, they cross floor any way they like.
 */
const AISLE_WIDTH_M = 2.4;

/** Bearings of the four ways out of a tile, clockwise from up the drawing (+y). */
const UP = 0;
const RIGHT = 90;
const DOWN = 180;
const LEFT = 270;

export interface WalkingMap {
  edges: WalkableEdge[];
  obstacles: ObstacleField;
  /** Where live location starts: the entrance. */
  start: Point;
  /** The way the first steps go, which is how the gyroscope learns which way is which. */
  initialBearing?: number;
  tuning?: MatcherTuning;
}

/**
 * Tuned on the dev seeds of gridSimulation.test.ts, judged on its holdout seeds.
 *
 * A tile step is short, so moving onto the next one is how walking goes, not a
 * noisy flip worth resisting. And a drawn plan's open floor gives the dot room
 * the graph's single aisle lines don't, so the route it is walking has to stand
 * in for them: in the simulation, a pull of 2.5 m kept the dot within a metre
 * of the shopper without Found it, while one who turned off the route was still
 * followed, a little later.
 */
export const GRID_TUNING: MatcherTuning = { switchCostM: 0, offRouteCostM: 2.5 };

/** The graph's map: its aisles, its shelves, and the entrance, whose one path says the way in. */
export function graphWalkingMap(map: StoreMap): WalkingMap | null {
  const entrance = map.nodes.find((node) => node.type === "entrance");
  return entrance
    ? { edges: toWalkableEdges(map), obstacles: storeObstacles(map), start: entrance }
    : null;
}

export function isOpen(grid: FloorGrid, row: number, col: number): boolean {
  const tile = grid[row]?.[col];
  return tile !== undefined && WALKABLE.has(tile.kind);
}

/** Walkways between neighbouring open tiles, each once. */
export function gridWalkableEdges(grid: FloorGrid, frame: FloorFrame): WalkableEdge[] {
  const open = (row: number, col: number) => isOpen(grid, row, col);
  const nodes = new Map<string, WalkableNode>();
  const node = (row: number, col: number): WalkableNode => {
    const id = cellId(row, col);
    let found = nodes.get(id);
    if (!found) {
      found = { id, ...cellCentre({ row, col }, frame) };
      nodes.set(id, found);
    }
    return found;
  };

  // Whether something solid stands within an aisle's width of a tile, one way.
  const reach = Math.max(1, Math.round(AISLE_WIDTH_M / frame.cellSizeM));
  const lined = (row: number, col: number, dRow: number, dCol: number) => {
    for (let step = 1; step <= reach; step++) {
      if (!open(row + dRow * step, col + dCol * step)) return true;
    }
    return false;
  };

  const edges: WalkableEdge[] = [];
  for (let row = 0; row < frame.rows; row++) {
    for (let col = 0; col < frame.cols; col++) {
      if (!open(row, col)) {
        continue;
      }
      if (open(row, col + 1)) {
        // Lined if both ends have something solid on the same side, above or below.
        const guides =
          (lined(row, col, -1, 0) && lined(row, col + 1, -1, 0)) ||
          (lined(row, col, 1, 0) && lined(row, col + 1, 1, 0));
        edges.push({ from: node(row, col), to: node(row, col + 1), guides });
      }
      if (open(row + 1, col)) {
        const guides =
          (lined(row, col, 0, -1) && lined(row + 1, col, 0, -1)) ||
          (lined(row, col, 0, 1) && lined(row + 1, col, 0, 1));
        edges.push({ from: node(row, col), to: node(row + 1, col), guides });
      }
      // Diagonals cross open floor, never beside a shelf, so they never straighten the heading.
      if (open(row + 1, col + 1) && open(row + 1, col) && open(row, col + 1)) {
        edges.push({ from: node(row, col), to: node(row + 1, col + 1), guides: false });
      }
      if (open(row + 1, col - 1) && open(row + 1, col) && open(row, col - 1)) {
        edges.push({ from: node(row, col), to: node(row + 1, col - 1), guides: false });
      }
    }
  }
  return edges;
}

/** Every stretch of blocked tiles in a row as a solid, and the plan's edge as the outline. */
export function gridObstacles(grid: FloorGrid, frame: FloorFrame): ObstacleField {
  const { rows, cols, cellSizeM: size } = frame;
  const box = (left: number, bottom: number, right: number, top: number): Polygon => [
    { x: left, y: bottom },
    { x: right, y: bottom },
    { x: right, y: top },
    { x: left, y: top },
  ];

  const solids: Polygon[] = [];
  for (let row = 0; row < rows; row++) {
    let start = -1;
    for (let col = 0; col <= cols; col++) {
      const blocked = col < cols && !isOpen(grid, row, col);
      if (blocked && start < 0) {
        start = col;
      } else if (!blocked && start >= 0) {
        // Row r spans from (rows - r - 1) to (rows - r) tiles up from the bottom.
        solids.push(box(start * size, (rows - row - 1) * size, col * size, (rows - row) * size));
        start = -1;
      }
    }
  }
  return new ObstacleField(solids, box(0, 0, cols * size, rows * size));
}

/**
 * The way in from the entrance. On the plan's edge it is straight away from that
 * edge; elsewhere, along the longest straight run of open floor.
 */
export function entranceBearing(grid: FloorGrid, row: number, col: number): number {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  if (row === rows - 1) return UP;
  if (row === 0) return DOWN;
  if (col === 0) return RIGHT;
  if (col === cols - 1) return LEFT;

  const run = (dRow: number, dCol: number) => {
    let length = 0;
    while (isOpen(grid, row + dRow * (length + 1), col + dCol * (length + 1))) {
      length += 1;
    }
    return length;
  };
  const ways: [number, number][] = [
    [UP, run(-1, 0)],
    [RIGHT, run(0, 1)],
    [DOWN, run(1, 0)],
    [LEFT, run(0, -1)],
  ];
  return ways.reduce((best, way) => (way[1] > best[1] ? way : best))[0];
}

/** The plan as the engine needs it, or null when there's no entrance to start from. */
export function gridWalkingMap(grid: FloorGrid, frame: FloorFrame): WalkingMap | null {
  for (let row = 0; row < frame.rows; row++) {
    for (let col = 0; col < frame.cols; col++) {
      if (grid[row]![col]!.kind === "entrance") {
        return {
          edges: gridWalkableEdges(grid, frame),
          obstacles: gridObstacles(grid, frame),
          start: cellCentre({ row, col }, frame),
          initialBearing: entranceBearing(grid, row, col),
          tuning: GRID_TUNING,
        };
      }
    }
  }
  return null;
}

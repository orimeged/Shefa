/**
 * A manager's drawn floor plan as shoppers see it, and its routes as the trip
 * logic reads them.
 *
 * Three frames meet here:
 * - tiles: `row`, `col`, row 0 at the top, as the manager drew it;
 * - metres: x right and y up from the plan's bottom-left corner, the frame the
 *   graph's map and the positioning engine use, so a turn to the right on the
 *   floor is a turn to the right on the screen;
 * - SVG units: one per tile, y down, so a 30-tile store draws like a 30-metre
 *   graph map whatever a tile measures.
 */

import type { GridPoint, GridRoute, Route, SavedFloorPlan } from "../api/types";
import type { FloorGrid, Tile, TileKind } from "./admin/floorGrid";
import { fromPayload, readCellSize } from "./admin/floorGrid";
import type { MapLayout, Point, ShelfName, ShelfRect } from "./mapGeometry";
import { fitZoneLabel } from "./mapGeometry";

const CELL_PREFIX = "cell:";
const PADDING = 0.4;
// Room under the floor for the entrance and checkout names, as on the graph map.
const LABEL_STRIP = 2.4;

/** What turning metres into tiles and back needs. */
export interface FloorFrame {
  rows: number;
  cols: number;
  cellSizeM: number;
}

export interface FloorMap {
  grid: FloorGrid;
  cellSizeM: number;
  frame: FloorFrame;
  /** Category or placed product id to the drawn department a route goes to. */
  placements: Readonly<Record<string, string>>;
  layout: MapLayout;
}

/** A plan shoppers can walk, or null: none saved, unreadable, or not routable yet. */
export function readFloorMap(saved: SavedFloorPlan | null): FloorMap | null {
  if (!saved?.check.routable) {
    return null;
  }
  const grid = fromPayload(saved.floor_plan);
  if (!grid) {
    return null;
  }
  const cellSizeM = readCellSize(saved.floor_plan);
  return {
    grid,
    cellSizeM,
    frame: frameOf(grid, cellSizeM),
    placements: saved.placements,
    layout: buildFloorLayout(grid, cellSizeM),
  };
}

export function frameOf(grid: FloorGrid, cellSizeM: number): FloorFrame {
  return { rows: grid.length, cols: grid[0]?.length ?? 0, cellSizeM };
}

/** A tile as routes and analytics name it, so trip progress can key on it like a node. */
export function cellId(row: number, col: number): string {
  return `${CELL_PREFIX}${row}:${col}`;
}

export function parseCellId(id: string): GridPoint | null {
  const match = /^cell:(\d+):(\d+)$/.exec(id);
  return match ? { row: Number(match[1]), col: Number(match[2]) } : null;
}

/** A tile's middle, in metres. */
export function cellCentre({ row, col }: GridPoint, { rows, cellSizeM }: FloorFrame): Point {
  return { x: (col + 0.5) * cellSizeM, y: (rows - row - 0.5) * cellSizeM };
}

/** The tile a point in metres stands on; outside the plan, a row or column out of range. */
export function tileAt({ x, y }: Point, { rows, cellSizeM }: FloorFrame): GridPoint {
  return { row: rows - 1 - Math.floor(y / cellSizeM), col: Math.floor(x / cellSizeM) };
}

/** Metres to the SVG's tile units: one unit per tile, and y turned to point down. */
export function metresToSvg({ x, y }: Point, { rows, cellSizeM }: FloorFrame): Point {
  return { x: x / cellSizeM, y: rows - y / cellSizeM };
}

/**
 * The server's walk across the plan in the graph route's shape, so ticking,
 * re-planning and drawing work the same on both. A stop names its department;
 * `aisle_no` and `side` have no meaning on a drawn plan and nothing shows them.
 */
export function routeFromGrid(route: GridRoute, frame: FloorFrame): Route {
  const point = (cell: GridPoint) => ({
    node_id: cellId(cell.row, cell.col),
    ...cellCentre(cell, frame),
  });
  return {
    store_id: route.store_id,
    start_node_id: cellId(route.start.row, route.start.col),
    end_node_id: cellId(route.end.row, route.end.col),
    total_length_m: route.total_length_m,
    stops: route.stops.map((stop) => ({
      seq: stop.seq,
      category_id: stop.category_id,
      category_name: stop.category_name,
      category_name_en: stop.category_name_en,
      node_id: cellId(stop.row, stop.col),
      aisle_no: 0,
      side: "left",
      ...cellCentre(stop, frame),
      leg_index: stop.leg_index,
      department: stop.department,
    })),
    legs: route.legs.map((leg) => {
      const last = leg.cells.at(-1)!;
      return {
        to_node_id: cellId(last.row, last.col),
        length_m: leg.length_m,
        points: leg.cells.map(point),
      };
    }),
    unplaced_category_ids: route.unplaced_category_ids,
  };
}

interface Run {
  row: number;
  col: number;
  length: number;
  tile: Tile;
}

/** Each row's stretches of one kind and label, which draw as one rectangle. */
function rowRuns(grid: FloorGrid): Run[] {
  const runs: Run[] = [];
  grid.forEach((line, row) => {
    let start = 0;
    for (let col = 1; col <= line.length; col++) {
      const tile = line[start]!;
      const next = line[col];
      if (next && next.kind === tile.kind && next.label === tile.label) {
        continue;
      }
      if (tile.kind !== "aisle") {
        runs.push({ row, col: start, length: col - start, tile });
      }
      start = col;
    }
  });
  return runs;
}

/** The same down each column, for shelves that run down the map. */
function columnRuns(grid: FloorGrid): Run[] {
  const cols = grid[0]?.length ?? 0;
  const runs: Run[] = [];
  for (let col = 0; col < cols; col++) {
    let start = 0;
    for (let row = 1; row <= grid.length; row++) {
      const tile = grid[start]![col]!;
      const next = grid[row]?.[col];
      if (next && next.kind === tile.kind && next.label === tile.label) {
        continue;
      }
      if (tile.kind === "shelf" && tile.label) {
        runs.push({ row: start, col, length: row - start, tile });
      }
      start = row;
    }
  }
  return runs;
}

/**
 * Each kind's rectangles, with a stretch that repeats exactly on the rows below
 * drawn as one block: a shelf running down the map is one shelf, not a stack of
 * one-row bricks with seams between them.
 */
function blocks(runs: readonly Run[], kind: TileKind): ShelfRect[] {
  const open = new Map<string, ShelfRect>();
  const done: ShelfRect[] = [];
  for (const run of runs) {
    if (run.tile.kind !== kind) {
      continue;
    }
    const key = `${run.col}:${run.length}:${run.tile.label ?? ""}`;
    const above = open.get(key);
    if (above && above.y + above.height === run.row) {
      above.height += 1;
    } else {
      if (above) done.push(above);
      const block: ShelfRect = { x: run.col, y: run.row, width: run.length, height: 1 };
      if (run.tile.label) {
        block.label = run.tile.label;
      }
      open.set(key, block);
    }
  }
  return [...done, ...open.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}

function centreOf(grid: FloorGrid, kind: TileKind): Point | null {
  const cells = grid.flatMap((line, row) =>
    line.flatMap((tile, col) => (tile.kind === kind ? [{ row, col }] : [])),
  );
  if (cells.length === 0) {
    return null;
  }
  const sum = cells.reduce((total, cell) => ({ x: total.x + cell.col, y: total.y + cell.row }), {
    x: 0,
    y: 0,
  });
  return { x: sum.x / cells.length + 0.5, y: sum.y / cells.length + 0.5 };
}

/** Each department named once, along its longest stretch of shelf. */
function shelfNames(across: readonly Run[], down: readonly Run[]): ShelfName[] {
  const longest = new Map<string, { run: Run; isVertical: boolean }>();
  for (const [runs, isVertical] of [
    [across, false],
    [down, true],
  ] as const) {
    for (const run of runs) {
      const label = run.tile.label;
      if (run.tile.kind !== "shelf" || !label) {
        continue;
      }
      const best = longest.get(label);
      if (!best || run.length > best.run.length) {
        longest.set(label, { run, isVertical });
      }
    }
  }
  return [...longest.entries()].map(([label, { run, isVertical }]) => {
    const { text, fontSize } = fitZoneLabel(label, run.length);
    return {
      key: label,
      text,
      // Inside a one-tile shelf, never taller than the shelf itself.
      fontSize: Math.min(fontSize, 0.62),
      isVertical,
      x: isVertical ? run.col + 0.5 : run.col + run.length / 2,
      y: isVertical ? run.row + run.length / 2 : run.row + 0.5,
    };
  });
}

export function buildFloorLayout(grid: FloorGrid, cellSizeM: number): MapLayout {
  const frame = frameOf(grid, cellSizeM);
  const { rows, cols } = frame;
  const runs = rowRuns(grid);
  const of = (kind: TileKind) => blocks(runs, kind);
  const entrance = centreOf(grid, "entrance") ?? { x: 0.5, y: rows - 0.5 };
  const checkout = centreOf(grid, "checkout") ?? { x: cols - 0.5, y: rows - 0.5 };

  return {
    kind: "floor",
    viewBox: `${-PADDING} ${-PADDING} ${cols + 2 * PADDING} ${rows + PADDING + LABEL_STRIP}`,
    floor: { x: 0, y: 0, width: cols, height: rows },
    shelves: of("shelf"),
    walls: of("wall"),
    counters: of("checkout"),
    doors: of("entrance"),
    shelfNames: shelfNames(runs, columnRuns(grid)),
    shelfRadius: 0.12,
    zones: [],
    walkways: [],
    sectionDots: [],
    aisleLabels: [],
    entrance,
    checkout,
    toSvg: (point) => metresToSvg(point, frame),
    // A stop already stands on the open tile beside its shelf.
    shelfSideOffset: () => 0,
  };
}

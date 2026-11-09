/**
 * Live location on a floor plan a manager drew: the whole pipeline, from sensor
 * samples to the dot, on the demo store drawn as 1 m tiles. The walks, the
 * walkers and the seeds are the graph simulation's (simulation.test.ts), so the
 * two maps are compared on the same store.
 *
 * As there, constants are tuned on the dev seeds only (SIM_SEEDS=dev) and judged
 * on the holdout seeds, and the figures describe a model of a shopper, not a
 * measured store.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { StoreMap } from "../../api/types";
import type { FloorGrid } from "../admin/floorGrid";
import { createGrid, makeTile, paint } from "../admin/floorGrid";
import type { FloorFrame } from "../floorPlanMap";
import { cellCentre, cellId, frameOf, tileAt } from "../floorPlanMap";
import type { Point } from "../mapGeometry";
import { vectorAlong } from "./angles";
import { DEFAULT_STEP_LENGTH_M, PositioningEngine } from "./engine";
import { gridWalkingMap, isOpen } from "./gridWalking";
import type { WalkModel } from "./simulatedWalk";
import { simulateWalk, TYPICAL_WALK } from "./simulatedWalk";
import { StepDetector } from "./stepDetector";
import { WalkGraph } from "./walkGraph";

const demo = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../backend/app/data/demo_store.json"), "utf-8"),
) as StoreMap;
const nodes = new Map(demo.nodes.map((node) => [node.id, node]));

const ROWS = 26;
const COLS = 32;

/**
 * The demo store in tiles: shelves three tiles deep centred on x = 3.5, 8.5 … 28.5
 * from y 5 to 21, so the aisles at x = 6, 11 … 26 are two tiles wide, as on the
 * graph's map; the front and back cross aisles are open floor.
 */
function demoStore(): FloorGrid {
  let grid = createGrid(ROWS, COLS);
  [2, 7, 12, 17, 22, 27].forEach((first, index) => {
    const cells = [];
    // y from 5 to 21 is rows 5 to 20 (row r covers y from 25 - r to 26 - r).
    for (let row = 5; row <= 20; row++) {
      for (let col = first; col < first + 3; col++) cells.push({ row, col });
    }
    grid = paint(grid, cells, makeTile("shelf", `מחלקה ${index + 1}`));
  });
  grid = paint(grid, [{ row: 25, col: 2 }], makeTile("entrance"));
  return paint(grid, [{ row: 23, col: 28 }, { row: 23, col: 29 }, { row: 23, col: 31 }], makeTile("checkout"));
}

const GRID = demoStore();
const FRAME: FloorFrame = frameOf(GRID, 1);
const WALKING = gridWalkingMap(GRID, FRAME)!;
const GRAPH = new WalkGraph(WALKING.edges);
// For tuning runs on the dev seeds only: TUNE_SWITCH and TUNE_OFF_ROUTE override the shipped values.
const TUNING = {
  ...WALKING.tuning,
  ...(process.env.TUNE_SWITCH ? { switchCostM: Number(process.env.TUNE_SWITCH) } : {}),
  ...(process.env.TUNE_OFF_ROUTE ? { offRouteCostM: Number(process.env.TUNE_OFF_ROUTE) } : {}),
  ...(process.env.TUNE_CATCH_UP ? { catchUpM: Number(process.env.TUNE_CATCH_UP) } : {}),
  ...(process.env.TUNE_MAX_CATCH_UP ? { maxCatchUpM: Number(process.env.TUNE_MAX_CATCH_UP) } : {}),
};

/** A graph node's place on the tiles: the middle of the tile it stands on. */
const onTiles = (id: string): Point => cellCentre(tileAt(nodes.get(id)!, FRAME), FRAME);

// The same aisle band and wrong-aisle rule as the graph's simulation.
const AISLE_FLOOR_Y = 5;
const AISLE_CEILING_Y = 21;
const inAisle = (point: Point) => point.y > AISLE_FLOOR_Y && point.y < AISLE_CEILING_Y;

interface Trip {
  name: string;
  path: string[];
  stops: string[];
  /** The route the app showed, when the shopper didn't walk it. */
  shown?: string[];
}

const TRIPS: Trip[] = [
  {
    name: "two aisles",
    path: "entrance front_0 front_1 a1_s1 a1_s2 a1_s3 back_1 back_2 back_3 a3_s3 a3_s2 a3_s1 front_3 front_4 front_5 front_6 checkout".split(" "),
    stops: ["a1_s2", "a3_s2"],
  },
  {
    name: "with a dead end",
    path: "entrance front_0 front_1 front_2 a2_s1 a2_s2 a2_s3 back_2 back_3 back_4 a4_s3 a4_s2 a4_s1 front_4 front_5 a5_s1 a5_s2 a5_s1 front_5 front_6 checkout".split(" "),
    stops: ["a2_s2", "a4_s2", "a5_s2"],
  },
  {
    name: "every aisle",
    path: "entrance front_0 front_1 a1_s1 a1_s2 a1_s3 back_1 back_2 a2_s3 a2_s2 a2_s1 front_2 front_3 a3_s1 a3_s2 a3_s3 back_3 back_4 a4_s3 a4_s2 a4_s1 front_4 front_5 a5_s1 a5_s2 a5_s3 back_5 a5_s3 a5_s2 a5_s1 front_5 front_6 checkout".split(" "),
    stops: ["a1_s2", "a2_s2", "a3_s2", "a4_s2", "a5_s2"],
  },
  {
    name: "turns off the route it was shown",
    path: "entrance front_0 front_1 front_2 a2_s1 a2_s2 a2_s3 back_2 back_3 back_4 a4_s3 a4_s2 a4_s1 front_4 front_5 front_6 checkout".split(" "),
    stops: ["a2_s2"],
    shown: "entrance front_0 front_1 a1_s1 a1_s2 a1_s3 back_1 back_2 back_3 back_4 a4_s3 a4_s2 a4_s1 front_4 front_5 front_6 checkout".split(" "),
  },
];

/** Every tile along the straight runs between the path's points: a route's cells, in order. */
function routeCells(path: readonly string[]): string[] {
  const cells: string[] = [];
  for (let index = 0; index + 1 < path.length; index++) {
    const from = tileAt(onTiles(path[index]!), FRAME);
    const to = tileAt(onTiles(path[index + 1]!), FRAME);
    const steps = Math.max(Math.abs(to.row - from.row), Math.abs(to.col - from.col));
    for (let step = 0; step <= steps; step++) {
      const id = cellId(
        from.row + Math.round(((to.row - from.row) * step) / Math.max(1, steps)),
        from.col + Math.round(((to.col - from.col) * step) / Math.max(1, steps)),
      );
      if (cells.at(-1) !== id) cells.push(id);
    }
  }
  return cells;
}

const MODELS: Record<string, WalkModel> = {
  typical: TYPICAL_WALK,
  "short steps": { ...TYPICAL_WALK, meanStepM: 0.5, stepDurationMs: 640 },
  "long steps": { ...TYPICAL_WALK, meanStepM: 0.78, stepDurationMs: 500 },
  "swaying phone": { ...TYPICAL_WALK, headingWanderDegrees: 12 },
  "fast gyro drift": { ...TYPICAL_WALK, gyroDriftDegreesPerStep: 0.4 },
  "phone turned in hand": { ...TYPICAL_WALK, gripShiftEverySteps: 14, gripShiftDegrees: 60 },
};

const seeds = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);
const useDevSeeds = process.env.SIM_SEEDS === "dev";
const SEEDS = useDevSeeds ? seeds(1, 30) : seeds(2001, 60);
// For tuning runs: a few walkers only.
const ONLY = process.env.SIM_MODELS?.split(",");

interface Tally {
  errors: number[];
  /** How far the dot moved on each step, anchors aside: a leap is what a shopper sees as a dart. */
  moves: number[];
  wrongAisle: number;
  /** Dot positions on a tile that isn't open floor. Must stay zero. */
  onBlockedTile: number;
  /** Next dot on the far side of a shelf, much further to walk than to see. Must stay zero. */
  throughShelf: number;
}

const tally = (): Tally => ({ errors: [], moves: [], wrongAisle: 0, onBlockedTile: 0, throughShelf: 0 });

function crossesBlocked(a: Point, b: Point): boolean {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.1);
  for (let step = 1; step < steps; step++) {
    const share = step / steps;
    const { row, col } = tileAt({ x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share }, FRAME);
    if (!isOpen(GRID, row, col)) return true;
  }
  return false;
}

/** Rounding a shelf's end also cuts its corner between two steps; the walk there is as short as the line. */
function jumpsThroughShelf(a: Point, b: Point): boolean {
  if (!crossesBlocked(a, b)) return false;
  return GRAPH.pathLength(GRAPH.nearest(a), GRAPH.nearest(b)) > Math.hypot(b.x - a.x, b.y - a.y) + 1.5;
}

function record(into: Tally, dot: Point, truth: Point, previous: Point): void {
  into.errors.push(Math.hypot(dot.x - truth.x, dot.y - truth.y));
  into.moves.push(Math.hypot(dot.x - previous.x, dot.y - previous.y));
  const { row, col } = tileAt(dot, FRAME);
  if (!isOpen(GRID, row, col)) into.onBlockedTile += 1;
  if (jumpsThroughShelf(previous, dot)) into.throughShelf += 1;
  if (inAisle(truth) && Math.abs(dot.x - truth.x) > 2) into.wrongAisle += 1;
}

interface Run {
  routed: Tally;
  unrouted: Tally;
  naive: Tally;
}

function runTrip(trip: Trip, model: WalkModel, seed: number, useAnchors: boolean, into: Run): void {
  const options = { initialBearing: WALKING.initialBearing, tuning: TUNING };
  const make = () =>
    new PositioningEngine(WALKING.start, WALKING.edges, DEFAULT_STEP_LENGTH_M, WALKING.obstacles, options);
  const routed = make();
  const unrouted = make();
  routed.followRoute([routeCells(trip.shown ?? trip.path)]);
  const detector = new StepDetector();
  const stops = trip.stops.map(onTiles);

  let raw = WALKING.start;
  let previous = { routed: raw, unrouted: raw, naive: raw };
  simulateWalk(trip.path.map(onTiles), model, seed, {
    orientation: (alpha, beta, gamma) => {
      routed.handleOrientation(alpha, beta, gamma);
      unrouted.handleOrientation(alpha, beta, gamma);
    },
    motion: (x, y, z, time, rotation) => {
      routed.handleMotion(x, y, z, time, rotation);
      unrouted.handleMotion(x, y, z, time, rotation);
      for (let step = detector.push(x, y, z, time); step > 0; step--) {
        const move = vectorAlong(unrouted.snapshot.heading, DEFAULT_STEP_LENGTH_M);
        raw = { x: raw.x + move.x, y: raw.y + move.y };
      }
    },
    stepped: (truth) => {
      const now = { routed: routed.snapshot, unrouted: unrouted.snapshot, naive: GRAPH.pointAt(GRAPH.nearest(raw)) };
      record(into.routed, now.routed, truth, previous.routed);
      record(into.unrouted, now.unrouted, truth, previous.unrouted);
      record(into.naive, now.naive, truth, previous.naive);
      previous = now;
    },
    arrived: (waypoint) => {
      if (useAnchors && stops.some((stop) => stop.x === waypoint.x && stop.y === waypoint.y)) {
        routed.anchorTo(waypoint);
        unrouted.anchorTo(waypoint);
        raw = waypoint;
        previous = { routed: waypoint, unrouted: waypoint, naive: previous.naive };
      }
    },
  });
}

interface Summary {
  /** The longest single step the dot took, in metres, and the 99th percentile. */
  biggestMove: number;
  p99Move: number;
  mean: number;
  p95: number;
  wrongAisle: number;
  onBlockedTile: number;
  throughShelf: number;
}

function summarize(t: Tally): Summary {
  const sorted = [...t.errors].sort((a, b) => a - b);
  const moves = [...t.moves].sort((a, b) => a - b);
  return {
    biggestMove: moves.at(-1) ?? 0,
    p99Move: moves[Math.floor(moves.length * 0.99)] ?? 0,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p95: sorted[Math.floor(sorted.length * 0.95)]!,
    wrongAisle: t.wrongAisle / t.errors.length,
    onBlockedTile: t.onBlockedTile,
    throughShelf: t.throughShelf,
  };
}

function evaluate(trips: readonly Trip[], model: WalkModel, useAnchors: boolean) {
  const run: Run = { routed: tally(), unrouted: tally(), naive: tally() };
  for (const trip of trips) {
    for (const seed of SEEDS) runTrip(trip, model, seed, useAnchors, run);
  }
  return { routed: summarize(run.routed), unrouted: summarize(run.unrouted), naive: summarize(run.naive) };
}

const row = (label: string, s: Summary) =>
  `${label.padEnd(46)} mean ${s.mean.toFixed(2)} m   p95 ${s.p95.toFixed(2)} m   ` +
  `wrong aisle ${(s.wrongAisle * 100).toFixed(1)}%   step p99 ${s.p99Move.toFixed(2)} m, max ${s.biggestMove.toFixed(2)} m   ` +
  `on blocked ${s.onBlockedTile}   through shelf ${s.throughShelf}`;

const FOLLOWED = TRIPS.filter((trip) => !trip.shown);
const DETOUR = TRIPS.filter((trip) => trip.shown);

describe(`live location on a drawn plan, ${useDevSeeds ? "dev" : "holdout"} seeds`, () => {
  const report = Object.entries(MODELS)
    .filter(([name]) => !ONLY || ONLY.includes(name))
    .map(([name, model]) => ({
    name,
    anchored: evaluate(FOLLOWED, model, true),
    unanchored: evaluate(FOLLOWED, model, false),
    detour: evaluate(DETOUR, model, true),
  }));

  it("prints the figures", () => {
    for (const { name, anchored, unanchored, detour } of report) {
      console.log(row(`${name}, Found it, on the route`, anchored.routed));
      console.log(row(`${name}, Found it, no route`, anchored.unrouted));
      console.log(row(`${name}, no Found it, on the route`, unanchored.routed));
      console.log(row(`${name}, no Found it, no route`, unanchored.unrouted));
      console.log(row(`${name}, naive snapping`, unanchored.naive));
      console.log(row(`${name}, off the route it was shown`, detour.routed));
      console.log(row(`${name}, same walk, no route`, detour.unrouted));
    }
  });

  it("never puts the dot on a shelf, wall or till tile", () => {
    for (const { anchored, unanchored, detour } of report) {
      for (const result of [anchored, unanchored, detour]) {
        expect(result.routed.onBlockedTile).toBe(0);
        expect(result.unrouted.onBlockedTile).toBe(0);
      }
    }
  });

  // Guards, not targets: a typical walker on the holdout seeds measured 0.67 m with Found it
  // and 0.83 m without; these leave room for the seeds without letting a regression through.
  it("keeps a typical shopper's dot within a metre, in the right aisle", () => {
    const typical = report.find(({ name }) => name === "typical");
    if (!typical) return;
    expect(typical.anchored.routed.mean).toBeLessThan(1);
    expect(typical.anchored.routed.wrongAisle).toBeLessThan(0.02);
    expect(typical.unanchored.routed.mean).toBeLessThan(1.5);
  });

  it("does better with the route than without it, for every walker", () => {
    for (const { anchored, unanchored } of report) {
      expect(anchored.routed.mean).toBeLessThanOrEqual(anchored.unrouted.mean);
      expect(unanchored.routed.mean).toBeLessThanOrEqual(unanchored.unrouted.mean);
    }
  });

  it("still follows a shopper who leaves the route, no worse than with no route at all", () => {
    for (const { detour } of report) {
      expect(detour.routed.mean).toBeLessThanOrEqual(detour.unrouted.mean + 0.5);
    }
  });

  it("never moves the dot through a shelf", () => {
    for (const { anchored, unanchored, detour } of report) {
      for (const result of [anchored, unanchored, detour]) {
        expect(result.routed.throughShelf).toBe(0);
        expect(result.unrouted.throughShelf).toBe(0);
      }
    }
  });
});

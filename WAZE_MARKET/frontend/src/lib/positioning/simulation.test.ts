/**
 * The whole pipeline, from sensor samples to the dot, on the real demo store.
 *
 * Constants are tuned on the dev seeds only (SIM_SEEDS=dev) and judged on the
 * holdout seeds, so these figures don't flatter the tuning. They still describe
 * a model of a shopper, not a measured store.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { StoreMap } from "../../api/types";
import type { Point } from "../mapGeometry";
import { vectorAlong } from "./angles";
import { DEFAULT_STEP_LENGTH_M, PositioningEngine } from "./engine";
import { storeObstacles } from "./obstacles";
import type { WalkModel } from "./simulatedWalk";
import { simulateWalk, TYPICAL_WALK } from "./simulatedWalk";
import { StepDetector } from "./stepDetector";
import { toWalkableEdges, WalkGraph } from "./walkGraph";

const store = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../backend/app/data/demo_store.json"), "utf-8"),
) as StoreMap;

const edges = toWalkableEdges(store);
const graph = new WalkGraph(edges);
const obstacles = storeObstacles(store);
const nodes = new Map(store.nodes.map((node) => [node.id, node]));

const AISLE_FLOOR_Y = 5;
const AISLE_CEILING_Y = 21;

interface Trip {
  name: string;
  path: string[];
  stops: string[];
}

const TRIPS: Trip[] = [
  {
    name: "two aisles",
    path: "entrance front_0 front_1 a1_s1 a1_s2 a1_s3 back_1 back_2 back_3 a3_s3 a3_s2 a3_s1 front_3 front_4 front_5 front_6 checkout".split(" "),
    stops: ["a1_s2", "a3_s2"],
  },
  {
    name: "turn back in an aisle",
    path: "entrance front_0 front_1 front_2 a2_s1 a2_s2 a2_s3 back_2 back_3 back_4 a4_s3 a4_s2 a4_s1 front_4 front_5 a5_s1 a5_s2 a5_s1 front_5 front_6 checkout".split(" "),
    stops: ["a2_s2", "a4_s2", "a5_s2"],
  },
  {
    name: "every aisle",
    path: "entrance front_0 front_1 a1_s1 a1_s2 a1_s3 back_1 back_2 a2_s3 a2_s2 a2_s1 front_2 front_3 a3_s1 a3_s2 a3_s3 back_3 back_4 a4_s3 a4_s2 a4_s1 front_4 front_5 a5_s1 a5_s2 a5_s3 back_5 a5_s3 a5_s2 a5_s1 front_5 front_6 checkout".split(" "),
    stops: ["a1_s2", "a2_s2", "a3_s2", "a4_s2", "a5_s2"],
  },
];

const MODELS: Record<string, WalkModel> = {
  typical: TYPICAL_WALK,
  "short steps": { ...TYPICAL_WALK, meanStepM: 0.5, stepDurationMs: 640 },
  "long steps": { ...TYPICAL_WALK, meanStepM: 0.78, stepDurationMs: 500 },
  "swaying phone": { ...TYPICAL_WALK, headingWanderDegrees: 12 },
  "fast gyro drift": { ...TYPICAL_WALK, gyroDriftDegreesPerStep: 0.4 },
  "weak footfalls": { ...TYPICAL_WALK, stepAmplitudeMs2: 1.1 },
  "phone turned in hand": { ...TYPICAL_WALK, gripShiftEverySteps: 14, gripShiftDegrees: 60 },
  // A phone in a cart's holder feels wheels, not feet. How weak is a guess: nobody measured one.
  "phone on a cart": { ...TYPICAL_WALK, stepAmplitudeMs2: 0.5, sensorNoiseMs2: 0.35 },
};

const seeds = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);
const useDevSeeds = process.env.SIM_SEEDS === "dev";
const SEEDS = useDevSeeds ? seeds(1, 40) : seeds(2001, 100);

interface Sample {
  error: number;
  wrongAisle: boolean;
}

interface Result {
  live: Sample[];
  noObstacles: Sample[];
  naive: Sample[];
  liveShelfJumps: number;
  noObstaclesShelfJumps: number;
  naiveShelfJumps: number;
  dotInsideObstacle: number;
}

const inAisle = (point: Point) => point.y > AISLE_FLOOR_Y && point.y < AISLE_CEILING_Y;

function sample(estimate: Point, truth: Point): Sample {
  return {
    error: Math.hypot(estimate.x - truth.x, estimate.y - truth.y),
    wrongAisle: inAisle(truth) && Math.abs(estimate.x - truth.x) > 2,
  };
}

function isShelfJump(previous: Point, next: Point): boolean {
  return inAisle(previous) && inAisle(next) && Math.abs(previous.x - next.x) > 1;
}

function runTrip(trip: Trip, model: WalkModel, seed: number, useAnchors: boolean): Result {
  const start = nodes.get("entrance")!;
  const engine = new PositioningEngine(start, edges, DEFAULT_STEP_LENGTH_M, obstacles);
  const withoutObstacles = new PositioningEngine(start, edges);
  const detector = new StepDetector();
  const stops = new Set(trip.stops.map((id) => nodes.get(id)!));

  let raw: Point = start;
  let previousLive: Point = raw;
  let previousPlain: Point = raw;
  let previousNaive: Point = raw;
  const result: Result = {
    live: [],
    noObstacles: [],
    naive: [],
    liveShelfJumps: 0,
    noObstaclesShelfJumps: 0,
    naiveShelfJumps: 0,
    dotInsideObstacle: 0,
  };

  simulateWalk(trip.path.map((id) => nodes.get(id)!), model, seed, {
    orientation: (alpha, beta, gamma) => {
      engine.handleOrientation(alpha, beta, gamma);
      withoutObstacles.handleOrientation(alpha, beta, gamma);
    },
    motion: (x, y, z, time) => {
      engine.handleMotion(x, y, z, time);
      withoutObstacles.handleMotion(x, y, z, time);
      const steps = detector.push(x, y, z, time);
      for (let index = 0; index < steps; index += 1) {
        const step = vectorAlong(withoutObstacles.snapshot.heading, DEFAULT_STEP_LENGTH_M);
        raw = { x: raw.x + step.x, y: raw.y + step.y };
      }
    },
    stepped: (truth) => {
      const live = engine.snapshot;
      const plain = withoutObstacles.snapshot;
      const naive = graph.pointAt(graph.nearest(raw));
      result.live.push(sample(live, truth));
      result.noObstacles.push(sample(plain, truth));
      result.naive.push(sample(naive, truth));
      if (isShelfJump(previousLive, live)) result.liveShelfJumps += 1;
      if (isShelfJump(previousPlain, plain)) result.noObstaclesShelfJumps += 1;
      if (isShelfJump(previousNaive, naive)) result.naiveShelfJumps += 1;
      if (inAisle(live) && obstacles.contains(live)) result.dotInsideObstacle += 1;
      previousLive = live;
      previousPlain = plain;
      previousNaive = naive;
    },
    arrived: (waypoint) => {
      if (useAnchors && stops.has(waypoint as never)) {
        // A fix is a correction the shopper asked for, not a walk through a shelf.
        engine.anchorTo(waypoint);
        withoutObstacles.anchorTo(waypoint);
        raw = waypoint;
        previousLive = waypoint;
        previousPlain = waypoint;
      }
    },
  });
  return result;
}

interface Summary {
  meanError: number;
  p95Error: number;
  wrongAisleShare: number;
  shelfJumpsPerTrip: number;
}

function summarize(samples: Sample[], shelfJumps: number, trips: number): Summary {
  const sorted = samples.map((s) => s.error).sort((a, b) => a - b);
  return {
    meanError: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p95Error: sorted[Math.floor(sorted.length * 0.95)]!,
    wrongAisleShare: samples.filter((s) => s.wrongAisle).length / samples.length,
    shelfJumpsPerTrip: shelfJumps / trips,
  };
}

function evaluate(model: WalkModel, useAnchors: boolean) {
  const results = TRIPS.flatMap((trip) => SEEDS.map((seed) => runTrip(trip, model, seed, useAnchors)));
  return {
    live: summarize(
      results.flatMap((r) => r.live),
      results.reduce((sum, r) => sum + r.liveShelfJumps, 0),
      results.length,
    ),
    noObstacles: summarize(
      results.flatMap((r) => r.noObstacles),
      results.reduce((sum, r) => sum + r.noObstaclesShelfJumps, 0),
      results.length,
    ),
    dotInsideObstacle: results.reduce((sum, r) => sum + r.dotInsideObstacle, 0),
    naive: summarize(
      results.flatMap((r) => r.naive),
      results.reduce((sum, r) => sum + r.naiveShelfJumps, 0),
      results.length,
    ),
  };
}

const row = (label: string, s: Summary) =>
  `${label.padEnd(30)} mean ${s.meanError.toFixed(2)} m   p95 ${s.p95Error.toFixed(2)} m   ` +
  `wrong aisle ${(s.wrongAisleShare * 100).toFixed(1)}%   shelf jumps/trip ${s.shelfJumpsPerTrip.toFixed(2)}`;

describe(`simulated walks on ${useDevSeeds ? "dev" : "holdout"} seeds`, () => {
  const report = Object.entries(MODELS).map(([name, model]) => ({
    name,
    anchored: evaluate(model, true),
    unanchored: evaluate(model, false),
  }));

  it("prints the figures", () => {
    for (const { name, anchored, unanchored } of report) {
      console.log(row(`${name}, with Found it`, anchored.live));
      console.log(row(`${name}, with Found it, no shelves`, anchored.noObstacles));
      console.log(row(`${name}, no Found it`, unanchored.live));
      console.log(row(`${name}, no Found it, no shelves`, unanchored.noObstacles));
      console.log(row(`${name}, naive snapping`, unanchored.naive));
    }
  });

  it("never jumps through a shelf", () => {
    for (const { anchored, unanchored } of report) {
      expect(anchored.live.shelfJumpsPerTrip).toBe(0);
      expect(unanchored.live.shelfJumpsPerTrip).toBe(0);
    }
  });

  it("never puts the dot inside a shelf", () => {
    for (const { anchored, unanchored } of report) {
      expect(anchored.dotInsideObstacle).toBe(0);
      expect(unanchored.dotInsideObstacle).toBe(0);
    }
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { StoreMap } from "../../api/types";
import type { Point } from "../mapGeometry";
import { angleDifference } from "./angles";
import { PositioningEngine } from "./engine";
import { simulateWalk, TYPICAL_WALK } from "./simulatedWalk";
import { toWalkableEdges } from "./walkGraph";

const store = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../backend/app/data/demo_store.json"), "utf-8"),
) as StoreMap;

const edges = toWalkableEdges(store);
const nodes = new Map(store.nodes.map((node) => [node.id, node]));
const path = (...ids: string[]): Point[] => ids.map((id) => nodes.get(id)!);

const ENTRANCE = nodes.get("entrance")!;

function runWalk(waypoints: Point[], seed: number) {
  const engine = new PositioningEngine(ENTRANCE, edges);
  const errors: number[] = [];
  let truth = waypoints[0]!;

  simulateWalk(waypoints, TYPICAL_WALK, seed, {
    orientation: (alpha, beta, gamma) => engine.handleOrientation(alpha, beta, gamma),
    motion: (x, y, z, time) => engine.handleMotion(x, y, z, time),
    stepped: (point) => {
      truth = point;
      const { x, y } = engine.snapshot;
      errors.push(Math.hypot(x - truth.x, y - truth.y));
    },
  });
  return { engine, errors, truth };
}

describe("PositioningEngine", () => {
  it("starts at the entrance, facing in", () => {
    const engine = new PositioningEngine(ENTRANCE, edges);

    expect(engine.snapshot).toEqual({ x: 2, y: 0, heading: 0 });
    expect(engine.isCalibrated).toBe(false);
  });

  it("calibrates on the first steps, whatever the phone's reference frame", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { engine } = runWalk(path("entrance", "front_0", "front_1"), seed);

      expect(engine.isCalibrated).toBe(true);
    }
  });

  it("reports the walker's direction after a turn", () => {
    const { engine } = runWalk(path("entrance", "front_0", "front_1", "front_2", "front_3"), 11);

    expect(Math.abs(angleDifference(engine.snapshot.heading, 90))).toBeLessThan(20);
  });

  it("follows a walk through an aisle", () => {
    const { engine } = runWalk(path("entrance", "front_0", "front_1", "a1_s1", "a1_s2"), 12);

    expect(engine.snapshot.x).toBe(6);
  });

  it("does not move until a walk is confirmed", () => {
    const engine = new PositioningEngine(ENTRANCE, edges);

    engine.handleOrientation(10, 40, 0);
    for (let time = 0; time < 3000; time += 16) {
      engine.handleMotion(0, 0, 9.81, time);
    }

    expect(engine.snapshot).toEqual({ x: 2, y: 0, heading: 0 });
  });

  it("moves to an anchor", () => {
    const engine = new PositioningEngine(ENTRANCE, edges);

    engine.anchorTo(nodes.get("a3_s2")!);

    expect(engine.snapshot.x).toBe(16);
    expect(engine.snapshot.y).toBe(13);
  });
});

describe("calibrating from the way the shopper faces at Start", () => {
  // alpha turns counter-clockwise from an arbitrary reference: facing bearing b reads ref - b.
  const REFERENCE = 213;
  const facing = (engine: PositioningEngine, bearing: number, samples = 12) => {
    for (let index = 0; index < samples; index += 1) {
      engine.handleOrientation((REFERENCE - bearing + 3600) % 360, 38, 4);
    }
  };

  it("points the cone into the store before the first step", () => {
    const engine = new PositioningEngine(ENTRANCE, edges, undefined, undefined, { calibrateOnFacing: true });
    // The shopper faces in; the phone's own reference is anything at all.
    facing(engine, 0);

    expect(engine.isCalibrated).toBe(true);
    expect(Math.abs(angleDifference(engine.snapshot.heading, 0))).toBeLessThan(1);
  });

  it("turns with the shopper from there on, the right way round", () => {
    const engine = new PositioningEngine(ENTRANCE, edges, undefined, undefined, { calibrateOnFacing: true });
    facing(engine, 0);
    // A quarter turn clockwise on the floor is a quarter turn clockwise on the map.
    facing(engine, 90, 60);

    expect(Math.abs(angleDifference(engine.snapshot.heading, 90))).toBeLessThan(2);
  });

  it("works whatever the map calls the way in", () => {
    // A drawn plan whose entrance opens to the right: facing in is a heading of 90 on the map.
    const engine = new PositioningEngine(ENTRANCE, edges, undefined, undefined, {
      calibrateOnFacing: true,
      initialBearing: 90,
    });
    facing(engine, 17);

    expect(Math.abs(angleDifference(engine.snapshot.heading, 90))).toBeLessThan(1);
  });

  it("needs a sixth of a second of readings, not one", () => {
    const engine = new PositioningEngine(ENTRANCE, edges, undefined, undefined, { calibrateOnFacing: true });
    facing(engine, 0, 3);
    expect(engine.isCalibrated).toBe(false);
  });

  it("leaves the graph's four-step calibration alone when not asked for", () => {
    const engine = new PositioningEngine(ENTRANCE, edges);
    facing(engine, 0, 40);
    expect(engine.isCalibrated).toBe(false);
  });

  /** Mean error over a walk, for an engine calibrated one way or the other. */
  function meanError(calibrateOnFacing: boolean, seed: number, standOffDegrees = 0): number {
    const engine = new PositioningEngine(ENTRANCE, edges, undefined, undefined, { calibrateOnFacing });
    const errors: number[] = [];
    // Stand facing in for half a second, then in, along the front and up the first aisle.
    simulateWalk(
      path("entrance", "front_0", "front_1", "a1_s1", "a1_s2", "a1_s3"),
      { ...TYPICAL_WALK, standFirstMs: 500, standOffDegrees },
      seed,
      {
        orientation: (alpha, beta, gamma) => engine.handleOrientation(alpha, beta, gamma),
        motion: (x, y, z, time) => engine.handleMotion(x, y, z, time),
        stepped: (truth) => errors.push(Math.hypot(engine.snapshot.x - truth.x, engine.snapshot.y - truth.y)),
      },
    );
    return errors.reduce((sum, error) => sum + error, 0) / errors.length;
  }

  const SEEDS = Array.from({ length: 20 }, (_, index) => 301 + index);
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

  it("tracks a walk at least as well as calibrating on the first four steps", () => {
    const facing = average(SEEDS.map((seed) => meanError(true, seed)));
    const stepping = average(SEEDS.map((seed) => meanError(false, seed)));
    expect(facing).toBeLessThanOrEqual(stepping + 0.05);
  });

  it("recovers along the aisles when the shopper stood a little off the way in", () => {
    // Pressing Start while turned 20 degrees: the aisles straighten it as they walk.
    const off = average(SEEDS.map((seed) => meanError(true, seed, 20)));
    const square = average(SEEDS.map((seed) => meanError(true, seed)));
    expect(off).toBeLessThan(square + 0.6);
  });
});

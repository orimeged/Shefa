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

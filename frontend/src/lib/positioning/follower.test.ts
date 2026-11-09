import { describe, expect, it } from "vitest";

import type { Point } from "../mapGeometry";
import { easeHeading, PathFollower } from "./follower";

const FRAME_MS = 1000 / 60;

/** How far `point` is from the nearest piece of `path`. */
function offPath(point: Point, path: readonly Point[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1]!;
    const b = path[index]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const share = dx || dy ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(point.x - a.x - share * dx, point.y - a.y - share * dy));
  }
  return best;
}

describe("PathFollower", () => {
  it("turns a corner on the path instead of cutting across it", () => {
    const corner: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 3 },
      { x: 3, y: 3 },
    ];
    const follower = new PathFollower(corner[0]!);
    follower.extend(corner);

    for (let frame = 0; frame < 240; frame += 1) {
      expect(offPath(follower.advance(FRAME_MS), corner)).toBeLessThan(1e-9);
    }
    expect(follower.position).toEqual({ x: 3, y: 3 });
  });

  it("moves a little every frame rather than hopping", () => {
    const follower = new PathFollower({ x: 0, y: 0 });
    let previous = follower.position;
    let biggest = 0;
    // A walk at a normal pace: 0.7 m every 560 ms.
    for (let frame = 0; frame < 300; frame += 1) {
      if (frame % 34 === 0) {
        const from = follower.target;
        follower.extend([from, { x: 0, y: from.y + 0.7 }]);
      }
      const now = follower.advance(FRAME_MS);
      biggest = Math.max(biggest, Math.hypot(now.x - previous.x, now.y - previous.y));
      previous = now;
    }
    // 0.7 m in one frame would be a hop. At 60 fps a smooth walk moves a few cm.
    expect(biggest).toBeLessThan(0.06);
  });

  /** Frame-by-frame speeds of a steady walk, after the dot has got going. */
  function steadyWalkSpeeds(): { speeds: number[]; backlogs: number[] } {
    const follower = new PathFollower({ x: 0, y: 0 });
    const speeds: number[] = [];
    const backlogs: number[] = [];
    let previous = follower.position;
    for (let frame = 0; frame < 600; frame += 1) {
      if (frame % 34 === 0) {
        const from = follower.target;
        follower.extend([from, { x: 0, y: from.y + 0.7 }]);
      }
      const now = follower.advance(FRAME_MS);
      if (frame >= 120) {
        speeds.push(Math.hypot(now.x - previous.x, now.y - previous.y) / (FRAME_MS / 1000));
        backlogs.push(follower.backlogM);
      }
      previous = now;
    }
    return { speeds, backlogs };
  }

  it("keeps up with a steady walk, about a step behind", () => {
    const { backlogs } = steadyWalkSpeeds();
    const mean = backlogs.reduce((sum, value) => sum + value, 0) / backlogs.length;
    expect(mean).toBeLessThan(0.9);
  });

  it("walks at a steady speed instead of lurching at every step", () => {
    const { speeds } = steadyWalkSpeeds();
    const fastest = Math.max(...speeds);
    const slowest = Math.min(...speeds);
    // The shopper walks 0.7 m every 567 ms, 1.24 m/s. An exponential chase swings
    // between 2.4 and 0.5 m/s on this walk; the spring stays near the real pace.
    expect(fastest).toBeLessThan(1.24 * 1.6);
    expect(slowest).toBeGreaterThan(1.24 * 0.5);
  });

  it("covers a correction from Found it in about a third of a second", () => {
    const follower = new PathFollower({ x: 0, y: 0 });
    follower.extend([{ x: 0, y: 0 }, { x: 0, y: 6 }, { x: 7, y: 6 }], { isFix: true });
    // 13 m: the walk from one aisle to the shelf of the item just found.
    let frames = 0;
    while (follower.backlogM > 0.05 && frames < 600) {
      follower.advance(FRAME_MS);
      frames += 1;
    }
    expect(frames * FRAME_MS).toBeLessThan(450);
  });

  it("walks a long catch-up that isn't a fix at a person's pace, never darting", () => {
    const follower = new PathFollower({ x: 0, y: 0 });
    // 4 m at once: the matcher putting the dot back on the route, not Found it.
    follower.extend([{ x: 0, y: 0 }, { x: 0, y: 1.5 }, { x: 2.5, y: 1.5 }]);
    let previous = follower.position;
    let fastest = 0;
    for (let frame = 0; frame < 240; frame += 1) {
      const now = follower.advance(FRAME_MS);
      fastest = Math.max(fastest, Math.hypot(now.x - previous.x, now.y - previous.y) / (FRAME_MS / 1000));
      previous = now;
    }
    expect(fastest).toBeLessThanOrEqual(2.2 + 1e-9);
    expect(follower.position).toEqual({ x: 2.5, y: 1.5 });
  });

  it("spreads the three steps the detector confirms at once over walking pace", () => {
    const follower = new PathFollower({ x: 0, y: 0 });
    follower.extend([{ x: 0, y: 0 }, { x: 0, y: 2.1 }]);
    let previous = follower.position;
    let fastest = 0;
    for (let frame = 0; frame < 180; frame += 1) {
      const now = follower.advance(FRAME_MS);
      fastest = Math.max(fastest, Math.hypot(now.x - previous.x, now.y - previous.y) / (FRAME_MS / 1000));
      previous = now;
    }
    expect(fastest).toBeLessThanOrEqual(2.2);
    expect(follower.position).toEqual({ x: 0, y: 2.1 });
  });

  it("never runs past where the shopper is", () => {
    const follower = new PathFollower({ x: 0, y: 0 });
    follower.extend([{ x: 0, y: 0 }, { x: 0, y: 1 }]);
    for (let frame = 0; frame < 120; frame += 1) {
      expect(follower.advance(FRAME_MS).y).toBeLessThanOrEqual(1);
    }
  });

  it("comes to rest exactly where the shopper stopped", () => {
    const follower = new PathFollower({ x: 0, y: 0 });
    follower.extend([{ x: 0, y: 0 }, { x: 2, y: 0 }]);
    for (let frame = 0; frame < 180; frame += 1) {
      follower.advance(FRAME_MS);
    }
    expect(follower.position).toEqual({ x: 2, y: 0 });
    expect(follower.backlogM).toBe(0);
  });

  it("can jump straight to a position", () => {
    const follower = new PathFollower({ x: 0, y: 0 });
    follower.extend([{ x: 0, y: 0 }, { x: 5, y: 0 }]);
    follower.jumpTo({ x: 1, y: 1 });
    expect(follower.position).toEqual({ x: 1, y: 1 });
    expect(follower.backlogM).toBe(0);
  });
});

describe("easeHeading", () => {
  it("turns the short way across north", () => {
    const eased = easeHeading(350, 10, FRAME_MS);
    expect(eased > 350 || eased < 10).toBe(true);
  });

  it("settles on the target", () => {
    let heading = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      heading = easeHeading(heading, 90, FRAME_MS);
    }
    expect(heading).toBeCloseTo(90, 3);
  });
});

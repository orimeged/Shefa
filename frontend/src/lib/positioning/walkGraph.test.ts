import { describe, expect, it } from "vitest";

import type { WalkableEdge, WalkableNode } from "./walkGraph";
import { WalkGraph } from "./walkGraph";

const node = (id: string, x: number, y: number): WalkableNode => ({ id, x, y });

// A ladder: two aisles joined at the front and the back.
//   b1 --- b2
//   |      |
//   f1 --- f2
const f1 = node("f1", 0, 0);
const f2 = node("f2", 4, 0);
const b1 = node("b1", 0, 10);
const b2 = node("b2", 4, 10);
const edges: WalkableEdge[] = [
  { from: f1, to: f2 },
  { from: f1, to: b1 },
  { from: f2, to: b2 },
  { from: b1, to: b2 },
];
const graph = new WalkGraph(edges);

describe("pathBetween", () => {
  it("is a straight line on one edge", () => {
    expect(graph.pathBetween({ edge: 1, along: 2 }, { edge: 1, along: 7 })).toEqual([
      { x: 0, y: 2 },
      { x: 0, y: 7 },
    ]);
  });

  it("goes round the corner it has to turn", () => {
    expect(graph.pathBetween({ edge: 1, along: 2 }, { edge: 0, along: 3 })).toEqual([
      { x: 0, y: 2 },
      f1,
      { x: 3, y: 0 },
    ]);
  });

  it("takes the shorter way round the shelf, not across it", () => {
    // From near the front of one aisle to near the front of the other: via the front.
    const path = graph.pathBetween({ edge: 1, along: 1 }, { edge: 2, along: 1 });
    expect(path).toEqual([{ x: 0, y: 1 }, f1, f2, { x: 4, y: 1 }]);
  });

  it("matches the walking distance", () => {
    const from = { edge: 1, along: 8 };
    const to = { edge: 2, along: 9 };
    const path = graph.pathBetween(from, to);
    const walked = path.slice(1).reduce((sum, point, index) => {
      const previous = path[index]!;
      return sum + Math.hypot(point.x - previous.x, point.y - previous.y);
    }, 0);
    expect(walked).toBeCloseTo(graph.pathLength(from, to), 9);
  });
});

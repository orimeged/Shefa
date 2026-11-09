import { describe, expect, it } from "vitest";

import type { WalkableEdge, WalkableNode } from "./walkGraph";
import { WalkGraph } from "./walkGraph";
import { createGrid, makeTile, paint } from "../admin/floorGrid";
import { cellCentre, frameOf } from "../floorPlanMap";
import { gridWalkableEdges } from "./gridWalking";
import { seededRandom } from "./simulatedWalk";

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

describe("a drawn plan's graph, thousands of tiles", () => {
  // The editor's largest plan: 60 × 60 tiles, every fourth column a shelf with gaps.
  const big = (() => {
    let grid = createGrid(60, 60);
    const shelves = [];
    for (let col = 3; col < 60; col += 4) {
      for (let row = 2; row < 58; row++) if (row % 15 !== 0) shelves.push({ row, col });
    }
    grid = paint(grid, shelves, makeTile("shelf"));
    return grid;
  })();
  const frame = frameOf(big, 0.8);
  const edges = gridWalkableEdges(big, frame);
  const graph = new WalkGraph(edges);

  it("finds the nearest spot exactly as checking every edge would", () => {
    const random = seededRandom(11);
    const everyEdge = (point: { x: number; y: number }) => {
      let best = { edge: 0, along: 0 };
      let bestDistance = Number.POSITIVE_INFINITY;
      edges.forEach((edge, index) => {
        const length = Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y);
        const candidate = graph.project(point, { edge: index, fromAlong: 0, toAlong: length });
        const spot = graph.pointAt(candidate);
        const distance = Math.hypot(spot.x - point.x, spot.y - point.y);
        if (distance < bestDistance - 1e-12) {
          best = candidate;
          bestDistance = distance;
        }
      });
      return graph.pointAt(best);
    };
    for (let i = 0; i < 300; i++) {
      // Inside the plan and a little beyond it.
      const point = { x: -3 + random() * 54, y: -3 + random() * 54 };
      const indexed = graph.pointAt(graph.nearest(point));
      const brute = everyEdge(point);
      expect(Math.hypot(indexed.x - point.x, indexed.y - point.y)).toBeCloseTo(
        Math.hypot(brute.x - point.x, brute.y - point.y),
        9,
      );
    }
  });

  it("answers a walk across the store quickly enough to follow a dot", () => {
    const from = graph.nearest(cellCentre({ row: 1, col: 1 }, frame));
    const to = graph.nearest(cellCentre({ row: 58, col: 58 }, frame));
    // The fastest of a few rounds: a busy machine running the other test files
    // in parallel slows the clock, not the search.
    let each = Infinity;
    for (let round = 0; round < 5; round++) {
      const started = performance.now();
      for (let i = 0; i < 20; i++) {
        graph.pathBetween(from, to);
        graph.pathLength(from, to);
        graph.nearest({ x: 20 + i, y: 30 });
      }
      each = Math.min(each, (performance.now() - started) / 20);
    }
    expect(each).toBeLessThan(50);
    // And the walk goes round the shelves, never through them.
    expect(graph.pathLength(from, to)).toBeGreaterThan(Math.hypot(57 * 0.8, 57 * 0.8));
  });

  it("names the node nearest a spot, for re-planning from where the shopper stands", () => {
    const spot = cellCentre({ row: 30, col: 10 }, frame);
    expect(graph.nearestNodeId({ x: spot.x + 0.1, y: spot.y - 0.1 })).toBe("cell:30:10");
  });
});

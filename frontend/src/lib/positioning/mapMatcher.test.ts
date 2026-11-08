import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { StoreMap } from "../../api/types";
import { MapMatcher } from "./mapMatcher";
import { storeObstacles } from "./obstacles";
import { toWalkableEdges, WalkGraph } from "./walkGraph";

const store = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../backend/app/data/demo_store.json"), "utf-8"),
) as StoreMap;

const graph = new WalkGraph(toWalkableEdges(store));
const obstacles = storeObstacles(store);
const nodes = new Map(store.nodes.map((node) => [node.id, node]));
const at = (id: string) => nodes.get(id)!;

const NORTH = 0;
const EAST = 90;
const SOUTH = 180;
const WEST = 270;
const STEP = 0.7;

function walk(matcher: MapMatcher, bearing: number, steps: number): void {
  for (let index = 0; index < steps; index += 1) {
    matcher.step(bearing, STEP);
  }
}

describe("WalkGraph", () => {
  it("finds the closest spot on the paths", () => {
    expect(graph.pointAt(graph.nearest({ x: 6.8, y: 12 }))).toEqual({ x: 6, y: 12 });
  });

  it("reaches through a junction within budget", () => {
    const start = graph.nearest({ x: 6, y: 5 });
    const edges = graph.reachable(start, 2).map((span) => span.edge);
    const crossAisle = graph.nearest({ x: 7, y: 4 }).edge;

    expect(edges).toContain(crossAisle);
  });

  it("does not reach the next aisle from the middle of this one", () => {
    const start = graph.nearest({ x: 6, y: 13 });
    const spans = graph.reachable(start, 6);
    const nextAisle = graph.nearest({ x: 11, y: 13 }).edge;

    expect(spans.map((span) => span.edge)).not.toContain(nextAisle);
  });

  it("names the way out of the entrance", () => {
    expect(graph.bearingOutOf(at("entrance"))).toBe(NORTH);
  });
});

describe.each([
  ["with no shelves known", undefined],
  ["with shelves known", obstacles],
])("MapMatcher %s", (_name, field) => {
  it("starts on the given node", () => {
    expect(new MapMatcher(graph, at("entrance"), field).point).toEqual({ x: 2, y: 0 });
  });

  it("walks along an aisle", () => {
    const matcher = new MapMatcher(graph, at("a1_s1"), field);

    walk(matcher, NORTH, 5);

    expect(matcher.point.x).toBe(6);
    expect(matcher.point.y).toBeCloseTo(8 + 5 * STEP);
  });

  it("stays on the aisle when heading is off by a few degrees", () => {
    const matcher = new MapMatcher(graph, at("a1_s1"), field);

    walk(matcher, NORTH + 12, 10);

    expect(matcher.point.x).toBe(6);
    expect(matcher.point.y).toBeGreaterThan(8 + 10 * STEP * 0.85);
  });

  it("never crosses a shelf into the next aisle, whatever the heading says", () => {
    const matcher = new MapMatcher(graph, at("a2_s2"), field);

    walk(matcher, EAST, 30);

    expect(matcher.point.x).toBe(11);
  });

  it("does not move a shopper who faces the shelf and shuffles", () => {
    const matcher = new MapMatcher(graph, at("a3_s2"), field);

    walk(matcher, WEST, 3);

    expect(matcher.point).toEqual({ x: 16, y: 13 });
  });

  it("turns into an aisle at a junction", () => {
    const matcher = new MapMatcher(graph, { x: 15.3, y: 4 }, field);

    walk(matcher, EAST, 1);
    walk(matcher, NORTH, 5);

    expect(matcher.point.x).toBe(16);
    expect(matcher.point.y).toBeGreaterThan(6);
  });

  it("catches up with a turn it reached late", () => {
    const matcher = new MapMatcher(graph, { x: 14, y: 4 }, field);

    walk(matcher, NORTH, 4);

    expect(matcher.point.x).toBe(16);
    expect(matcher.point.y).toBeGreaterThan(4);
  });

  it("walks back to a turn it overshot", () => {
    const matcher = new MapMatcher(graph, { x: 18, y: 4 }, field);

    walk(matcher, NORTH, 4);

    expect(matcher.point.x).toBe(16);
    expect(matcher.point.y).toBeGreaterThan(4);
  });

  it("takes the nearer of two junctions", () => {
    const matcher = new MapMatcher(graph, { x: 12.5, y: 4 }, field);

    walk(matcher, NORTH, 8);

    expect(matcher.point.x).toBe(11);
  });

  it("stays in the aisle when the phone keeps pointing at a shelf", () => {
    const matcher = new MapMatcher(graph, { x: 11, y: 10.5 }, field);

    walk(matcher, EAST, 20);

    expect(matcher.point).toEqual({ x: 11, y: 10.5 });
  });

  it("stops at the end of a path", () => {
    const matcher = new MapMatcher(graph, at("a1_s3"), field);

    walk(matcher, SOUTH, 3);
    expect(matcher.point.x).toBe(6);

    const entrance = new MapMatcher(graph, at("entrance"), field);
    walk(entrance, SOUTH, 5);
    expect(entrance.point.x).toBe(2);
    // The entrance is on the outer wall, which the track keeps just clear of.
    expect(entrance.point.y).toBeLessThanOrEqual(0.05);
  });

  it("jumps to an anchor and carries on from there", () => {
    const matcher = new MapMatcher(graph, at("entrance"), field);

    matcher.anchorTo(at("a5_s2"));
    expect(matcher.point).toEqual({ x: 26, y: 13 });

    walk(matcher, SOUTH, 2);
    expect(matcher.point.x).toBe(26);
    expect(matcher.point.y).toBeCloseTo(13 - 2 * STEP);
  });

  it("gets out of an aisle when the shopper turned before the dot reached the end", () => {
    const matcher = new MapMatcher(graph, { x: 6, y: 19 }, field);

    walk(matcher, EAST, 12);

    expect(matcher.point.y).toBe(22);
    expect(matcher.point.x).toBeGreaterThan(6);
  });
});

describe("MapMatcher", () => {
  it("finds a turn beyond the first search as the steps pile up", () => {
    const corner = { id: "corner", x: 10, y: 0 };
    const corridor = new WalkGraph([
      { from: { id: "start", x: 0, y: 0 }, to: corner },
      { from: corner, to: { id: "end", x: 10, y: 10 } },
    ]);
    const matcher = new MapMatcher(corridor, { x: 6, y: 0 });

    walk(matcher, NORTH, 8);

    expect(matcher.point.x).toBe(10);
    expect(matcher.point.y).toBeGreaterThan(0);
  });
});

describe("MapMatcher against a shelf", () => {
  it("keeps climbing an aisle when the track is caught on the shelf's end", () => {
    // The dot overshot the turn into aisle 2, so the track runs into the next shelf.
    const matcher = new MapMatcher(graph, { x: 13, y: 4 }, obstacles);

    walk(matcher, NORTH, 12);

    expect(matcher.point.x).toBe(11);
    expect(matcher.point.y).toBeGreaterThan(8);
  });

  it("doesn't cross a shelf at any heading", () => {
    for (let bearing = 0; bearing < 360; bearing += 15) {
      const matcher = new MapMatcher(graph, at("a3_s2"), obstacles);

      walk(matcher, bearing, 12);

      expect(Math.abs(matcher.point.x - 16) < 0.01 || !obstacles.contains(matcher.point)).toBe(true);
    }
  });

  it("slides along a shelf it only grazes", () => {
    const matcher = new MapMatcher(graph, at("a1_s1"), obstacles);

    walk(matcher, NORTH + 20, 8);

    expect(matcher.point.x).toBe(6);
    expect(matcher.point.y).toBeGreaterThan(8 + 8 * STEP * 0.8);
  });
});

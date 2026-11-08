import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { StoreMap } from "../../api/types";
import { ObstacleField, storeObstacles } from "./obstacles";

const store = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../backend/app/data/demo_store.json"), "utf-8"),
) as StoreMap;

const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

const shelf = square(4, 0, 2);
const field = new ObstacleField([shelf], square(0, -10, 20));

describe("contains", () => {
  it("knows a point inside a shelf", () => {
    expect(field.contains({ x: 5, y: 1 })).toBe(true);
  });

  it("knows an aisle is walkable", () => {
    expect(field.contains({ x: 3, y: 1 })).toBe(false);
  });

  it("treats anywhere outside the floor as blocked", () => {
    expect(field.contains({ x: -1, y: 0 })).toBe(true);
    expect(field.contains({ x: 25, y: 0 })).toBe(true);
  });

  it("handles a shape that isn't a rectangle", () => {
    const corner = new ObstacleField([
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 2, y: 4 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
      ],
    ]);

    expect(corner.contains({ x: 1, y: 1 })).toBe(true);
    expect(corner.contains({ x: 3, y: 3 })).toBe(true);
    expect(corner.contains({ x: 1, y: 3 })).toBe(false);
  });
});

describe("firstContact", () => {
  it("finds the wall in the way", () => {
    const contact = field.firstContact({ x: 3, y: 1 }, { x: 5, y: 1 });

    expect(contact?.share).toBeCloseTo(0.5);
  });

  it("finds nothing on a clear path", () => {
    expect(field.firstContact({ x: 1, y: 1 }, { x: 3, y: 1 })).toBeNull();
  });

  it("doesn't catch a move that stops short", () => {
    expect(field.firstContact({ x: 3, y: 1 }, { x: 3.9, y: 1 })).toBeNull();
  });

  it("picks the nearest of two walls", () => {
    const double = new ObstacleField([square(2, 0, 1), square(5, 0, 1)]);

    expect(double.firstContact({ x: 0, y: 0.5 }, { x: 10, y: 0.5 })?.share).toBeCloseTo(0.2);
  });

  it("lets a position inside a shelf walk out", () => {
    expect(field.firstContact({ x: 5, y: 1 }, { x: 3, y: 1 })).toBeNull();
  });

  it("can't slip through a corner", () => {
    expect(field.firstContact({ x: 3, y: -1 }, { x: 5, y: 1 })).not.toBeNull();
  });
});

describe("constrain", () => {
  it("leaves a clear move alone", () => {
    const { point, blockedM } = field.constrain({ x: 1, y: 1 }, { x: 2, y: 1 });

    expect(point).toEqual({ x: 2, y: 1 });
    expect(blockedM).toBe(0);
  });

  it("stops at a wall hit head on, and says how much was lost", () => {
    const { point, blockedM } = field.constrain({ x: 3.5, y: 1 }, { x: 4.5, y: 1 });

    expect(point.x).toBeLessThan(4);
    expect(point.x).toBeGreaterThan(3.9);
    expect(point.y).toBeCloseTo(1);
    expect(blockedM).toBeCloseTo(0.5);
  });

  it("slides along a wall hit at an angle", () => {
    const { point, blockedM } = field.constrain({ x: 3.9, y: 0.5 }, { x: 4.9, y: 1.5 });

    expect(point.x).toBeLessThan(4);
    expect(point.y).toBeGreaterThan(1.3);
    expect(point.y).toBeLessThan(1.6);
    expect(blockedM).toBeGreaterThan(0);
  });

  it("never ends up inside", () => {
    for (let angle = 0; angle < 360; angle += 7) {
      const radians = (angle * Math.PI) / 180;
      const from = { x: 3.95, y: 1 };
      const { point } = field.constrain(from, {
        x: from.x + Math.cos(radians) * 3,
        y: from.y + Math.sin(radians) * 3,
      });

      expect(field.contains(point)).toBe(false);
    }
  });

  it("repeats from a wall without getting stuck on it", () => {
    let position = { x: 3.5, y: 0.2 };

    for (let step = 0; step < 6; step += 1) {
      position = field.constrain(position, { x: position.x + 0.5, y: position.y + 0.5 }).point;
    }

    expect(position.y).toBeGreaterThan(2);
    expect(field.contains(position)).toBe(false);
  });

  it("slides into a corner and stops", () => {
    const room = new ObstacleField([], square(0, 0, 4));

    const { point } = room.constrain({ x: 3.5, y: 3.5 }, { x: 5, y: 5 });

    expect(room.contains(point)).toBe(false);
    expect(point.x).toBeLessThan(4);
    expect(point.y).toBeLessThan(4);
  });

  it("stays on the floor", () => {
    const { point } = field.constrain({ x: 0.5, y: 0 }, { x: -3, y: 0 });

    expect(point.x).toBeGreaterThan(0);
  });
});

describe("the demo store", () => {
  const obstacles = storeObstacles(store);
  const nodes = new Map(store.nodes.map((node) => [node.id, node]));

  it("puts every node on open floor", () => {
    for (const node of store.nodes) {
      if (node.type !== "entrance" && node.type !== "checkout") {
        expect(obstacles.contains(node), node.id).toBe(false);
      }
    }
  });

  it("leaves every walkway clear", () => {
    for (const edge of store.edges) {
      const from = nodes.get(edge.from_node)!;
      const to = nodes.get(edge.to_node)!;

      expect(obstacles.constrain(from, to).blockedM, `${edge.from_node}-${edge.to_node}`).toBe(0);
    }
  });

  it("has a shelf between neighbouring aisles", () => {
    const { blockedM } = obstacles.constrain({ x: 6, y: 13 }, { x: 11, y: 13 });

    expect(blockedM).toBeGreaterThan(3);
  });

  it("agrees with where the map draws the shelves", () => {
    expect(obstacles.contains({ x: 8.5, y: 13 })).toBe(true);
    expect(obstacles.contains({ x: 8.5, y: 22 })).toBe(false);
    expect(obstacles.contains({ x: 8.5, y: 4 })).toBe(false);
  });
});

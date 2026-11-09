import { describe, expect, it } from "vitest";

import type { FloorGrid } from "../admin/floorGrid";
import { cellsBetween, createGrid, makeTile, paint } from "../admin/floorGrid";
import { cellCentre, cellId, frameOf, tileAt } from "../floorPlanMap";
import type { Point } from "../mapGeometry";
import { vectorAlong } from "./angles";
import { DEFAULT_STEP_LENGTH_M, PositioningEngine } from "./engine";
import { entranceBearing, gridObstacles, gridWalkableEdges, gridWalkingMap, isOpen } from "./gridWalking";
import { MapMatcher } from "./mapMatcher";
import { seededRandom } from "./simulatedWalk";
import { edgeKey, WalkGraph } from "./walkGraph";

/**
 * 8 rows of 12: a shelf two tiles deep down the middle (cols 5–6, rows 2–5),
 * a wall stub at the top right, the entrance on the bottom row.
 */
function store(): FloorGrid {
  let grid = createGrid(8, 12);
  const shelf = [];
  for (let row = 2; row <= 5; row++) shelf.push({ row, col: 5 }, { row, col: 6 });
  grid = paint(grid, shelf, makeTile("shelf", "מוצרי חלב"));
  grid = paint(grid, cellsBetween({ row: 0, col: 9 }, { row: 1, col: 9 }), makeTile("wall"));
  grid = paint(grid, [{ row: 7, col: 1 }], makeTile("entrance"));
  return paint(grid, [{ row: 6, col: 10 }], makeTile("checkout"));
}

const GRID = store();
const FRAME = frameOf(GRID, 0.8);
const EDGES = gridWalkableEdges(GRID, FRAME);
const byKey = new Map(EDGES.map((edge) => [edgeKey(edge.from.id, edge.to.id), edge]));
const edge = (a: [number, number], b: [number, number]) => byKey.get(edgeKey(cellId(...a), cellId(...b)));

/** Points along every edge, as the dot could stand anywhere on one. */
function pointsAlong(from: Point, to: Point, count = 20): Point[] {
  return Array.from({ length: count + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / count,
    y: from.y + ((to.y - from.y) * i) / count,
  }));
}

describe("the walkways", () => {
  it("join the middles of open tiles, in metres", () => {
    const step = edge([7, 1], [6, 1])!;
    expect(step.from).toMatchObject({ id: "cell:6:1", ...cellCentre({ row: 6, col: 1 }, FRAME) });
    expect(Math.hypot(step.to.x - step.from.x, step.to.y - step.from.y)).toBeCloseTo(0.8);
  });

  it("never touch a shelf, a wall or a till: every point of every walkway is open floor", () => {
    for (const { from, to } of EDGES) {
      for (const point of pointsAlong(from, to)) {
        const { row, col } = tileAt(point, FRAME);
        // A point exactly on a tile border belongs to both; nudge it inwards to read it.
        const inside = tileAt({ x: point.x + (to.x - from.x) * 1e-6, y: point.y + (to.y - from.y) * 1e-6 }, FRAME);
        expect(isOpen(GRID, row, col) || isOpen(GRID, inside.row, inside.col)).toBe(true);
      }
    }
    expect(EDGES.some((e) => e.from.id === "cell:3:5" || e.to.id === "cell:3:5")).toBe(false);
  });

  it("go diagonally only where both tiles beside the diagonal are open", () => {
    // From (1,4) to (2,5)? (2,5) is shelf. From (1,4) to (2,3): open, and so are (1,3) and (2,4).
    expect(edge([1, 4], [2, 3])).toBeDefined();
    // (1,7)–(2,8): (2,7)? no, (2,6) is shelf but (2,7) open and (1,8) open: allowed.
    expect(edge([1, 7], [2, 8])).toBeDefined();
    // (1,6)–(2,7) would squeeze past the shelf corner at (2,6).
    expect(edge([1, 6], [2, 7])).toBeUndefined();
    // Past the wall stub: (1,8)–(2,9)? (1,9) is wall.
    expect(edge([1, 8], [2, 9])).toBeUndefined();
  });

  it("are each listed once", () => {
    expect(byKey.size).toBe(EDGES.length);
  });

  it("guide the gyroscope beside a shelf and down an aisle, not across open floor", () => {
    // Straight down beside the shelf, and down the middle lane two tiles from it.
    expect(edge([3, 4], [4, 4])!.guides).toBe(true);
    expect(edge([3, 3], [4, 3])!.guides).toBe(true);
    // Diagonals never do: nobody walks a diagonal along a shelf.
    expect(edge([1, 4], [2, 3])!.guides).toBe(false);
  });

  it("call open floor far from anything open floor", () => {
    let wide = createGrid(20, 20);
    wide = paint(wide, [{ row: 19, col: 0 }], makeTile("entrance"));
    const middle = gridWalkableEdges(wide, frameOf(wide, 0.5)).find(
      (e) => e.from.id === "cell:9:9" && e.to.id === "cell:9:10",
    );
    // With 0.5 m tiles, 2.4 m is five tiles; the plan's edge is nine away.
    expect(middle?.guides).toBe(false);
  });
});

describe("the obstacles", () => {
  const field = gridObstacles(GRID, FRAME);

  it("hold every tile that isn't open floor, and none that is", () => {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 12; col++) {
        expect(field.contains(cellCentre({ row, col }, FRAME))).toBe(!isOpen(GRID, row, col));
      }
    }
  });

  it("keep the track inside the plan's edge", () => {
    expect(field.contains({ x: -0.2, y: 1 })).toBe(true);
    expect(field.contains({ x: 12 * 0.8 + 0.1, y: 1 })).toBe(true);
  });

  it("slide a step that runs into a shelf along it", () => {
    const beside = cellCentre({ row: 3, col: 4 }, FRAME);
    const into = { x: beside.x + 1.2, y: beside.y };
    const { point, blockedM } = field.constrain(beside, into);
    expect(blockedM).toBeGreaterThan(0);
    expect(tileAt(point, FRAME).col).toBe(4);
  });
});

describe("the way in", () => {
  it("is straight away from whichever edge of the plan the entrance stands on", () => {
    expect(entranceBearing(GRID, 7, 1)).toBe(0);
    expect(entranceBearing(GRID, 0, 3)).toBe(180);
    expect(entranceBearing(GRID, 4, 0)).toBe(90);
    expect(entranceBearing(GRID, 4, 11)).toBe(270);
  });

  it("is along the longest straight run for an entrance inside the plan", () => {
    // From (3,8): up 1 to the wall stub? (2,8)…(0,8) are open: 3; down to row 7: 4; left (3,7) then shelf: 1; right 3.
    expect(entranceBearing(GRID, 3, 8)).toBe(180);
  });

  it("starts live location in the middle of the entrance tile", () => {
    const walking = gridWalkingMap(GRID, FRAME)!;
    expect(walking.start).toEqual(cellCentre({ row: 7, col: 1 }, FRAME));
    expect(walking.initialBearing).toBe(0);
    expect(walking.tuning).toBeDefined();
  });

  it("isn't there without an entrance", () => {
    expect(gridWalkingMap(createGrid(5, 5), frameOf(createGrid(5, 5), 1))).toBeNull();
  });
});

describe("the dot on a drawn plan", () => {
  it("never leaves open floor, whatever the sensors say", () => {
    const random = seededRandom(7);
    // A random store: a quarter of the tiles blocked, a door at the bottom left.
    let grid = createGrid(16, 16);
    const blocked = [];
    for (let row = 0; row < 16; row++) {
      for (let col = 0; col < 16; col++) if (random() < 0.25) blocked.push({ row, col });
    }
    grid = paint(grid, blocked, makeTile("shelf"));
    grid = paint(grid, [{ row: 15, col: 0 }, { row: 14, col: 0 }, { row: 15, col: 1 }], makeTile("aisle"));
    grid = paint(grid, [{ row: 15, col: 0 }], makeTile("entrance"));
    const frame = frameOf(grid, 0.8);
    const walking = gridWalkingMap(grid, frame)!;
    const graph = new WalkGraph(walking.edges);
    const matcher = new MapMatcher(graph, walking.start, walking.obstacles, walking.tuning);

    for (let step = 0; step < 4000; step++) {
      // Wild headings, now and then a big turn, steps from short to long.
      matcher.step(random() * 360, 0.3 + random() * 0.7);
      const { row, col } = tileAt(matcher.point, frame);
      expect(isOpen(grid, row, col)).toBe(true);
    }
  });

  it("keeps to the route it was given, and leaves it when the walk clearly does", () => {
    // A 3-wide corridor along the bottom: rows 5–7, a wall above. The route runs down its middle row.
    let grid = createGrid(8, 20);
    const wall = [];
    for (let col = 0; col < 20; col++) for (let row = 0; row <= 4; row++) wall.push({ row, col });
    grid = paint(grid, wall, makeTile("wall"));
    grid = paint(grid, [{ row: 6, col: 0 }], makeTile("entrance"));
    const frame = frameOf(grid, 0.8);
    const walking = gridWalkingMap(grid, frame)!;
    const graph = new WalkGraph(walking.edges);
    const route = new Set<string>();
    for (let col = 1; col < 20; col++) route.add(edgeKey(cellId(6, col - 1), cellId(6, col)));

    const along = (offRoute: boolean) => {
      const matcher = new MapMatcher(graph, walking.start, walking.obstacles, walking.tuning);
      if (offRoute) matcher.followRoute(route);
      // Walking east with the heading 10 degrees towards the bottom wall.
      for (let step = 0; step < 14; step++) matcher.step(100, 0.7);
      return tileAt(matcher.point, frame).row;
    };
    expect(along(true)).toBe(6);
  });

  it("follows a shopper who turns off the route into another aisle", () => {
    // A corridor along the bottom (rows 9–11) and a side aisle up from it (cols 9–10, rows 2–8).
    let grid = createGrid(12, 20);
    const wall = [];
    for (let row = 0; row <= 8; row++) {
      for (let col = 0; col < 20; col++) if (row < 2 || (col !== 9 && col !== 10)) wall.push({ row, col });
    }
    grid = paint(grid, wall, makeTile("wall"));
    grid = paint(grid, [{ row: 10, col: 0 }], makeTile("entrance"));
    const frame = frameOf(grid, 0.8);
    const walking = gridWalkingMap(grid, frame)!;
    const matcher = new MapMatcher(new WalkGraph(walking.edges), walking.start, walking.obstacles, walking.tuning);
    // The route it was shown carries straight on along the corridor.
    const route = new Set<string>();
    for (let col = 1; col < 20; col++) route.add(edgeKey(cellId(10, col - 1), cellId(10, col)));
    matcher.followRoute(route);

    for (let step = 0; step < 11; step++) matcher.step(90, 0.7);
    for (let step = 0; step < 7; step++) matcher.step(0, 0.7);
    const { row, col } = tileAt(matcher.point, frame);
    expect(row).toBeLessThanOrEqual(6);
    expect([9, 10]).toContain(col);
  });

  it("is placed by the engine from the entrance, facing in", () => {
    const walking = gridWalkingMap(GRID, FRAME)!;
    const engine = new PositioningEngine(walking.start, walking.edges, DEFAULT_STEP_LENGTH_M, walking.obstacles, {
      initialBearing: walking.initialBearing,
      tuning: walking.tuning,
    });
    expect(engine.snapshot).toMatchObject({ ...cellCentre({ row: 7, col: 1 }, FRAME), heading: 0 });
    // A known spot moves it there, and a route can be followed from its node ids.
    engine.anchorTo(cellCentre({ row: 3, col: 3 }, FRAME));
    expect(tileAt(engine.snapshot, FRAME)).toEqual({ row: 3, col: 3 });
    engine.followRoute([[cellId(3, 3), cellId(2, 3), cellId(1, 3)]]);
    expect(vectorAlong(engine.snapshot.heading, 1).y).toBeCloseTo(1);
  });
});

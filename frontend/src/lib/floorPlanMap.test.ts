import { afterEach, describe, expect, it, vi } from "vitest";

import type { GridRoute, SavedFloorPlan } from "../api/types";
import { routePlanner } from "../hooks/useShopperStore";
import { cellsBetween, createGrid, makeTile, paint, toPayload } from "./admin/floorGrid";
import {
  buildFloorLayout,
  cellCentre,
  cellId,
  frameOf,
  metresToSvg,
  parseCellId,
  readFloorMap,
  routeFromGrid,
  tileAt,
} from "./floorPlanMap";

/** A 10 × 6 store: a dairy run, a coffee shelf down a column, a wall, a door and tills. */
function store() {
  let grid = createGrid(6, 10);
  grid = paint(grid, cellsBetween({ row: 1, col: 2 }, { row: 1, col: 6 }), makeTile("shelf", "מוצרי חלב"));
  grid = paint(grid, cellsBetween({ row: 2, col: 8 }, { row: 4, col: 8 }), makeTile("shelf", "קפה"));
  grid = paint(grid, cellsBetween({ row: 0, col: 0 }, { row: 0, col: 9 }), makeTile("wall"));
  grid = paint(grid, [{ row: 5, col: 0 }], makeTile("entrance"));
  grid = paint(grid, cellsBetween({ row: 5, col: 6 }, { row: 5, col: 7 }), makeTile("checkout"));
  return grid;
}

function saved(overrides: Partial<SavedFloorPlan> = {}, cellSize = 0.5): SavedFloorPlan {
  return {
    store_id: "demo",
    floor_plan: toPayload(store(), cellSize),
    updated_at: "2026-11-08T12:00:00Z",
    check: { routable: true, problems: [], departments: [] },
    placements: { dairy: "מוצרי חלב" },
    ...overrides,
  };
}

const ROUTE: GridRoute = {
  store_id: "demo",
  start: { row: 5, col: 0 },
  end: { row: 4, col: 6 },
  total_length_m: 4.5,
  stops: [
    {
      seq: 0,
      category_id: "dairy",
      category_name: "מוצרי חלב",
      category_name_en: "Dairy",
      department: "מוצרי חלב",
      row: 2,
      col: 4,
      leg_index: 0,
    },
  ],
  legs: [
    { length_m: 2.5, cells: [{ row: 5, col: 0 }, { row: 4, col: 1 }, { row: 3, col: 2 }, { row: 2, col: 3 }, { row: 2, col: 4 }] },
    { length_m: 2, cells: [{ row: 2, col: 4 }, { row: 3, col: 5 }, { row: 4, col: 6 }] },
  ],
  unplaced_category_ids: ["frozen"],
};

describe("cell ids", () => {
  it("name a tile the way analytics do, and read back", () => {
    expect(cellId(3, 12)).toBe("cell:3:12");
    expect(parseCellId("cell:3:12")).toEqual({ row: 3, col: 12 });
  });

  it("aren't the graph's node ids", () => {
    expect(parseCellId("a1_s1")).toBeNull();
    expect(parseCellId("cell:3")).toBeNull();
    expect(parseCellId("cell:-1:2")).toBeNull();
  });
});

/** The test store: 6 rows of 10 tiles, half a metre each, so 5 m across and 3 m deep. */
const FRAME = frameOf(store(), 0.5);

describe("the plan's three frames", () => {
  it("puts a tile's middle in metres from the bottom-left, y up", () => {
    expect(FRAME).toEqual({ rows: 6, cols: 10, cellSizeM: 0.5 });
    // Row 5 is the bottom row, so its middle is a quarter metre up.
    expect(cellCentre({ row: 5, col: 0 }, FRAME)).toEqual({ x: 0.25, y: 0.25 });
    expect(cellCentre({ row: 0, col: 9 }, FRAME)).toEqual({ x: 4.75, y: 2.75 });
  });

  it("finds the tile under any point, and the tile's middle is under itself", () => {
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 10; col++) {
        expect(tileAt(cellCentre({ row, col }, FRAME), FRAME)).toEqual({ row, col });
      }
    }
    // Anywhere inside a tile, not just its middle: a tile is half a metre square.
    expect(tileAt({ x: 2.01, y: 1.49 }, FRAME)).toEqual({ row: 3, col: 4 });
    expect(tileAt({ x: 2.49, y: 1.01 }, FRAME)).toEqual({ row: 3, col: 4 });
    // Off the plan it says so, by a row or column out of range.
    expect(tileAt({ x: -0.1, y: 3.2 }, FRAME)).toEqual({ row: -1, col: -1 });
  });

  it("draws metres as tile units, y turned down", () => {
    expect(metresToSvg({ x: 0, y: 0 }, FRAME)).toEqual({ x: 0, y: 6 });
    expect(metresToSvg({ x: 5, y: 3 }, FRAME)).toEqual({ x: 10, y: 0 });
    // A tile's middle lands in the middle of its square on screen.
    expect(metresToSvg(cellCentre({ row: 2, col: 4 }, FRAME), FRAME)).toEqual({ x: 4.5, y: 2.5 });
  });

  it("scales a walk by the tile's real size", () => {
    const metre = metresToSvg({ x: 1, y: 0 }, FRAME).x - metresToSvg({ x: 0, y: 0 }, FRAME).x;
    expect(metre).toBe(2);
    const big = frameOf(store(), 0.8);
    expect(metresToSvg({ x: 0.8, y: 0 }, big).x).toBeCloseTo(1);
  });

  it("measures a step between tiles in metres either way round", () => {
    const from = cellCentre({ row: 4, col: 1 }, FRAME);
    const to = cellCentre({ row: 4, col: 2 }, FRAME);
    expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeCloseTo(0.5);
  });
});

describe("routeFromGrid", () => {
  const route = routeFromGrid(ROUTE, FRAME);

  it("puts every point in the middle of its tile, in metres", () => {
    expect(route.legs[0]!.points[0]).toEqual({ node_id: "cell:5:0", x: 0.25, y: 0.25 });
    expect(route.stops[0]).toMatchObject({ node_id: "cell:2:4", x: 2.25, y: 1.75, department: "מוצרי חלב" });
  });

  it("keeps the graph route's shape, so ticking and re-planning work as before", () => {
    expect(route.start_node_id).toBe("cell:5:0");
    expect(route.end_node_id).toBe("cell:4:6");
    expect(route.legs.map((leg) => leg.to_node_id)).toEqual(["cell:2:4", "cell:4:6"]);
    expect(route.legs[0]!.length_m).toBe(2.5);
    expect(route.stops[0]!.leg_index).toBe(0);
    expect(route.unplaced_category_ids).toEqual(["frozen"]);
    expect(route.total_length_m).toBe(4.5);
  });
});

describe("buildFloorLayout", () => {
  const layout = buildFloorLayout(store(), 0.5);

  it("draws a tile as one unit and turns metres into tiles", () => {
    expect(layout.kind).toBe("floor");
    expect(layout.floor).toEqual({ x: 0, y: 0, width: 10, height: 6 });
    expect(layout.toSvg({ x: 2.25, y: 1.75 })).toEqual({ x: 4.5, y: 2.5 });
  });

  it("draws each shelf as one block, across or down the map, with its department", () => {
    expect(layout.shelves).toContainEqual({ x: 2, y: 1, width: 5, height: 1, label: "מוצרי חלב" });
    // The coffee shelf runs down a column for three rows: one block, no seams.
    expect(layout.shelves.filter((shelf) => shelf.x === 8)).toEqual([{ x: 8, y: 2, width: 1, height: 3, label: "קפה" }]);
    expect(layout.walls).toEqual([{ x: 0, y: 0, width: 10, height: 1 }]);
    expect(layout.counters).toEqual([{ x: 6, y: 5, width: 2, height: 1 }]);
    expect(layout.doors).toEqual([{ x: 0, y: 5, width: 1, height: 1 }]);
  });

  it("names each department once, along its longest stretch", () => {
    const names = Object.fromEntries((layout.shelfNames ?? []).map((name) => [name.key, name]));
    expect(names["מוצרי חלב"]).toMatchObject({ x: 4.5, y: 1.5, isVertical: false });
    expect(names["קפה"]).toMatchObject({ x: 8.5, y: 3.5, isVertical: true });
    expect(names["קפה"]!.fontSize).toBeLessThanOrEqual(0.62);
  });

  it("marks the entrance and the tills where they were painted", () => {
    expect(layout.entrance).toEqual({ x: 0.5, y: 5.5 });
    expect(layout.checkout).toEqual({ x: 7, y: 5.5 });
    expect(layout.shelfSideOffset("left")).toBe(0);
  });
});

describe("readFloorMap", () => {
  it("takes a plan shoppers can walk, with its tile size and placements", () => {
    const floor = readFloorMap(saved());
    expect(floor?.cellSizeM).toBe(0.5);
    expect(floor?.placements).toEqual({ dairy: "מוצרי חלב" });
    expect(floor?.layout.kind).toBe("floor");
  });

  it("leaves the store on the graph when there's no plan, or one that can't route", () => {
    expect(readFloorMap(null)).toBeNull();
    expect(
      readFloorMap(saved({ check: { routable: false, problems: ["no_checkout"], departments: [] } })),
    ).toBeNull();
    expect(readFloorMap(saved({ floor_plan: { version: 9 } }))).toBeNull();
  });

  it("reads a plan saved before tiles had a size as a metre each", () => {
    const { cell_size_m: _unused, ...older } = toPayload(store());
    expect(readFloorMap(saved({ floor_plan: older }))?.cellSizeM).toBe(1);
  });
});

describe("routePlanner on a drawn plan", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function answering(...responses: Response[]) {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => responses.shift()!);
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("asks the floor plan's endpoint, from the tile the shopper stands on", async () => {
    const fetch = answering(json(ROUTE));
    const plan = routePlanner(readFloorMap(saved()));

    const route = await plan({ category_ids: ["dairy"], start_node_id: "cell:3:2", session_id: "s" });

    expect(String(fetch.mock.calls[0]![0])).toMatch(/\/floor-plan\/routes$/);
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({
      category_ids: ["dairy"],
      session_id: "s",
      start: { row: 3, col: 2 },
    });
    expect(route.stops[0]!.node_id).toBe("cell:2:4");
  });

  it("goes from the door when a newer plan put a shelf where the shopper stood", async () => {
    const fetch = answering(json({ detail: "not walkable" }, 422), json(ROUTE));
    const plan = routePlanner(readFloorMap(saved()));

    const route = await plan({ category_ids: ["dairy"], start_node_id: "cell:1:3" });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string)).not.toHaveProperty("start");
    expect(route.start_node_id).toBe("cell:5:0");
  });

  it("ignores a graph node left from before the plan, and starts at the door", async () => {
    const fetch = answering(json(ROUTE));
    await routePlanner(readFloorMap(saved()))({ category_ids: ["dairy"], start_node_id: "a1_s1" });
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).not.toHaveProperty("start");
  });

  it("uses the graph's endpoint when the store has no plan", async () => {
    const fetch = answering(json({ ...ROUTE, stops: [], legs: [] }));
    await routePlanner(null)({ category_ids: ["dairy"] });
    expect(String(fetch.mock.calls[0]![0])).toMatch(/\/stores\/demo\/routes$/);
  });
});

describe("blocks", () => {
  it("keeps two departments side by side apart, and a gap in a shelf a gap", () => {
    let grid = createGrid(6, 6);
    grid = paint(grid, cellsBetween({ row: 0, col: 1 }, { row: 2, col: 1 }), makeTile("shelf", "קפה"));
    grid = paint(grid, cellsBetween({ row: 0, col: 2 }, { row: 2, col: 2 }), makeTile("shelf", "תה"));
    grid = paint(grid, cellsBetween({ row: 4, col: 1 }, { row: 5, col: 1 }), makeTile("shelf", "קפה"));
    const { shelves } = buildFloorLayout(grid, 1);
    expect(shelves).toEqual([
      { x: 1, y: 0, width: 1, height: 3, label: "קפה" },
      { x: 2, y: 0, width: 1, height: 3, label: "תה" },
      { x: 1, y: 4, width: 1, height: 2, label: "קפה" },
    ]);
  });
});

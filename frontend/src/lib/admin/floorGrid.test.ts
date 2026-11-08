import { describe, expect, it } from "vitest";

import {
  AISLE,
  cellsBetween,
  countTiles,
  createGrid,
  fromPayload,
  gridSize,
  makeTile,
  paint,
  resize,
  shelfLabels,
  toPayload,
  walkableMatrix,
} from "./floorGrid";

const DAIRY = makeTile("shelf", "מוצרי חלב");

describe("createGrid", () => {
  it("starts as open floor, 20 rows by 30 columns", () => {
    const grid = createGrid();
    expect(gridSize(grid)).toEqual({ rows: 20, cols: 30 });
    expect(grid.flat().every((tile) => tile === AISLE)).toBe(true);
  });

  it("keeps sizes inside the editor's bounds", () => {
    expect(gridSize(createGrid(1, 500))).toEqual({ rows: 5, cols: 60 });
  });
});

describe("makeTile", () => {
  it("lets only shelves carry a label, cleaned", () => {
    expect(makeTile("shelf", "  מוצרי   חלב ")).toEqual({ kind: "shelf", label: "מוצרי חלב" });
    expect(makeTile("wall", "מוצרי חלב")).toEqual({ kind: "wall" });
    expect(makeTile("shelf", "   ")).toEqual({ kind: "shelf" });
    expect(makeTile("shelf", "x".repeat(80)).label).toHaveLength(40);
  });
});

describe("paint", () => {
  it("lays the tile on the cells and copies only the rows it touched", () => {
    const grid = createGrid(5, 5);
    const painted = paint(grid, [{ row: 1, col: 2 }, { row: 1, col: 3 }], DAIRY);

    expect(painted[1]?.[2]).toBe(DAIRY);
    expect(painted[1]?.[3]).toBe(DAIRY);
    expect(painted[1]).not.toBe(grid[1]);
    expect(painted[0]).toBe(grid[0]);
    expect(grid[1]?.[2]).toBe(AISLE);
  });

  it("returns the same grid when nothing changes, so a click on paint adds no undo step", () => {
    const grid = paint(createGrid(5, 5), [{ row: 0, col: 0 }], DAIRY);
    expect(paint(grid, [{ row: 0, col: 0 }], makeTile("shelf", "מוצרי חלב"))).toBe(grid);
    expect(paint(grid, [{ row: -1, col: 0 }, { row: 0, col: 9 }], DAIRY)).toBe(grid);
  });

  it("relabels a shelf, since a new department is a change", () => {
    const grid = paint(createGrid(5, 5), [{ row: 0, col: 0 }], DAIRY);
    expect(paint(grid, [{ row: 0, col: 0 }], makeTile("shelf", "קפה"))[0]?.[0]?.label).toBe("קפה");
  });
});

describe("cellsBetween", () => {
  it("fills the gaps a fast drag leaves, ends included", () => {
    expect(cellsBetween({ row: 2, col: 1 }, { row: 2, col: 5 })).toHaveLength(5);
    expect(cellsBetween({ row: 0, col: 0 }, { row: 3, col: 3 })).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 1 },
      { row: 2, col: 2 },
      { row: 3, col: 3 },
    ]);
  });

  it("steps one cell at a time in any direction", () => {
    const line = cellsBetween({ row: 7, col: 9 }, { row: 1, col: 2 });
    expect(line[0]).toEqual({ row: 7, col: 9 });
    expect(line.at(-1)).toEqual({ row: 1, col: 2 });
    line.slice(1).forEach((cell, i) => {
      const previous = line[i] ?? cell;
      expect(Math.abs(cell.row - previous.row)).toBeLessThanOrEqual(1);
      expect(Math.abs(cell.col - previous.col)).toBeLessThanOrEqual(1);
    });
  });

  it("is a single cell when both ends are the same", () => {
    expect(cellsBetween({ row: 4, col: 4 }, { row: 4, col: 4 })).toEqual([{ row: 4, col: 4 }]);
  });
});

describe("resize", () => {
  it("keeps the drawing from the top-left and opens new floor", () => {
    const grid = paint(createGrid(5, 5), [{ row: 4, col: 4 }, { row: 0, col: 0 }], DAIRY);
    const bigger = resize(grid, 8, 10);
    expect(gridSize(bigger)).toEqual({ rows: 8, cols: 10 });
    expect(bigger[4]?.[4]).toBe(DAIRY);
    expect(bigger[7]?.[9]).toBe(AISLE);
    expect(resize(bigger, 5, 5)[0]?.[0]).toBe(DAIRY);
  });
});

describe("what a path search reads", () => {
  it("marks aisles and the entrance walkable, everything else blocked", () => {
    let grid = createGrid(5, 5);
    grid = paint(grid, [{ row: 0, col: 0 }], makeTile("wall"));
    grid = paint(grid, [{ row: 0, col: 1 }], DAIRY);
    grid = paint(grid, [{ row: 0, col: 2 }], makeTile("checkout"));
    grid = paint(grid, [{ row: 0, col: 3 }], makeTile("entrance"));

    expect(walkableMatrix(grid)[0]).toEqual([false, false, false, true, true]);
    expect(countTiles(grid)).toEqual({ aisle: 21, shelf: 1, wall: 1, checkout: 1, entrance: 1 });
  });
});

describe("shelfLabels", () => {
  it("counts each department's tiles, the biggest first", () => {
    let grid = createGrid(5, 5);
    grid = paint(grid, [{ row: 0, col: 0 }], makeTile("shelf", "קפה"));
    grid = paint(grid, [{ row: 1, col: 0 }, { row: 1, col: 1 }], DAIRY);
    grid = paint(grid, [{ row: 2, col: 0 }], makeTile("shelf"));

    expect(shelfLabels(grid)).toEqual([
      { label: "מוצרי חלב", tiles: 2 },
      { label: "קפה", tiles: 1 },
    ]);
  });
});

describe("the JSON payload", () => {
  const drawn = () => {
    let grid = createGrid(5, 6);
    grid = paint(grid, cellsBetween({ row: 1, col: 1 }, { row: 1, col: 4 }), DAIRY);
    grid = paint(grid, [{ row: 4, col: 0 }], makeTile("entrance"));
    grid = paint(grid, [{ row: 4, col: 5 }], makeTile("checkout"));
    return paint(grid, [{ row: 2, col: 2 }], makeTile("shelf"));
  };

  it("is kinds in a matrix with the labels beside it", () => {
    const payload = toPayload(drawn());

    expect(payload).toMatchObject({ version: 1, rows: 5, cols: 6 });
    expect(payload.tiles[1]).toEqual(["aisle", "shelf", "shelf", "shelf", "shelf", "aisle"]);
    expect(payload.tiles[4]?.[0]).toBe("entrance");
    expect(payload.labels).toEqual([1, 2, 3, 4].map((col) => ({ row: 1, col, label: "מוצרי חלב" })));
  });

  it("survives a round trip through a string", () => {
    const grid = drawn();
    expect(fromPayload(JSON.parse(JSON.stringify(toPayload(grid))))).toEqual(grid);
  });

  it("refuses anything that isn't one", () => {
    const good = toPayload(drawn());
    expect(fromPayload(null)).toBeNull();
    expect(fromPayload("grid")).toBeNull();
    expect(fromPayload({ ...good, version: 2 })).toBeNull();
    expect(fromPayload({ ...good, rows: 4 })).toBeNull();
    expect(fromPayload({ ...good, tiles: good.tiles.map((line) => line.slice(1)) })).toBeNull();
    expect(fromPayload({ ...good, tiles: [["lava", ...(good.tiles[0] ?? []).slice(1)], ...good.tiles.slice(1)] })).toBeNull();
    expect(fromPayload({ ...good, labels: [{ row: 1 }] })).toBeNull();
  });

  it("drops a label that doesn't sit on a shelf", () => {
    const good = toPayload(drawn());
    const grid = fromPayload({ ...good, labels: [{ row: 0, col: 0, label: "קפה" }] });
    expect(grid?.[0]?.[0]).toBe(AISLE);
  });
});

import { describe, expect, it } from "vitest";

import { shelfAxis, shelfPartRects } from "./shelfParts";

// An 18-tile gondola column, rows 5 to 22, as the flagship plan draws it.
const column = [{ x: 6, y: 5, width: 1, height: 18 }];

describe("a shelf's quarters", () => {
  it("are cut down a shelf that runs down the map, as the server cuts its tiles: 5, 4, 5 and 4", () => {
    expect(shelfAxis(column)).toBe("down");
    expect([0, 1, 2, 3].map((part) => shelfPartRects(column, part)[0])).toEqual([
      { x: 6, y: 5, width: 1, height: 5 },
      { x: 6, y: 10, width: 1, height: 4 },
      { x: 6, y: 14, width: 1, height: 5 },
      { x: 6, y: 19, width: 1, height: 4 },
    ]);
  });

  it("run from the left on a shelf across the map", () => {
    const wall = [{ x: 30, y: 1, width: 8, height: 1 }];
    expect(shelfAxis(wall)).toBe("across");
    expect(shelfPartRects(wall, 3)).toEqual([{ x: 36, y: 1, width: 2, height: 1 }]);
  });

  it("cut every block of a shelf drawn in pieces", () => {
    const tables = [
      { x: 18, y: 27, width: 12, height: 2 },
      { x: 18, y: 31, width: 12, height: 2 },
    ];
    expect(shelfPartRects(tables, 0)).toEqual([
      { x: 18, y: 27, width: 3, height: 2 },
      { x: 18, y: 31, width: 3, height: 2 },
    ]);
  });

  it("give a too-short shelf's missing quarter its nearest", () => {
    const short = [{ x: 4, y: 2, width: 2, height: 1 }];
    expect(shelfPartRects(short, 1)).toEqual([{ x: 4, y: 2, width: 1, height: 1 }]);
  });
});

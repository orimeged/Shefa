import { describe, expect, it } from "vitest";

import type { ResolvedItem, Route, RouteStop } from "../../api/types";
import { pickLines, pickProgress, pickWalk, withLineState } from "./picking";

const parsed = [
  { text: "2 חלב 3%", query: "חלב 3%" },
  { text: "עגבניות שרי", query: "עגבניות שרי" },
  { text: "נרות שבת", query: "נרות שבת" },
  { text: "קוטג'", query: "קוטג'" },
];

function hit(line: number, category_id: string | null): ResolvedItem {
  return {
    line,
    text: parsed[line]!.text,
    hit: category_id ? ({ category_id } as ResolvedItem["hit"]) : null,
    source: category_id ? "catalog" : null,
    dictionary_id: null,
  };
}

function stop(category_id: string, department: string, seq: number): RouteStop {
  return { seq, category_id, category_name: department, category_name_en: department, node_id: `cell:${seq}:1`, aisle_no: 0, side: "left", x: seq, y: 1, leg_index: seq, department };
}

const route = { stops: [stop("produce", "ירקות", 0), stop("dairy", "חלב וביצים", 1), stop("bakery", "לחם", 2)] } as Route;
const lines = pickLines(parsed, [hit(0, "dairy"), hit(1, "produce"), hit(2, null), hit(3, "dairy")]);

describe("pickWalk", () => {
  it("puts each line under its shelf, in walking order", () => {
    const walk = pickWalk(lines, route);
    expect(walk.stops.map((s) => [s.title, s.lines.map((line) => line.text)])).toEqual([
      ["ירקות", ["עגבניות שרי"]],
      ["חלב וביצים", ["2 חלב 3%", "קוטג'"]],
    ]);
  });

  it("leaves out a stop with nothing to pick, and keeps what has no place for last", () => {
    const walk = pickWalk(lines, route);
    expect(walk.stops.some((s) => s.categoryId === "bakery")).toBe(false);
    expect(walk.elsewhere.map((line) => line.text)).toEqual(["נרות שבת"]);
  });
});

describe("pickProgress", () => {
  it("counts picked, missing and left", () => {
    let walk = pickWalk(lines, route);
    walk = withLineState(walk, lines[0]!.key, "picked");
    walk = withLineState(walk, lines[2]!.key, "missing");
    expect(pickProgress(walk)).toEqual({ total: 4, picked: 1, missing: 1, left: 2 });
  });
});

import { describe, expect, it } from "vitest";

import { DEPARTMENT_COLOURS, departmentCategories, departmentColours } from "./departments";
import { BADGE_HEIGHT_PX, badgeWidth, placeBadges } from "./mapLabels";

describe("department colours", () => {
  it("gives each department its own, in the order they first appear", () => {
    const colours = departmentColours(["מוצרי חלב", "ירקות", "מוצרי חלב", "שתייה"]);
    expect(colours.get("מוצרי חלב")).toBe(DEPARTMENT_COLOURS[0]);
    expect(colours.get("ירקות")).toBe(DEPARTMENT_COLOURS[1]);
    expect(colours.get("שתייה")).toBe(DEPARTMENT_COLOURS[2]);
  });

  it("never repaints the others when a department is added after them", () => {
    const before = departmentColours(["a", "b"]);
    const after = departmentColours(["a", "b", "c"]);
    expect(after.get("a")).toBe(before.get("a"));
    expect(after.get("b")).toBe(before.get("b"));
  });

  it("comes round again past the palette's end", () => {
    const labels = Array.from({ length: DEPARTMENT_COLOURS.length + 1 }, (_, index) => `d${index}`);
    expect(departmentColours(labels).get(`d${DEPARTMENT_COLOURS.length}`)).toBe(DEPARTMENT_COLOURS[0]);
  });

  it("keeps clear of the route's green and the next station's orange", () => {
    for (const { top } of DEPARTMENT_COLOURS) {
      const [r, g, b] = [1, 3, 5].map((at) => parseInt(top.slice(at, at + 2), 16));
      // Soft: every channel light, none far from the others.
      expect(Math.min(r!, g!, b!)).toBeGreaterThan(150);
      expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!)).toBeLessThan(60);
    }
  });
});

describe("a department's icon", () => {
  it("comes from a category placed in it, preferring one with an icon of its own", () => {
    const icons = new Set(["dairy"]);
    const chosen = departmentCategories(
      { "product-12": "מוצרי חלב", dairy: "מוצרי חלב", produce: "ירקות" },
      (id) => icons.has(id),
    );
    expect(chosen.get("מוצרי חלב")).toBe("dairy");
    expect(chosen.get("ירקות")).toBe("produce");
  });
});

describe("placing badges", () => {
  const screen = { width: 390, height: 600 };
  const badge = (key: string, candidates: { x: number; y: number }[], priority = 1) => ({
    key,
    width: badgeWidth(key),
    height: BADGE_HEIGHT_PX,
    priority,
    candidates,
  });
  const keys = (placed: Map<string, unknown>) => new Set(placed.keys());

  it("shows badges that don't touch, where they asked to be", () => {
    const placed = placeBadges([badge("a", [{ x: 100, y: 100 }]), badge("b", [{ x: 100, y: 200 }])], [], screen);
    expect(placed.get("a")).toEqual({ x: 100, y: 100, compact: false });
    expect(keys(placed)).toEqual(new Set(["a", "b"]));
  });

  it("leaves out one that would overlap, keeping the more important", () => {
    const placed = placeBadges([badge("plain", [{ x: 100, y: 100 }]), badge("next", [{ x: 110, y: 104 }], 3)], [], screen);
    expect(keys(placed)).toEqual(new Set(["next"]));
  });

  it("moves a badge to its next place when the first is taken", () => {
    const placed = placeBadges(
      [badge("next", [{ x: 100, y: 100 }], 3), badge("dairy", [{ x: 104, y: 102 }, { x: 100, y: 300 }])],
      [],
      screen,
    );
    expect(placed.get("dairy")).toEqual({ x: 100, y: 300, compact: false });
  });

  it("keeps clear of the markers and of the screen's edges", () => {
    const placed = placeBadges(
      [badge("under-pin", [{ x: 200, y: 300 }]), badge("off-edge", [{ x: 5, y: 300 }]), badge("clear", [{ x: 200, y: 400 }])],
      [{ x: 200, y: 300, width: 34, height: 46 }],
      screen,
    );
    expect(keys(placed)).toEqual(new Set(["clear"]));
  });

  it("gives one with no room in full its icon alone, after every full badge is placed", () => {
    // Two shelves 50 px apart: a full badge is wider than that, an icon isn't.
    const narrow = (key: string, x: number, priority = 1) => ({ ...badge(key, [{ x, y: 100 }], priority), compactSize: 22 });
    const placed = placeBadges([narrow("bakery", 100), narrow("dairy", 150, 2), narrow("snacks", 200)], [], screen);
    expect(placed.get("dairy")?.compact).toBe(false);
    expect(placed.get("bakery")?.compact).toBe(true);
    expect(placed.get("snacks")?.compact).toBe(true);
  });

  it("waits with a badge that has nowhere in view", () => {
    expect(placeBadges([badge("away", [])], [], screen).size).toBe(0);
  });
});

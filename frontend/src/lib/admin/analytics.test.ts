import { describe, expect, it } from "vitest";

import type { LostCategory } from "../../api/types";
import {
  departmentSlices,
  heatSpots,
  trafficColor,
  trafficLine,
  trendOf,
} from "./analytics";

function department(id: string | null, times: number, share = 0.1): LostCategory {
  return {
    category_id: id,
    category_name: id && `שם ${id}`,
    category_name_en: id,
    times,
    share,
  };
}

function lightness(color: string): number {
  const [r, g, b] = color.match(/\d+/g)!.map(Number) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("trendOf", () => {
  it("measures growth against last week", () => {
    expect(trendOf({ current: 120, previous: 100 }, true)).toEqual({
      direction: "up",
      percent: 20,
      tone: "good",
    });
  });

  it("calls more routes good and more missing items bad", () => {
    expect(trendOf({ current: 12, previous: 10 }, true).tone).toBe("good");
    expect(trendOf({ current: 12, previous: 10 }, false).tone).toBe("bad");
  });

  it("calls fewer missing items good", () => {
    expect(trendOf({ current: 5, previous: 10 }, false)).toEqual({
      direction: "down",
      percent: 50,
      tone: "good",
    });
  });

  it("gives no percentage when last week was zero", () => {
    expect(trendOf({ current: 4, previous: 0 }, true).percent).toBeNull();
  });

  it("stays neutral when nothing moved", () => {
    expect(trendOf({ current: 0, previous: 0 }, true)).toEqual({
      direction: "flat",
      percent: 0,
      tone: "neutral",
    });
  });
});

describe("departmentSlices", () => {
  it("gives each department its own color, biggest first", () => {
    const slices = departmentSlices([department("a", 5), department("b", 9)]);

    expect(slices.map((slice) => slice.key)).toEqual(["b", "a"]);
    expect(new Set(slices.map((slice) => slice.color)).size).toBe(2);
  });

  it("folds departments past the fifth into one slice", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g"].map((id, index) => department(id, 10 - index));

    const slices = departmentSlices(many);

    expect(slices).toHaveLength(6);
    expect(slices.at(-1)).toMatchObject({ key: "other", category: null, times: 5 + 4 });
  });

  it("puts items with no department in the same slice", () => {
    const slices = departmentSlices([department("a", 5), department(null, 2)]);

    expect(slices.at(-1)).toMatchObject({ key: "other", times: 2 });
  });

  it("keeps every share", () => {
    const shares = [0.5, 0.2, 0.1, 0.1, 0.05, 0.03, 0.02];
    const many = shares.map((share, index) => department(`${index}`, 100 - index, share));

    const total = departmentSlices(many).reduce((sum, slice) => sum + slice.share, 0);

    expect(total).toBeCloseTo(1);
  });

  it("adds no empty slice", () => {
    expect(departmentSlices([department("a", 5)]).map((slice) => slice.key)).toEqual(["a"]);
  });

  it("doesn't reorder the report it was given", () => {
    const categories = [department("a", 1), department("b", 9)];

    departmentSlices(categories);

    expect(categories.map((category) => category.category_id)).toEqual(["a", "b"]);
  });

  it("is empty for an empty report", () => {
    expect(departmentSlices([])).toEqual([]);
  });
});

describe("traffic scale", () => {
  it("runs from blue to red", () => {
    expect(trafficColor(0)).toBe("rgb(183, 211, 246)");
    expect(trafficColor(1)).toBe("rgb(180, 35, 24)");
  });

  it("gets darker all the way, so it survives without color", () => {
    const levels = [0, 0.2, 0.4, 0.6, 0.8, 1].map(trafficColor).map(lightness);

    expect(levels).toEqual([...levels].sort((a, b) => b - a));
  });

  it("stays on the scale past its ends", () => {
    expect(trafficColor(-1)).toBe(trafficColor(0));
    expect(trafficColor(2)).toBe(trafficColor(1));
  });

  it("draws busier walkways thicker", () => {
    expect(trafficLine(100, 100)!.width).toBeGreaterThan(trafficLine(20, 100)!.width);
  });

  it("draws nothing for a walkway nobody took", () => {
    expect(trafficLine(0, 100)).toBeNull();
    expect(trafficLine(0, 0)).toBeNull();
  });
});

describe("heatSpots", () => {
  it("makes the hottest spot the largest and strongest", () => {
    const [hot, cool] = heatSpots([
      { x: 1, y: 1, count: 16 },
      { x: 2, y: 2, count: 1 },
    ]);

    expect(hot!.radius).toBeGreaterThan(cool!.radius);
    expect(hot!.opacity).toBe(1);
    expect(cool!.opacity).toBeLessThan(1);
  });

  it("keeps a single report visible beside a busy shelf", () => {
    const [, cool] = heatSpots([
      { x: 1, y: 1, count: 100 },
      { x: 2, y: 2, count: 1 },
    ]);

    expect(cool!.opacity).toBeGreaterThanOrEqual(0.4);
  });

  it("gives every spot its own key", () => {
    const spots = heatSpots([
      { x: 1, y: 1, count: 2 },
      { x: 1, y: 2, count: 2 },
    ]);

    expect(new Set(spots.map((spot) => spot.key)).size).toBe(2);
  });

  it("is empty for no reports", () => {
    expect(heatSpots([])).toEqual([]);
  });
});

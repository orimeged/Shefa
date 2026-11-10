import { describe, expect, it } from "vitest";

import { boundsOf, easeInOutCubic, flight, formatViewBox, frameFocus, parseViewBox, toScreen, unitsPerPixel } from "./mapCamera";

// A phone: 390 by 844, with a header over the top 110 px and the station sheet over the bottom 300.
const SCREEN = { width: 390, height: 844 };
const INSETS = { top: 110, right: 18, bottom: 300, left: 18 };

describe("reading and writing a viewBox", () => {
  it("round-trips", () => {
    const view = parseViewBox("-0.4 -0.4 30.8 22.8");
    expect(view).toEqual({ x: -0.4, y: -0.4, width: 30.8, height: 22.8 });
    expect(formatViewBox(view)).toBe("-0.4 -0.4 30.8 22.8");
  });
});

describe("boundsOf", () => {
  it("is the box round the points, with the margin on every side", () => {
    expect(boundsOf([{ x: 2, y: 3 }, { x: 6, y: 1 }], 1)).toEqual({ x: 1, y: 0, width: 6, height: 4 });
  });
});

describe("framing a walk", () => {
  const walk = boundsOf([{ x: 10, y: 4 }, { x: 10, y: 16 }, { x: 14, y: 16 }], 1.6);

  it("keeps the screen's proportions, so the map is never stretched or letterboxed", () => {
    const view = frameFocus(walk, SCREEN, INSETS);
    expect(view.width / view.height).toBeCloseTo(SCREEN.width / SCREEN.height);
  });

  it("shows the whole walk inside the part of the map the header and sheet leave clear", () => {
    const view = frameFocus(walk, SCREEN, INSETS);
    for (const corner of [
      { x: walk.x, y: walk.y },
      { x: walk.x + walk.width, y: walk.y + walk.height },
    ]) {
      const at = toScreen(corner, view, SCREEN);
      expect(at.x).toBeGreaterThanOrEqual(INSETS.left - 1e-6);
      expect(at.x).toBeLessThanOrEqual(SCREEN.width - INSETS.right + 1e-6);
      expect(at.y).toBeGreaterThanOrEqual(INSETS.top - 1e-6);
      expect(at.y).toBeLessThanOrEqual(SCREEN.height - INSETS.bottom + 1e-6);
    }
  });

  it("centres it there, and fills it the tighter way", () => {
    const view = frameFocus(walk, SCREEN, INSETS);
    const middle = toScreen({ x: walk.x + walk.width / 2, y: walk.y + walk.height / 2 }, view, SCREEN);
    expect(middle.x).toBeCloseTo((INSETS.left + SCREEN.width - INSETS.right) / 2);
    expect(middle.y).toBeCloseTo((INSETS.top + SCREEN.height - INSETS.bottom) / 2);
    // The walk is tall: it fills the clear height exactly.
    const top = toScreen({ x: walk.x, y: walk.y }, view, SCREEN);
    const bottom = toScreen({ x: walk.x, y: walk.y + walk.height }, view, SCREEN);
    expect(bottom.y - top.y).toBeCloseTo(SCREEN.height - INSETS.top - INSETS.bottom);
  });

  it("never comes closer than the minimum span, for a station a step away", () => {
    const step = boundsOf([{ x: 5, y: 5 }, { x: 5.5, y: 5 }], 0.2);
    const view = frameFocus(step, SCREEN, INSETS, { minSpan: 9 });
    const clearWidthInUnits = (SCREEN.width - INSETS.left - INSETS.right) * unitsPerPixel(view, SCREEN);
    expect(clearWidthInUnits).toBeCloseTo(9);
  });

  it("knows how big a pixel is, for keeping markers one size on screen", () => {
    const view = { x: 0, y: 0, width: 39, height: 84.4 };
    expect(unitsPerPixel(view, SCREEN)).toBeCloseTo(0.1);
  });
});

describe("the flight between two shots", () => {
  const from = { x: 0, y: 0, width: 10, height: 20 };
  const to = { x: 30, y: 10, width: 20, height: 40 };
  const path = flight(from, to);

  it("starts exactly at one and ends exactly at the other", () => {
    expect(path(0)).toEqual(from);
    expect(path(1)).toEqual(to);
  });

  it("keeps the screen's proportions all the way", () => {
    for (const t of [0.1, 0.3, 0.5, 0.8]) {
      const view = path(t);
      expect(view.width / view.height).toBeCloseTo(0.5);
    }
  });

  it("rises a little on the way across, to show where it's going", () => {
    const middle = path(0.5);
    // Plain interpolation in scale would give sqrt(10 * 20) wide halfway.
    expect(middle.width).toBeGreaterThan(Math.sqrt(10 * 20) * 1.1);
  });

  it("doesn't rise for a zoom on the spot", () => {
    const spot = flight({ x: 0, y: 0, width: 10, height: 10 }, { x: 2.5, y: 2.5, width: 5, height: 5 });
    expect(spot(0.5).width).toBeCloseTo(Math.sqrt(50));
  });

  it("eases in and out", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(0.1)).toBeLessThan(0.1);
    expect(easeInOutCubic(0.9)).toBeGreaterThan(0.9);
  });
});

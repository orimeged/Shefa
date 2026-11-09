import { describe, expect, it } from "vitest";

import {
  cameraTransform,
  followAnchor,
  followZoom,
  onView,
  parseViewBox,
  unitsPerMetre,
  uprightAngle,
} from "./mapCamera";

const VIEW = parseViewBox("-0.4 -0.4 30.8 22.8");

describe("the navigation camera", () => {
  it("reads the SVG's viewBox", () => {
    expect(VIEW).toEqual({ x: -0.4, y: -0.4, width: 30.8, height: 22.8 });
  });

  it("zooms to about sixteen metres across, whatever a tile measures", () => {
    // 30.8 units of 0.8 m tiles is 24.6 m: 16 m of it is 20 tiles.
    expect(followZoom(VIEW, 1 / 0.8)).toBeCloseTo(30.8 / 20);
    // A store narrower than that is shown whole, never zoomed out.
    expect(followZoom(parseViewBox("0 0 10 10"), 1)).toBe(1);
  });

  it("is no transform at all before it moves in", () => {
    const camera = { zoom: 2, rotation: 90, blend: 0 };
    const point = { x: 7, y: 3 };
    expect(onView(VIEW, { x: 20, y: 15 }, camera, point)).toEqual(point);
  });

  it("puts the shopper at the follow point, below the middle, once in", () => {
    const spot = { x: 20, y: 15 };
    const placed = onView(VIEW, spot, { zoom: 1.5, rotation: 37, blend: 1 }, spot);
    const anchor = followAnchor(VIEW);
    expect(placed.x).toBeCloseTo(anchor.x);
    expect(placed.y).toBeCloseTo(anchor.y);
    expect(anchor.y).toBeGreaterThan(VIEW.y + VIEW.height / 2);
  });

  it("turns the map so the way the shopper faces points up the screen", () => {
    const spot = { x: 10, y: 10 };
    // Facing east (90): the point one unit east of them must show one unit straight up.
    const ahead = onView(VIEW, spot, { zoom: 1, rotation: 90, blend: 1 }, { x: 11, y: 10 });
    const anchor = followAnchor(VIEW);
    expect(ahead.x).toBeCloseTo(anchor.x);
    expect(ahead.y).toBeCloseTo(anchor.y - 1);
    // Facing up the map (0), nothing turns: north stays up.
    const north = onView(VIEW, spot, { zoom: 1, rotation: 0, blend: 1 }, { x: 10, y: 9 });
    expect(north.y).toBeCloseTo(anchor.y - 1);
  });

  it("scales distances by the zoom", () => {
    const spot = { x: 10, y: 10 };
    const a = onView(VIEW, spot, { zoom: 2, rotation: 0, blend: 1 }, { x: 10, y: 10 });
    const b = onView(VIEW, spot, { zoom: 2, rotation: 0, blend: 1 }, { x: 13, y: 10 });
    expect(b.x - a.x).toBeCloseTo(6);
  });

  it("writes the same transform it works out", () => {
    const transform = cameraTransform(VIEW, { x: 20, y: 15 }, { zoom: 1.5, rotation: 30, blend: 1 });
    const anchor = followAnchor(VIEW);
    expect(transform).toBe(`translate(${anchor.x} ${anchor.y}) rotate(-30) scale(1.5) translate(-20 -15)`);
  });

  it("keeps labels along their shelf but never upside down", () => {
    // A shelf name across the map, the map turned 30°: it turns with the map.
    expect(uprightAngle(0, 30)).toBe(0);
    // The map turned half round: the name flips to stay readable.
    expect(uprightAngle(0, 180)).toBe(180);
    expect(uprightAngle(0, 170)).toBe(180);
    // A name drawn up a shelf stays as drawn while the map faces north.
    expect(uprightAngle(-90, 0)).toBe(-90);
    // On screen it always ends within a quarter turn of level.
    for (const rotation of [0, 45, 90, 135, 200, 271, 359]) {
      for (const base of [0, -90]) {
        const screen = ((uprightAngle(base, rotation) - rotation + 540) % 360) - 180;
        expect(Math.abs(screen)).toBeLessThanOrEqual(90);
      }
    }
  });

  it("knows how many SVG units a metre is", () => {
    expect(unitsPerMetre((point) => point)).toBe(1);
    expect(unitsPerMetre(({ x, y }) => ({ x: x / 0.8, y: 10 - y / 0.8 }))).toBeCloseTo(1.25);
  });
});

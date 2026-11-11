import { describe, expect, it } from "vitest";

import { toScreen } from "./mapCamera";
import { clampView, flickVelocity, panBy, pinch, zoomAt } from "./mapGestures";

const SCREEN = { width: 400, height: 800 };
// 20 by 40 units on a 400 by 800 screen: 20 pixels a unit.
const VIEW = { x: 0, y: 0, width: 20, height: 40 };

describe("dragging", () => {
  it("moves the map with the finger", () => {
    const point = { x: 5, y: 10 };
    const before = toScreen(point, VIEW, SCREEN);
    const after = toScreen(point, panBy(VIEW, 60, -40, SCREEN), SCREEN);
    expect(after.x - before.x).toBeCloseTo(60);
    expect(after.y - before.y).toBeCloseTo(-40);
  });
});

describe("zooming", () => {
  it("keeps the point under the finger where it is", () => {
    const finger = { x: 120, y: 300 };
    const zoomed = zoomAt(VIEW, 2.5, finger, SCREEN);
    const under = { x: VIEW.x + finger.x / 20, y: VIEW.y + finger.y / 20 };
    const stays = toScreen(under, zoomed, SCREEN);
    expect(stays.x).toBeCloseTo(finger.x);
    expect(stays.y).toBeCloseTo(finger.y);
    expect(zoomed.width).toBeCloseTo(8);
  });

  it("keeps the screen's proportions", () => {
    const zoomed = zoomAt(VIEW, 0.6, { x: 10, y: 700 }, SCREEN);
    expect(zoomed.width / zoomed.height).toBeCloseTo(0.5);
  });
});

describe("pinching", () => {
  it("follows the middle of the two fingers and scales with their spread", () => {
    const before = [{ x: 100, y: 400 }, { x: 300, y: 400 }] as const;
    const after = [{ x: 50, y: 450 }, { x: 450, y: 450 }] as const;
    const pinched = pinch(VIEW, before, after, SCREEN);
    // The fingers spread twice as far apart: twice as close.
    expect(pinched.width).toBeCloseTo(10);
    // What was between the fingers is still between them, where they now are.
    const between = { x: 10, y: 20 };
    const now = toScreen(between, pinched, SCREEN);
    expect(now.x).toBeCloseTo(250);
    expect(now.y).toBeCloseTo(450);
  });

  it("does nothing for fingers that didn't move", () => {
    const fingers = [{ x: 100, y: 100 }, { x: 200, y: 300 }] as const;
    expect(pinch(VIEW, fingers, fingers, SCREEN)).toEqual(VIEW);
  });
});

describe("the limits", () => {
  const limits = { bounds: { x: 0, y: 0, width: 30, height: 20 }, minWidth: 4, maxWidth: 48 };

  it("stop the camera coming closer than the closest", () => {
    const close = clampView({ x: 10, y: 10, width: 1, height: 2 }, limits);
    expect(close.width).toBe(4);
    expect(close.height).toBe(8);
    // About the same middle.
    expect(close.x + close.width / 2).toBeCloseTo(10.5);
  });

  it("stop it going further out than the furthest", () => {
    expect(clampView({ x: -50, y: -50, width: 200, height: 400 }, limits).width).toBe(48);
  });

  it("keep the store in view however far it's dragged", () => {
    const away = clampView({ x: 500, y: -300, width: 10, height: 20 }, limits);
    expect(away.x + away.width / 2).toBe(30);
    expect(away.y + away.height / 2).toBe(0);
  });

  it("leave a view inside them as it is", () => {
    const fine = { x: 5, y: 2, width: 10, height: 20 };
    expect(clampView(fine, limits)).toEqual(fine);
  });
});

describe("a flick", () => {
  it("is as fast as the last moves before letting go", () => {
    const moves = [
      { time: 0, dx: 1, dy: 0 },
      { time: 900, dx: 10, dy: 2 },
      { time: 916, dx: 10, dy: 2 },
      { time: 932, dx: 10, dy: 2 },
    ];
    const velocity = flickVelocity(moves, 950);
    // 30 pixels in the 50 ms since the first recent move: about 0.6 a millisecond.
    expect(velocity.x).toBeCloseTo(0.6, 1);
    expect(velocity.y).toBeCloseTo(0.12, 1);
  });

  it("comes from a single move too, when the screen reports moves slowly", () => {
    const velocity = flickVelocity([{ time: 900, dx: 25, dy: 0 }], 950);
    expect(velocity.x).toBeCloseTo(0.5);
  });

  it("is nothing after holding still before letting go", () => {
    expect(flickVelocity([{ time: 0, dx: 30, dy: 0 }], 500)).toEqual({ x: 0, y: 0 });
  });
});

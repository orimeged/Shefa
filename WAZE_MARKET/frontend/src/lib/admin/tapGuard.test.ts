import { describe, expect, it } from "vitest";

import { isTap } from "./tapGuard";

describe("isTap", () => {
  it("accepts a press that stayed put", () => {
    expect(isTap({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(true);
  });

  it("forgives a fingertip's wobble", () => {
    expect(isTap({ x: 10, y: 10 }, { x: 14, y: 14 })).toBe(true);
  });

  it("rejects a drag that came back to the same shelf", () => {
    expect(isTap({ x: 10, y: 10 }, { x: 40, y: 10 })).toBe(false);
  });

  it("rejects a click with no press, as after a pinch", () => {
    expect(isTap(null, { x: 10, y: 10 })).toBe(false);
  });
});

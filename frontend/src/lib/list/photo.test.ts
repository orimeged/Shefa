import { describe, expect, it } from "vitest";

import { fitWithin } from "./photo";

describe("fitWithin", () => {
  it("shrinks a tall phone photo by its longest side", () => {
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("shrinks a wide one the same way", () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("never enlarges a small image", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});

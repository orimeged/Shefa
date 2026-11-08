import { describe, expect, it } from "vitest";

import type { ShoppingSession } from "./sessionStore";
import { phaseOf } from "./sessionStore";

const session: ShoppingSession = {
  items: [],
  found: [],
  positionNodeId: null,
  seedKey: "",
};

describe("phaseOf", () => {
  it("starts a first visit by building a list", () => {
    expect(phaseOf(null)).toBe("building");
  });

  it("keeps the phase a session saved", () => {
    expect(phaseOf({ ...session, phase: "shopping" })).toBe("shopping");
    expect(phaseOf({ ...session, phase: "building", positionNodeId: "a1_s1" })).toBe("building");
  });

  it("treats a session saved before phases as started if it got a route", () => {
    expect(phaseOf({ ...session, positionNodeId: "entrance" })).toBe("shopping");
    expect(phaseOf({ ...session, found: ["dairy"] })).toBe("shopping");
  });

  it("treats one with neither as still building", () => {
    expect(phaseOf(session)).toBe("building");
  });
});

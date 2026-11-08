import { describe, expect, it } from "vitest";

import type { Route, RouteLeg, RouteStop } from "../api/types";
import {
  applyToggle,
  completesList,
  currentPoint,
  distanceToNextStop,
  isNextStop,
  lastWalkedLeg,
  pendingStops,
  remainingDistance,
  remainingLegs,
} from "./routeProgress";
import type { FoundSet } from "./routeProgress";

function leg(from: string, to: string, length_m: number): RouteLeg {
  return {
    to_node_id: to,
    length_m,
    points: [
      { node_id: from, x: 0, y: 0 },
      { node_id: to, x: 1, y: 1 },
    ],
  };
}

function stop(seq: number, category_id: string, node_id: string, leg_index: number): RouteStop {
  return {
    seq,
    category_id,
    category_name: category_id,
    category_name_en: category_id,
    node_id,
    aisle_no: 1,
    side: "left",
    x: 0,
    y: 0,
    leg_index,
  };
}

// Entrance, then A, then B and C on one node, then D, then the checkout.
const route: Route = {
  store_id: "demo",
  start_node_id: "entrance",
  end_node_id: "checkout",
  total_length_m: 100,
  stops: [stop(0, "a", "n1", 0), stop(1, "b", "n2", 1), stop(2, "c", "n2", 1), stop(3, "d", "n3", 2)],
  legs: [leg("entrance", "n1", 10), leg("n1", "n2", 20), leg("n2", "n3", 30), leg("n3", "checkout", 40)],
  unplaced_category_ids: [],
};

const categoryIds = ["a", "b", "c", "d"];
const found = (...ids: string[]) => new Set(ids);

describe("position", () => {
  it("starts at the route start", () => {
    expect(currentPoint(route, found()).node_id).toBe("entrance");
    expect(remainingDistance(route, found())).toBe(100);
  });

  it("moves to the last found stop", () => {
    expect(currentPoint(route, found("a")).node_id).toBe("n1");
    expect(remainingDistance(route, found("a"))).toBe(90);
  });

  it("stays on a shared node while its other stop is pending", () => {
    expect(currentPoint(route, found("a", "b")).node_id).toBe("n2");
    expect(pendingStops(route, found("a", "b")).map((s) => s.category_id)).toEqual(["c", "d"]);
  });

  it("keeps the leg to the checkout when everything is found", () => {
    const legs = remainingLegs(route, found("a", "b", "c", "d"));

    expect(legs).toHaveLength(1);
    expect(legs[0]?.to_node_id).toBe("checkout");
  });
});

describe("lastWalkedLeg", () => {
  it("is null until something is found", () => {
    expect(lastWalkedLeg(route, found())).toBeNull();
  });

  it("is the leg into the last found stop", () => {
    expect(lastWalkedLeg(route, found("a"))?.to_node_id).toBe("n1");
    expect(lastWalkedLeg(route, found("a", "b"))?.to_node_id).toBe("n2");
  });

  it("stays put for the second stop on a shared node", () => {
    expect(lastWalkedLeg(route, found("a", "b", "c"))).toBe(lastWalkedLeg(route, found("a", "b")));
  });

  it("is the leg into the final stop once the list is done", () => {
    expect(lastWalkedLeg(route, found("a", "b", "c", "d"))?.to_node_id).toBe("n3");
  });
});

describe("completesList", () => {
  it("is true for the one category left", () => {
    expect(completesList(categoryIds, found("a", "b", "c"), "d")).toBe(true);
  });

  it("doesn't care which one that is", () => {
    expect(completesList(categoryIds, found("b", "c", "d"), "a")).toBe(true);
  });

  it("is false while another is left", () => {
    expect(completesList(categoryIds, found("a", "b"), "d")).toBe(false);
  });

  it("is false when unticking", () => {
    expect(completesList(categoryIds, found("a", "b", "c", "d"), "d")).toBe(false);
  });

  it("is true for a list of one", () => {
    expect(completesList(["a"], found(), "a")).toBe(true);
  });
});

describe("distanceToNextStop", () => {
  it("is the next leg's length", () => {
    expect(distanceToNextStop(route, found())).toBe(10);
    expect(distanceToNextStop(route, found("a"))).toBe(20);
  });

  it("is zero when the next stop shares the shopper's node", () => {
    expect(distanceToNextStop(route, found("a", "b"))).toBe(0);
  });

  it("leads to the checkout when everything is found", () => {
    expect(distanceToNextStop(route, found("a", "b", "c", "d"))).toBe(40);
  });

  it("is unknown after an out-of-sequence tick, until the new route arrives", () => {
    expect(distanceToNextStop(route, found("d"))).toBeNull();
  });
});

describe("isNextStop", () => {
  it("accepts either stop on a shared node", () => {
    expect(isNextStop(route, found("a"), "b")).toBe(true);
    expect(isNextStop(route, found("a"), "c")).toBe(true);
  });

  it("rejects a stop further on", () => {
    expect(isNextStop(route, found(), "d")).toBe(false);
  });

  it("rejects a category that is not on the route", () => {
    expect(isNextStop(route, found(), "other")).toBe(false);
  });
});

describe("applyToggle", () => {
  const toggle = (current: Set<string>, categoryId: string, nodeId: string, routeIsStale = false) =>
    applyToggle({ route, found: current, categoryIds, categoryId, nodeId, routeIsStale });

  it("advances locally when the next stop is found", () => {
    const result = toggle(found(), "a", "n1");

    expect(result.replan).toBeNull();
    expect(result.found).toEqual(found("a"));
  });

  it("walks a whole list in order with no re-plan, ending on the way to the checkout", () => {
    let ticked: FoundSet = found();
    for (const { category_id, node_id } of route.stops) {
      const result = applyToggle({
        route,
        found: ticked,
        categoryIds,
        categoryId: category_id,
        nodeId: node_id,
        routeIsStale: false,
      });
      expect(result.replan).toBeNull();
      ticked = result.found;
    }
    expect(remainingLegs(route, ticked).map((leg) => leg.to_node_id)).toEqual(["checkout"]);
  });

  it("re-plans from the found item when it is out of sequence", () => {
    const result = toggle(found(), "d", "n3");

    expect(result.replan).toEqual({ category_ids: ["a", "b", "c"], start_node_id: "n3" });
  });

  it("always re-plans while the route is stale", () => {
    const result = toggle(found(), "a", "n1", true);

    expect(result.replan).toEqual({ category_ids: ["b", "c", "d"], start_node_id: "n1" });
  });

  it("still reaches the checkout when the last item is found on a stale route", () => {
    const result = toggle(found("a", "b", "c"), "d", "n3", true);

    expect(result.found).toEqual(found("a", "b", "c", "d"));
    expect(result.replan).toEqual({ category_ids: ["d"], start_node_id: "n3" });
  });

  it("puts an unticked item back and re-plans from where the shopper stands", () => {
    const result = toggle(found("a", "b"), "a", "n1");

    expect(result.found).toEqual(found("b"));
    expect(result.replan).toEqual({ category_ids: ["a", "c", "d"], start_node_id: "n2" });
  });
});

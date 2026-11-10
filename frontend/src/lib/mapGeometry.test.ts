import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { RouteLeg, RouteStop, StoreMap } from "../api/types";
import {
  buildMapLayout,
  fitZoneLabel,
  polylinePoints,
  stopPins,
  zoneElementId,
} from "./mapGeometry";

const map: StoreMap = {
  id: "demo",
  name: "demo",
  width_m: 20,
  height_m: 10,
  nodes: [
    { id: "entrance", x: 2, y: 0, type: "entrance" },
    { id: "checkout", x: 18, y: 0, type: "checkout" },
    { id: "a1", x: 5, y: 5, type: "section" },
    { id: "a2", x: 10, y: 5, type: "section" },
  ],
  edges: [
    { from_node: "entrance", to_node: "a1", length_m: 8 },
    { from_node: "a1", to_node: "a2", length_m: 5 },
    { from_node: "a2", to_node: "checkout", length_m: 13 },
  ],
  sections: [
    { id: "s1", node_id: "a1", aisle_no: 1, side: "left" },
    { id: "s2", node_id: "a2", aisle_no: 2, side: "right" },
  ],
  categories: [],
  product_stops: [],
};

const layout = buildMapLayout(map);

function stop(category_id: string, node: { x: number; y: number }, side: "left" | "right", leg_index: number) {
  return { category_id, ...node, side, leg_index } as RouteStop;
}

describe("buildMapLayout", () => {
  it("flips y so the store front is at the bottom", () => {
    expect(layout.toSvg({ x: 3, y: 0 })).toEqual({ x: 3, y: 10 });
    expect(layout.toSvg({ x: 3, y: 10 })).toEqual({ x: 3, y: 0 });
    expect(layout.entrance).toEqual({ x: 2, y: 10 });
  });

  it("draws a shelf on both sides of every aisle", () => {
    expect(layout.shelves).toHaveLength(3);
    expect(layout.shelves.map((shelf) => shelf.x + shelf.width / 2)).toEqual([2.5, 7.5, 12.5]);
  });

  it("keeps shelves clear of the aisle walkway", () => {
    for (const shelf of layout.shelves) {
      expect(shelf.x + shelf.width <= 5 || shelf.x >= 5).toBe(true);
      expect(shelf.x + shelf.width <= 10 || shelf.x >= 10).toBe(true);
    }
  });

  it("sizes the view around the floor and keeps room for labels", () => {
    expect(layout.viewBox).toBe("-0.3 -0.3 20.6 12.9");
  });

  it("numbers aisles in order", () => {
    expect(layout.aisleLabels.map((label) => label.aisleNo)).toEqual([1, 2]);
    expect(layout.aisleLabels.map((label) => label.x)).toEqual([5, 10]);
  });

  it("has one walkway per edge", () => {
    expect(layout.walkways).toHaveLength(map.edges.length);
  });
});

describe("polylinePoints", () => {
  it("joins legs without repeating the shared node and flips y", () => {
    const legs: RouteLeg[] = [
      {
        to_node_id: "a1",
        length_m: 8,
        points: [
          { node_id: "entrance", x: 2, y: 0 },
          { node_id: "a1", x: 5, y: 5 },
        ],
      },
      {
        to_node_id: "a2",
        length_m: 5,
        points: [
          { node_id: "a1", x: 5, y: 5 },
          { node_id: "a2", x: 10, y: 5 },
        ],
      },
    ];

    expect(polylinePoints(legs, layout)).toBe("2,10 5,5 10,5");
  });
});

describe("stopPins", () => {
  it("offsets pins toward their shelf side and numbers them in route order", () => {
    const pins = stopPins(
      [stop("a", { x: 5, y: 5 }, "left", 0), stop("b", { x: 10, y: 5 }, "right", 1)],
      layout,
    );

    expect(pins.map((pin) => pin.order)).toEqual([1, 2]);
    expect(pins[0]!.x).toBeLessThan(5);
    expect(pins[1]!.x).toBeGreaterThan(10);
  });

  it("marks every stop on the next leg as next", () => {
    const pins = stopPins(
      [
        stop("a", { x: 5, y: 5 }, "left", 1),
        stop("b", { x: 5, y: 5 }, "right", 1),
        stop("c", { x: 10, y: 5 }, "right", 2),
      ],
      layout,
    );

    expect(pins.map((pin) => pin.isNext)).toEqual([true, true, false]);
  });
});

describe("zones", () => {
  const demo = JSON.parse(
    readFileSync(resolve(__dirname, "../../../backend/app/data/demo_store.json"), "utf-8"),
  ) as StoreMap;
  const demoLayout = buildMapLayout(demo);
  const shape = (sectionId: string) =>
    demoLayout.zones.find((zone) => zone.elementId === zoneElementId(sectionId))!;

  it("draws one zone per section, each with its own DOM id", () => {
    expect(demoLayout.zones).toHaveLength(demo.sections.length);
    expect(new Set(demoLayout.zones.map((zone) => zone.elementId)).size).toBe(demo.sections.length);
  });

  it("uses the id the backend stores as svg_element_id", () => {
    expect(zoneElementId("a1-s2-l")).toBe("zone-a1-s2-l");
  });

  it("keeps every zone on a shelf", () => {
    for (const zone of demoLayout.zones) {
      const shelf = demoLayout.shelves.find(
        ({ x, width }) => zone.x >= x - 1e-9 && zone.x + zone.width <= x + width + 1e-9,
      );
      expect(shelf, zone.elementId).toBeDefined();
      expect(zone.y).toBeGreaterThanOrEqual(shelf!.y);
      expect(zone.y + zone.height).toBeLessThanOrEqual(shelf!.y + shelf!.height);
    }
  });

  it("puts each side of an aisle on the shelf that faces it", () => {
    const left = shape("a2-s1-l");
    const right = shape("a2-s1-r");
    const aisleX = 11;

    expect(left.x + left.width).toBeLessThan(aisleX);
    expect(right.x).toBeGreaterThan(aisleX);
  });

  it("gives back-to-back faces separate halves of a shelf", () => {
    const facesAisleOne = shape("a1-s1-r");
    const facesAisleTwo = shape("a2-s1-l");

    expect(facesAisleOne.x + facesAisleOne.width).toBeCloseTo(facesAisleTwo.x);
  });

  it("orders zones from the back of the store to the front on screen", () => {
    expect(shape("a1-s3-l").y).toBeLessThan(shape("a1-s2-l").y);
    expect(shape("a1-s2-l").y).toBeLessThan(shape("a1-s1-l").y);
  });

  it("never lets two zones overlap", () => {
    const overlaps = demoLayout.zones.flatMap((a) =>
      demoLayout.zones.filter(
        (b) =>
          a !== b &&
          a.x < b.x + b.width - 1e-9 &&
          b.x < a.x + a.width - 1e-9 &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height,
      ),
    );

    expect(overlaps).toEqual([]);
  });

  it("gives a lone section its whole shelf", () => {
    const [zone] = layout.zones;

    expect(zone!.height).toBeCloseTo(layout.shelves[0]!.height - 0.12);
  });
});

describe("fitZoneLabel", () => {
  const zoneLength = 4.88;

  it("keeps a short name at full size", () => {
    expect(fitZoneLabel("קפואים", zoneLength)).toEqual({ text: "קפואים", fontSize: 0.8 });
  });

  it("shrinks a long name instead of cutting it", () => {
    const label = fitZoneLabel("מוצרי חלב וביצים", zoneLength);

    expect(label.text).toBe("מוצרי חלב וביצים");
    expect(label.fontSize).toBeLessThan(0.8);
    expect(label.fontSize).toBeGreaterThanOrEqual(0.46);
  });

  it("shortens only what can't fit at the smallest size", () => {
    const label = fitZoneLabel("א".repeat(40), zoneLength);

    expect(label.text.endsWith("…")).toBe(true);
    expect(label.text.length).toBeLessThan(40);
    expect(label.fontSize).toBe(0.46);
  });
});

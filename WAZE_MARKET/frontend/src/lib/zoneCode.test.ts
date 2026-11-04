import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { StoreMap } from "../api/types";
import { categoryZoneCode, zoneCodes, zoneTone } from "./zoneCode";

const demo = JSON.parse(
  readFileSync(resolve(__dirname, "../../../backend/app/data/demo_store.json"), "utf-8"),
) as StoreMap;
const map: StoreMap = { ...demo, product_stops: [] };

describe("zoneCodes", () => {
  const codes = zoneCodes(map);

  it("numbers the aisle and letters the section from the front", () => {
    expect(codes.get("a2_s1")).toBe("2A");
    expect(codes.get("a2_s2")).toBe("2B");
    expect(codes.get("a2_s3")).toBe("2C");
  });

  it("gives every section node a code of its own", () => {
    const sectionNodes = new Set(map.sections.map((section) => section.node_id));
    const values = [...sectionNodes].map((nodeId) => codes.get(nodeId));
    expect(values.every(Boolean)).toBe(true);
    expect(new Set(values).size).toBe(sectionNodes.size);
  });

  it("goes past the letters that look like digits", () => {
    const long: StoreMap = {
      ...map,
      nodes: Array.from({ length: 10 }, (_, index) => ({ id: `n${index}`, x: 1, y: index, type: "section" })),
      sections: Array.from({ length: 10 }, (_, index) => ({
        id: `s${index}`,
        node_id: `n${index}`,
        aisle_no: 7,
        side: "left" as const,
      })),
    };
    const letters = [...zoneCodes(long).values()].map((code) => code.slice(1)).join("");
    expect(letters).toBe("ABCDEFGHJK");
  });
});

describe("categoryZoneCode", () => {
  const codes = zoneCodes(map);

  it("finds the shelf a department stands on", () => {
    const produce = map.categories.find((category) => category.id === "produce")!;
    const section = map.sections.find((entry) => entry.id === produce.section_id)!;
    expect(categoryZoneCode(map, codes, "produce")).toBe(codes.get(section.node_id));
  });

  it("finds a product a manager placed", () => {
    const placed: StoreMap = {
      ...map,
      product_stops: [{ id: "product-7", name: "x", name_en: "x", section_id: "a3-s3-r", aliases: [] }],
    };
    expect(categoryZoneCode(placed, codes, "product-7")).toBe("3C");
  });

  it("has nothing for a category the store doesn't have", () => {
    expect(categoryZoneCode(map, codes, "kombucha")).toBeNull();
  });
});

describe("zoneTone", () => {
  it("wraps round the three colours", () => {
    expect(zoneTone(0)).toBe("var(--color-zone-1)");
    expect(zoneTone(3)).toBe("var(--color-zone-1)");
  });
});

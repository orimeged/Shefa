import { describe, expect, it } from "vitest";

import type { CatalogProduct, FloorPlanCheck } from "../../api/types";
import { barcodeProblem, draftOf, filterCatalog, planShelves, shelfFor, shelvesOf } from "./catalog";

function check(departments: FloorPlanCheck["departments"], routable = true): FloorPlanCheck {
  return { routable, departments } as FloorPlanCheck;
}

const department = (label: string, category_id: string | null, extra: Partial<FloorPlanCheck["departments"][number]> = {}) =>
  ({ label, category_id, reachable: true, ...extra }) as FloorPlanCheck["departments"][number];

function product(fields: Partial<CatalogProduct>): CatalogProduct {
  return {
    id: 1,
    name: "חלב",
    barcode: null,
    brand: null,
    size: null,
    department: "dairy",
    subcategory: null,
    source: null,
    zones: 0,
    shelf: null,
    price_agorot: null,
    price_updated_at: null,
    ...fields,
  };
}

describe("planShelves", () => {
  it("lists the drawn shelves that stand for a department or one of its subcategories", () => {
    const shelves = planShelves(
      check([
        department("מוצרי חלב", "dairy"),
        department("פירות", "produce", { subcategory: "פירות" }),
        department("ירקות", "produce", { subcategory: "ירקות" }),
      ]),
    );
    expect(shelves).toEqual([
      { label: "מוצרי חלב", department: "dairy", subcategory: null },
      { label: "פירות", department: "produce", subcategory: "פירות" },
      { label: "ירקות", department: "produce", subcategory: "ירקות" },
    ]);
  });

  it("leaves out names matching nothing, shelves nobody can reach and a product's own shelf", () => {
    const shelves = planShelves(
      check([
        department("מחסן", null),
        department("מאפייה", "bakery", { reachable: false }),
        department("קוקה קולה", "product-7"),
      ]),
    );
    expect(shelves).toEqual([]);
  });

  it("has no shelves for a plan shoppers can't walk yet", () => {
    expect(planShelves(check([department("מוצרי חלב", "dairy")], false))).toEqual([]);
    expect(planShelves(null)).toEqual([]);
  });

  it("finds a department's shelves and the one a subcategory names", () => {
    const shelves = planShelves(
      check([department("פירות", "produce", { subcategory: "פירות" }), department("מוצרי חלב", "dairy")]),
    );
    expect(shelvesOf(shelves, "produce").map((shelf) => shelf.label)).toEqual(["פירות"]);
    expect(shelfFor(shelves, "produce", "פירות")?.label).toBe("פירות");
    expect(shelfFor(shelves, "produce", "ירקות")).toBeUndefined();
  });
});

describe("barcodeProblem", () => {
  it("accepts no barcode, and a correct one", () => {
    expect(barcodeProblem("")).toBe(false);
    expect(barcodeProblem("7290000000015")).toBe(false);
    expect(barcodeProblem("7290 0000 00015")).toBe(false);
    expect(barcodeProblem("12345678")).toBe(false);
  });

  it("refuses letters, the wrong length and a wrong check digit", () => {
    expect(barcodeProblem("12ab")).toBe(true);
    expect(barcodeProblem("1234567")).toBe(true);
    expect(barcodeProblem("7290000000016")).toBe(true);
  });
});

describe("filterCatalog", () => {
  const products = [
    product({ id: 1, name: "חלב תנובה 3%", barcode: "7290000000015", shelf: "מוצרי חלב" }),
    product({ id: 2, name: "תפוחי עץ", department: "produce", shelf: null }),
    product({ id: 3, name: "חלב סויה", department: "drinks", shelf: "משקאות" }),
  ];
  const ids = (filter: Parameters<typeof filterCatalog>[1]) => filterCatalog(products, filter).map((row) => row.id);

  it("matches every word typed, in the name or the barcode", () => {
    expect(ids({ query: "חלב", department: "", offMapOnly: false })).toEqual([1, 3]);
    expect(ids({ query: "חלב 3%", department: "", offMapOnly: false })).toEqual([1]);
    expect(ids({ query: "72900", department: "", offMapOnly: false })).toEqual([1]);
  });

  it("keeps one department, or only what isn't on the map", () => {
    expect(ids({ query: "", department: "drinks", offMapOnly: false })).toEqual([3]);
    expect(ids({ query: "", department: "", offMapOnly: true })).toEqual([2]);
  });
});

describe("draftOf", () => {
  it("opens an edit with every saved field, the price too, so saving never clears it", () => {
    const draft = draftOf(product({ name: "חלב 3%", barcode: "7290000002200", price_agorot: 710, subcategory: "חלב וביצים" }));
    expect(draft).toEqual({
      name: "חלב 3%",
      barcode: "7290000002200",
      brand: null,
      size: null,
      department: "dairy",
      subcategory: "חלב וביצים",
      price_agorot: 710,
    });
  });
});

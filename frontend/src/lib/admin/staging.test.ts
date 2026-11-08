import { describe, expect, it } from "vitest";

import type { CatalogCategory, DictatedItem } from "../../api/types";
import { isReadyToSave, stageItems, toBatch } from "./staging";

const categories: CatalogCategory[] = [
  { id: 1, slug: "snacks", name: "חטיפים", name_en: "Snacks" },
  { id: 2, slug: "dairy", name: "מוצרי חלב", name_en: "Dairy" },
];

function heard(normalized_name: string, inferred_category: string): DictatedItem {
  return { normalized_name, inferred_category };
}

describe("stageItems", () => {
  it("matches the inferred slug to the store's category", () => {
    const [row] = stageItems([], [heard("במבה", "snacks")], categories);

    expect(row).toMatchObject({ name: "במבה", categoryId: 1 });
  });

  it("leaves the category open when none fits", () => {
    const [row] = stageItems([], [heard("מברגה", "none")], categories);

    expect(row!.categoryId).toBeNull();
  });

  it("leaves the category open for a slug the store doesn't have", () => {
    const [row] = stageItems([], [heard("מברגה", "garden")], categories);

    expect(row!.categoryId).toBeNull();
  });

  it("adds a second recording to the first without repeating anything", () => {
    const first = stageItems([], [heard("במבה", "snacks")], categories);
    const second = stageItems(first, [heard(" במבה ", "snacks"), heard("קוטג", "dairy")], categories);

    expect(second.map((row) => row.name)).toEqual(["במבה", "קוטג"]);
  });

  it("keeps a manager's correction when more is heard", () => {
    const [row] = stageItems([], [heard("במבה", "snacks")], categories);
    const corrected = [{ ...row!, categoryId: 2 }];

    expect(stageItems(corrected, [heard("במבה", "snacks")], categories)[0]!.categoryId).toBe(2);
  });

  it("gives every row its own key", () => {
    const rows = stageItems([], [heard("א", "none"), heard("ב", "none")], categories);

    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
  });

  it("skips blank names", () => {
    expect(stageItems([], [heard("  ", "snacks")], categories)).toEqual([]);
  });
});

describe("isReadyToSave", () => {
  const ready = { key: "a", name: "במבה", categoryId: 1 };

  it("needs at least one row", () => {
    expect(isReadyToSave([])).toBe(false);
  });

  it("needs every row to have a category", () => {
    expect(isReadyToSave([ready, { ...ready, key: "b", categoryId: null }])).toBe(false);
  });

  it("needs every row to have a name", () => {
    expect(isReadyToSave([{ ...ready, name: "   " }])).toBe(false);
  });

  it("passes a complete list", () => {
    expect(isReadyToSave([ready])).toBe(true);
  });
});

describe("toBatch", () => {
  it("sends trimmed names with their categories", () => {
    expect(toBatch([{ key: "a", name: " במבה ", categoryId: 1 }])).toEqual([
      { name: "במבה", category_id: 1 },
    ]);
  });
});

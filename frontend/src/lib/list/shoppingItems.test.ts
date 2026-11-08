import { describe, expect, it } from "vitest";

import type { Category, ResolvedItem, SearchHit, StoreMap } from "../../api/types";
import type { ItemPlacement, ListItem } from "./shoppingItems";
import {
  appendItems,
  applyResolved,
  categoryIdsOf,
  groupByCategory,
  itemsFromCategories,
  matchedItem,
  pendingItem,
  withoutPlacement,
} from "./shoppingItems";

const dairy: ItemPlacement = {
  categoryId: "dairy",
  name: "מוצרי חלב",
  nameEn: "Dairy",
  aisleNo: 5,
  side: "right",
};

const hit = (categoryId: string): SearchHit => ({
  category_id: categoryId,
  category_name: categoryId,
  category_name_en: categoryId,
  aisle_no: 1,
  side: "left",
  matched_text: categoryId,
  score: 1,
});

const row = (line: number, text: string, categoryId: string | null): ResolvedItem => ({
  line,
  text,
  hit: categoryId ? hit(categoryId) : null,
  source: categoryId ? "catalog" : null,
  dictionary_id: null,
});

const pending = (text: string, query = text) => pendingItem({ text, query });

describe("applyResolved", () => {
  it("fills in a match and keeps the quantity the shopper wrote", () => {
    const item = pending('3 ק"ג עגבניות', "עגבניות");

    const [result] = applyResolved([item], [item], [row(0, "עגבניות", "produce")]);

    expect(result?.text).toBe('3 ק"ג עגבניות');
    expect(result?.status).toBe("matched");
    expect(result?.placement?.categoryId).toBe("produce");
  });

  it("marks an item the store doesn't have", () => {
    const item = pending("מברגה");

    const [result] = applyResolved([item], [item], [row(0, "מברגה", null)]);

    expect(result?.status).toBe("unmatched");
    expect(result?.placement).toBeNull();
  });

  it("splits a dictated line into its items", () => {
    const item = pending("חלב לחם");

    const result = applyResolved(
      [item],
      [item],
      [row(0, "חלב", "dairy"), row(0, "לחם", "bakery")],
    );

    expect(result.map((entry) => entry.text)).toEqual(["חלב", "לחם"]);
    expect(new Set(result.map((entry) => entry.id)).size).toBe(2);
  });

  it("leaves other items alone and keeps their order", () => {
    const before = matchedItem("קפה", { ...dairy, categoryId: "coffee" });
    const item = pending("חלב");
    const after = pending("לחם");

    const result = applyResolved(
      [before, item, after],
      [item],
      [row(0, "חלב", "dairy")],
    );

    expect(result.map((entry) => entry.text)).toEqual(["קפה", "חלב", "לחם"]);
    expect(result[2]?.status).toBe("pending");
  });

  it("skips items removed while the answer was on its way", () => {
    const item = pending("חלב");

    expect(applyResolved([], [item], [row(0, "חלב", "dairy")])).toEqual([]);
  });
});

describe("appendItems", () => {
  it("doesn't add what is already there", () => {
    const existing = pending("חלב");

    const result = appendItems([existing], [pending("חלב"), pending("לחם")]);

    expect(result.map((item) => item.query)).toEqual(["חלב", "לחם"]);
  });
});

describe("categories", () => {
  const items: ListItem[] = [
    matchedItem("חלב", dairy),
    matchedItem("קוטג'", dairy),
    pending("לחם"),
  ];

  it("lists each category once and skips unknown items", () => {
    expect(categoryIdsOf(items)).toEqual(["dairy"]);
  });

  it("groups the items of one stop", () => {
    expect(groupByCategory(items).get("dairy")?.itemTexts).toEqual(["חלב", "קוטג'"]);
  });

  it("doesn't repeat a name that is the category itself", () => {
    const groups = groupByCategory([matchedItem(dairy.name, dairy)]);

    expect(groups.get("dairy")?.itemTexts).toEqual([]);
  });
});

describe("trips and managers' changes", () => {
  const section = { id: "s1", node_id: "n1", aisle_no: 3, side: "left" as const };
  const stop: Category = {
    id: "product-7",
    name: "במבה",
    name_en: "במבה",
    section_id: "s1",
    aliases: [],
  };
  const map = { categories: [], product_stops: [stop], sections: [section] } as unknown as StoreMap;

  it("seeds a product stop handed over from the kiosk", () => {
    const [item] = itemsFromCategories(["product-7"], map);

    expect(item!.placement).toMatchObject({ categoryId: "product-7", aisleNo: 3 });
  });

  it("drops what the store no longer places when seeding", () => {
    expect(itemsFromCategories(["product-8"], map)).toEqual([]);
  });

  it("sends an item a manager took off the shelves back to needing a place", () => {
    const placed = matchedItem("חלב", dairy);
    const other = matchedItem("לחם", { ...dairy, categoryId: "bakery" });

    const [gone, kept] = withoutPlacement([placed, other], [dairy.categoryId]);

    expect(gone).toMatchObject({ status: "unmatched", placement: null, text: "חלב" });
    expect(kept).toBe(other);
  });
});

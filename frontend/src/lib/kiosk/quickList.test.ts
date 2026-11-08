import { describe, expect, it } from "vitest";

import type { Route, RouteStop } from "../../api/types";
import type { CartItem } from "../../components/kiosk/types";
import { addQuickItem, inRouteOrder, MAX_QUICK_ITEMS } from "./quickList";

function item(categoryId: string): CartItem {
  return { categoryId, name: categoryId, nameEn: categoryId, aisleNo: 1, side: "left", tone: 0 };
}

function routeThrough(...categoryIds: string[]): Route {
  return {
    stops: categoryIds.map((category_id, seq) => ({ category_id, seq }) as RouteStop),
  } as Route;
}

describe("addQuickItem colours", () => {
  it("gives each item a colour of its own", () => {
    const three = ["a", "b", "c"].reduce((list, id) => addQuickItem(list, item(id)), [] as readonly CartItem[]);
    expect(three.map((entry) => entry.tone)).toEqual([0, 1, 2]);
  });

  it("keeps colours where they are when one item goes", () => {
    const three = ["a", "b", "c"].reduce((list, id) => addQuickItem(list, item(id)), [] as readonly CartItem[]);
    const withoutB = three.filter((entry) => entry.categoryId !== "b");
    const next = addQuickItem(withoutB, item("d"));
    expect(next.map((entry) => [entry.categoryId, entry.tone])).toEqual([
      ["a", 0],
      ["c", 2],
      ["d", 1],
    ]);
  });
});

describe("addQuickItem", () => {
  it("adds an item", () => {
    expect(addQuickItem([], item("dairy")).map((entry) => entry.categoryId)).toEqual(["dairy"]);
  });

  it("doesn't list the same item twice", () => {
    const items = addQuickItem([item("dairy")], item("dairy"));

    expect(items).toHaveLength(1);
  });

  it("stops at the limit", () => {
    const full = [item("a"), item("b"), item("c")];

    expect(full).toHaveLength(MAX_QUICK_ITEMS);
    expect(addQuickItem(full, item("d"))).toBe(full);
  });
});

describe("inRouteOrder", () => {
  it("follows the walk, not the order items were picked", () => {
    const ordered = inRouteOrder([item("a"), item("b")], routeThrough("b", "a"));

    expect(ordered.map((entry) => entry.categoryId)).toEqual(["b", "a"]);
  });

  it("keeps the picking order until there's a route", () => {
    const ordered = inRouteOrder([item("a"), item("b")], null);

    expect(ordered.map((entry) => entry.categoryId)).toEqual(["a", "b"]);
  });

  it("puts anything the route left out last", () => {
    const ordered = inRouteOrder([item("gone"), item("a")], routeThrough("a"));

    expect(ordered.map((entry) => entry.categoryId)).toEqual(["a", "gone"]);
  });
});

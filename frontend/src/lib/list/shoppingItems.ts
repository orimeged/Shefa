/** The shopper's list. Routing works on categories, so items group under them. */

import type { Category, ResolvedItem, SearchHit, Side, StoreMap } from "../../api/types";
import type { ParsedItem } from "./parseList";

export interface ItemPlacement {
  categoryId: string;
  name: string;
  nameEn: string;
  aisleNo: number;
  side: Side;
}

export interface ListItem {
  id: string;
  text: string;
  query: string;
  status: "pending" | "matched" | "unmatched";
  placement: ItemPlacement | null;
  /** The shopper got to the shelf and it wasn't there. */
  missing?: boolean;
}

/** One stop on the list, with the items the shopper wrote for it. */
export interface ListGroup extends ItemPlacement {
  itemTexts: string[];
  /** Still being looked for here. */
  items: ListItem[];
  missing: ListItem[];
}

let nextId = 0;

// Not crypto.randomUUID: it doesn't exist on plain HTTP, and the demo can run there.
function newId(): string {
  nextId += 1;
  return `${Date.now().toString(36)}-${nextId}`;
}

export function placementOfHit(hit: SearchHit): ItemPlacement {
  return {
    categoryId: hit.category_id,
    name: hit.category_name,
    nameEn: hit.category_name_en,
    aisleNo: hit.aisle_no,
    side: hit.side,
  };
}

export function placementOfCategory(category: Category, map: StoreMap): ItemPlacement | null {
  const section = map.sections.find((candidate) => candidate.id === category.section_id);
  return section
    ? {
        categoryId: category.id,
        name: category.name,
        nameEn: category.name_en,
        aisleNo: section.aisle_no,
        side: section.side,
      }
    : null;
}

export function pendingItem({ text, query }: ParsedItem): ListItem {
  return { id: newId(), text, query, status: "pending", placement: null };
}

export function matchedItem(text: string, placement: ItemPlacement): ListItem {
  return { id: newId(), text, query: text, status: "matched", placement };
}

export function itemsFromCategories(categoryIds: readonly string[], map: StoreMap): ListItem[] {
  const targets = [...map.categories, ...map.product_stops];
  return categoryIds.flatMap((id) => {
    const category = targets.find((candidate) => candidate.id === id);
    const placement = category && placementOfCategory(category, map);
    return placement ? [matchedItem(placement.name, placement)] : [];
  });
}

/** Adds `fresh`, skipping anything already on the list. */
export function appendItems(items: readonly ListItem[], fresh: readonly ListItem[]): ListItem[] {
  const known = new Set(items.map((item) => item.query));
  return [...items, ...fresh.filter((item) => !known.has(item.query))];
}

/** Applies the backend's answer. One line can become several items, as dictation does. */
export function applyResolved(
  items: readonly ListItem[],
  batch: readonly ListItem[],
  resolved: readonly ResolvedItem[],
): ListItem[] {
  const lineOf = new Map(batch.map((item, line) => [item.id, line]));

  return items.flatMap((item) => {
    const line = lineOf.get(item.id);
    if (line === undefined) {
      return [item];
    }
    const rows = resolved.filter((row) => row.line === line);
    if (rows.length <= 1) {
      const hit = rows[0]?.hit ?? null;
      return [{ ...item, ...statusOf(hit) }];
    }
    return rows.map((row) => ({
      id: newId(),
      text: row.text,
      query: row.text,
      ...statusOf(row.hit),
    }));
  });
}

/** What a manager took off the shelves during the trip goes back to needing a place. */
export function withoutPlacement(
  items: readonly ListItem[],
  categoryIds: readonly string[],
): ListItem[] {
  const gone = new Set(categoryIds);
  return items.map((item) =>
    item.placement && gone.has(item.placement.categoryId)
      ? { ...item, status: "unmatched", placement: null }
      : item,
  );
}

function statusOf(hit: SearchHit | null): Pick<ListItem, "status" | "placement"> {
  return hit
    ? { status: "matched", placement: placementOfHit(hit) }
    : { status: "unmatched", placement: null };
}

export function categoryIdsOf(items: readonly ListItem[]): string[] {
  return [...new Set(items.flatMap((item) => item.placement?.categoryId ?? []))];
}

export function groupByCategory(items: readonly ListItem[]): Map<string, ListGroup> {
  const groups = new Map<string, ListGroup>();
  for (const item of items) {
    if (!item.placement) {
      continue;
    }
    const group = groups.get(item.placement.categoryId) ?? {
      ...item.placement,
      itemTexts: [],
      items: [],
      missing: [],
    };
    if (item.missing) {
      group.missing.push(item);
    } else {
      group.items.push(item);
      if (item.text !== item.placement.name) {
        group.itemTexts.push(item.text);
      }
    }
    groups.set(item.placement.categoryId, group);
  }
  return groups;
}

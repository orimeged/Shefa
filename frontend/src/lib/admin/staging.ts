/** The review list: what was heard, before a manager approves it. */

import type { CatalogCategory, DictatedItem, StagedItem } from "../../api/types";

export interface StagedRow {
  key: string;
  name: string;
  /** Null until a manager picks one, when the guess wasn't a known category. */
  categoryId: number | null;
}

let nextKey = 0;

function comparable(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/** Adds what was just heard, so a second recording extends the first. */
export function stageItems(
  rows: readonly StagedRow[],
  items: readonly DictatedItem[],
  categories: readonly CatalogCategory[],
): StagedRow[] {
  const known = new Set(rows.map((row) => comparable(row.name)));
  const next = [...rows];
  for (const item of items) {
    const name = comparable(item.normalized_name);
    if (name && !known.has(name)) {
      known.add(name);
      nextKey += 1;
      next.push({
        key: `staged-${nextKey}`,
        name: item.normalized_name,
        categoryId:
          categories.find((category) => category.slug === item.inferred_category)?.id ?? null,
      });
    }
  }
  return next;
}

export function isReadyToSave(rows: readonly StagedRow[]): boolean {
  return (
    rows.length > 0 && rows.every((row) => row.name.trim() !== "" && row.categoryId !== null)
  );
}

export function toBatch(rows: readonly StagedRow[]): StagedItem[] {
  return rows.map((row) => ({ name: row.name.trim(), category_id: row.categoryId! }));
}

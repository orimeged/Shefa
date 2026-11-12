/**
 * The catalog screen's rules: which shelves a product can stand on, and what a
 * barcode must look like. A drawn plan's shelf is a department or one of its
 * subcategories; a product placed on a subcategory's shelf is routed to exactly it.
 */

import type { CatalogProduct, FloorPlanCheck } from "../../api/types";

export interface ShelfOption {
  /** The shelf's name on the plan. */
  label: string;
  /** The department it belongs to. */
  department: string;
  /** What a product on it stores as its subcategory: null for the department's own shelf. */
  subcategory: string | null;
}

/** The plan's shelves a product can be put on: reachable, and standing for a department or one of its parts. */
export function planShelves(check: FloorPlanCheck | null | undefined): ShelfOption[] {
  if (!check?.routable) {
    return [];
  }
  return check.departments.flatMap((department) =>
    department.reachable && department.category_id && !department.category_id.startsWith("product-")
      ? [{ label: department.label, department: department.category_id, subcategory: department.subcategory ?? null }]
      : [],
  );
}

export function shelvesOf(shelves: readonly ShelfOption[], department: string): ShelfOption[] {
  return shelves.filter((shelf) => shelf.department === department);
}

/** The shelf a product's subcategory names in its department, if the plan has one. */
export function shelfFor(shelves: readonly ShelfOption[], department: string, subcategory: string | null): ShelfOption | undefined {
  return shelvesOf(shelves, department).find((shelf) => shelf.subcategory === subcategory);
}

/** Digits only, 8 to 14 of them; and a correct check digit when there are 13, as on Israeli products. */
export function barcodeProblem(raw: string): boolean {
  const barcode = raw.replace(/\s+/g, "");
  if (barcode === "") {
    return false;
  }
  if (!/^\d{8,14}$/.test(barcode)) {
    return true;
  }
  if (barcode.length !== 13) {
    return false;
  }
  const digits = [...barcode].map(Number);
  const sum = digits.slice(0, 12).reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 !== digits[12];
}

export interface CatalogFilter {
  query: string;
  department: string;
  offMapOnly: boolean;
}

/** The products a filter keeps: matching the name or barcode typed, in the department chosen. */
export function filterCatalog(products: readonly CatalogProduct[], { query, department, offMapOnly }: CatalogFilter): CatalogProduct[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return products.filter(
    (product) =>
      (!department || product.department === department) &&
      (!offMapOnly || product.shelf === null) &&
      words.every((word) => product.name.toLowerCase().includes(word) || (product.barcode ?? "").includes(word)),
  );
}

/** The few items someone looks up at the entrance without scanning. */

import type { Route } from "../../api/types";
import type { CartItem, NewCartItem } from "../../components/kiosk/types";

/** Past this, the list belongs on the shopper's phone, not on a shared screen. */
export const MAX_QUICK_ITEMS = 3;

/**
 * Adds an item in the first colour free. A colour stays with its item, so
 * removing one never repaints the others between the list and the map.
 */
export function addQuickItem(items: readonly CartItem[], item: NewCartItem): readonly CartItem[] {
  const isListed = items.some((existing) => existing.categoryId === item.categoryId);
  if (isListed || items.length >= MAX_QUICK_ITEMS) {
    return items;
  }
  const taken = new Set(items.map((existing) => existing.tone));
  const tone = Array.from({ length: MAX_QUICK_ITEMS }, (_, slot) => slot).find((slot) => !taken.has(slot))!;
  return [...items, { ...item, tone }];
}

/** Walking order, which is the order the pins are met on the map. */
export function inRouteOrder(items: readonly CartItem[], route: Route | null): CartItem[] {
  const seq = new Map(route?.stops.map((stop) => [stop.category_id, stop.seq]));
  const position = (item: CartItem) => seq.get(item.categoryId) ?? Number.MAX_SAFE_INTEGER;
  return [...items].sort((a, b) => position(a) - position(b));
}

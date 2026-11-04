/**
 * Short shelf codes a shopper can read off a sign or a screen: the aisle's
 * number, as the map labels it, then the section's letter counted from the
 * front of the store. "2B" is the middle of aisle 2. Both sides of an aisle
 * share a code, and the side is given in words next to it.
 */

import type { StoreMap } from "../api/types";

/** No I or O, which read as 1 and 0 next to a number. */
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Each section node's code. */
export function zoneCodes(map: StoreMap): Map<string, string> {
  const nodes = new Map(map.nodes.map((node) => [node.id, node]));
  const byAisle = new Map<number, Set<string>>();
  for (const section of map.sections) {
    byAisle.set(section.aisle_no, (byAisle.get(section.aisle_no) ?? new Set()).add(section.node_id));
  }

  const codes = new Map<string, string>();
  for (const [aisleNo, nodeIds] of byAisle) {
    // The entrance is at y = 0, so the front of an aisle is its lowest y.
    [...nodeIds]
      .sort((a, b) => nodes.get(a)!.y - nodes.get(b)!.y)
      .forEach((nodeId, index) => codes.set(nodeId, `${aisleNo}${LETTERS[index] ?? index + 1}`));
  }
  return codes;
}

/** The code of the shelf a department, or a product a manager placed, stands on. */
export function categoryZoneCode(
  map: StoreMap,
  codes: ReadonlyMap<string, string>,
  categoryId: string,
): string | null {
  const category = [...map.product_stops, ...map.categories].find((entry) => entry.id === categoryId);
  const section = category && map.sections.find((entry) => entry.id === category.section_id);
  return section ? (codes.get(section.node_id) ?? null) : null;
}

/** Badge colours, one per item on the kiosk. Checked for colour blindness as a set of three. */
export const ZONE_TONE_COUNT = 3;

export function zoneTone(tone: number): string {
  return `var(--color-zone-${(tone % ZONE_TONE_COUNT) + 1})`;
}

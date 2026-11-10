/**
 * How a drawn plan's departments look on the map: each its own soft colour, so a
 * shopper can tell the dairy shelves from the bakery's at a glance, and quiet
 * enough that the route's green and the next station's orange stay loudest.
 */

/** A raised block's colours: its top, its side, and an accent for its badge. */
export interface BlockColours {
  top: string;
  side: string;
  accent: string;
}

/** In order of use. Muted on purpose; no green or orange, which the route and the next station own. */
export const DEPARTMENT_COLOURS: readonly BlockColours[] = [
  { top: "#cfe0f3", side: "#9db8d9", accent: "#3b6aa0" },
  { top: "#ddd6f3", side: "#b2a6dc", accent: "#6a55b5" },
  { top: "#f3d6dc", side: "#d9a3ae", accent: "#b04a5e" },
  { top: "#efe2c8", side: "#d1bb91", accent: "#8f6b2e" },
  { top: "#cfeceb", side: "#96cdca", accent: "#2e8580" },
  { top: "#ead5ea", side: "#c9a3c9", accent: "#8f4f8f" },
  { top: "#d5dbe7", side: "#a3aec4", accent: "#4f5d7a" },
  { top: "#f3ecc3", side: "#d8cc8a", accent: "#8a7a25" },
  { top: "#d3e3e8", side: "#9fbcc6", accent: "#3f6f7f" },
  { top: "#e6dccf", side: "#c3b29b", accent: "#7a6248" },
];

/** A shelf with no department, and every shelf on the graph's map. */
export const PLAIN_SHELF: BlockColours = { top: "#e9e5da", side: "#c6bfad", accent: "#6b6458" };
export const WALL: BlockColours = { top: "#4b5563", side: "#1f2937", accent: "#1f2937" };
export const TILL: BlockColours = { top: "#dbeafe", side: "#93c5fd", accent: "#1d4ed8" };

/**
 * A colour for each department, by the order they first appear in: the same
 * plan always looks the same, and adding a department never repaints the rest.
 * Past the palette's end the colours come round again.
 */
export function departmentColours(labelsInOrder: readonly string[]): ReadonlyMap<string, BlockColours> {
  const colours = new Map<string, BlockColours>();
  for (const label of labelsInOrder) {
    if (!colours.has(label)) {
      colours.set(label, DEPARTMENT_COLOURS[colours.size % DEPARTMENT_COLOURS.length]!);
    }
  }
  return colours;
}

/**
 * The category each drawn department stands for, for its icon. Placements map
 * a category to the department it was put in; a department holding several
 * takes the first that has an icon of its own.
 */
export function departmentCategories(
  placements: Readonly<Record<string, string>>,
  hasIcon: (categoryId: string) => boolean,
): ReadonlyMap<string, string> {
  const chosen = new Map<string, string>();
  for (const [categoryId, label] of Object.entries(placements)) {
    const current = chosen.get(label);
    if (current === undefined || (!hasIcon(current) && hasIcon(categoryId))) {
      chosen.set(label, categoryId);
    }
  }
  return chosen;
}

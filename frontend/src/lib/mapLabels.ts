/**
 * Where department badges go. Badges keep their size on screen at any zoom, so
 * zoomed out they would pile up, and zoomed in a shelf's middle may be off
 * screen. Each badge has places it could go, best first, such as the visible
 * part of each of its shelves; the important badges are placed first, each at
 * its first place that's on screen and clear of the badges already placed and
 * of the markers. A badge with no room in full gets its icon alone, if that
 * fits; one with no place at all waits until the camera moves.
 */

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenBox extends ScreenPoint {
  /** `x` and `y` are its middle, in screen pixels. */
  width: number;
  height: number;
}

export interface Placeable {
  key: string;
  /** Higher goes first: the next station's department before the rest. */
  priority: number;
  width: number;
  height: number;
  /** Its icon alone, square, for where the full badge doesn't fit. */
  compactSize?: number;
  /** Where its middle could go, best first. */
  candidates: readonly ScreenPoint[];
}

export interface Placement extends ScreenPoint {
  /** Its icon alone. */
  compact: boolean;
}

/** Clear space kept around a badge, in pixels. */
const GAP_PX = 3;

function overlaps(a: ScreenBox, b: ScreenBox): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.width + b.width + 2 * GAP_PX &&
    Math.abs(a.y - b.y) * 2 < a.height + b.height + 2 * GAP_PX
  );
}

/**
 * Each badge that fits, and where. Every department first gets its icon, the
 * most important first, each at its first candidate on screen and clear of the
 * icons before it and of `obstacles`: so none goes unmarked for want of room
 * taken by another's name. Then each, in the same order, grows into its full
 * badge wherever that fits among the rest. A badge with no compact form is
 * placed full from the start.
 */
export function placeBadges(
  badges: readonly Placeable[],
  obstacles: readonly ScreenBox[],
  screen: { width: number; height: number },
): Map<string, Placement> {
  const order = badges
    .map((badge, index) => ({ badge, index }))
    .sort((a, b) => b.badge.priority - a.badge.priority || a.index - b.index)
    .map(({ badge }) => badge);
  const boxes = new Map<string, ScreenBox>();
  const chosen = new Map<string, Placement>();
  const fits = (box: ScreenBox, key: string) =>
    box.x - box.width / 2 >= 0 &&
    box.x + box.width / 2 <= screen.width &&
    box.y - box.height / 2 >= 0 &&
    box.y + box.height / 2 <= screen.height &&
    !obstacles.some((other) => overlaps(box, other)) &&
    ![...boxes].some(([other, placed]) => other !== key && overlaps(box, placed));
  const tryAt = (badge: Placeable, points: readonly ScreenPoint[], width: number, height: number, compact: boolean) => {
    for (const point of points) {
      const box = { ...point, width, height };
      if (fits(box, badge.key)) {
        boxes.set(badge.key, box);
        chosen.set(badge.key, { ...point, compact });
        return true;
      }
    }
    return false;
  };

  for (const badge of order) {
    const size = badge.compactSize;
    tryAt(badge, badge.candidates, size ?? badge.width, size ?? badge.height, size !== undefined);
  }
  for (const badge of order) {
    const icon = chosen.get(badge.key);
    if (icon?.compact) {
      // Where its icon is first, so a name grows in place when it can.
      tryAt(badge, [icon, ...badge.candidates.filter((point) => point.x !== icon.x || point.y !== icon.y)], badge.width, badge.height, false);
    }
  }
  return chosen;
}

/** About how wide a badge is: an icon, the name at 11 px, and padding. */
export function badgeWidth(text: string): number {
  return 26 + text.length * 6.4 + 10;
}

export const BADGE_HEIGHT_PX = 22;
/** A badge's icon alone, with its white ring. */
export const COMPACT_BADGE_PX = 18;

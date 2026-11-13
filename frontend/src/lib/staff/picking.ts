/**
 * An online order turned into a picking walk: its lines matched to the store's
 * shelves, in the order a route passes them.
 */

import type { ResolvedItem, Route } from "../../api/types";
import type { ParsedItem } from "../list/parseList";

export type LineState = "todo" | "picked" | "missing";

export interface PickLine {
  key: string;
  /** As the order wrote it, quantity included. */
  text: string;
  query: string;
  /** Where the store keeps it; null when nothing matched. */
  categoryId: string | null;
  state: LineState;
}

export interface PickStop {
  categoryId: string;
  /** The drawn shelf, or the department on a store without one. */
  title: string;
  x: number;
  y: number;
  lines: PickLine[];
}

export interface PickWalk {
  stops: PickStop[];
  /** Lines with no place on the map: unmatched, or matched to nothing drawn. */
  elsewhere: PickLine[];
}

/** Each order line with what the store's search matched it to, by its position in the order. */
export function pickLines(parsed: readonly ParsedItem[], resolved: readonly ResolvedItem[]): PickLine[] {
  const byLine = new Map(resolved.map((item) => [item.line, item]));
  return parsed.map((item, index) => ({
    key: `${index}:${item.query}`,
    text: item.text,
    query: item.query,
    categoryId: byLine.get(index)?.hit?.category_id ?? null,
    state: "todo",
  }));
}

/** The lines under the stops of a route, in walking order; whatever it doesn't reach, last. */
export function pickWalk(lines: readonly PickLine[], route: Route): PickWalk {
  const placed = new Set<string>();
  const stops = route.stops.map((stop) => {
    const here = lines.filter((line) => line.categoryId === stop.category_id);
    here.forEach((line) => placed.add(line.key));
    return {
      categoryId: stop.category_id,
      title: stop.department ?? stop.category_name,
      x: stop.x,
      y: stop.y,
      lines: here,
    };
  });
  return {
    stops: stops.filter((stop) => stop.lines.length > 0),
    elsewhere: lines.filter((line) => !placed.has(line.key)),
  };
}

export function walkLines(walk: PickWalk): PickLine[] {
  return [...walk.stops.flatMap((stop) => stop.lines), ...walk.elsewhere];
}

/** The same walk with one line's state changed. */
export function withLineState(walk: PickWalk, key: string, state: LineState): PickWalk {
  const change = (line: PickLine) => (line.key === key ? { ...line, state } : line);
  return {
    stops: walk.stops.map((stop) => ({ ...stop, lines: stop.lines.map(change) })),
    elsewhere: walk.elsewhere.map(change),
  };
}

export function pickProgress(walk: PickWalk) {
  const lines = walkLines(walk);
  return {
    total: lines.length,
    picked: lines.filter((line) => line.state === "picked").length,
    missing: lines.filter((line) => line.state === "missing").length,
    left: lines.filter((line) => line.state === "todo").length,
  };
}

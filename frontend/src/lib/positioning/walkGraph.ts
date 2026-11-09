/** The store's walkable paths as geometry: where a shopper can be, and how they connect. */

import type { StoreMap } from "../../api/types";
import type { Point } from "../mapGeometry";
import { bearingBetween } from "./angles";

export interface WalkableNode extends Point {
  id: string;
}

export interface WalkableEdge {
  from: WalkableNode;
  to: WalkableNode;
  /**
   * Runs along a shelf, so walking it means walking straight beside one, which
   * is what lets the gyroscope's drift be taken out. True unless said otherwise:
   * every edge of the graph's map is an aisle. A drawn plan's open floor isn't.
   */
  guides?: boolean;
}

/** A spot on an edge, `along` metres from its `from` node. */
export interface GraphPosition {
  edge: number;
  along: number;
}

/** The stretch of an edge a walker can reach. */
export interface Span {
  edge: number;
  fromAlong: number;
  toAlong: number;
}

interface Segment extends WalkableEdge {
  length: number;
  /** Bearing from `from` to `to`. */
  bearing: number;
  key: string;
}

/** Past this many edges, `nearest` looks only near the point instead of at every edge. */
const INDEX_FROM_EDGES = 200;

/** The same stretch of floor whichever end is named first. */
export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function toWalkableEdges(map: StoreMap): WalkableEdge[] {
  const nodes = new Map(map.nodes.map((node) => [node.id, node]));
  return map.edges.flatMap((edge) => {
    const from = nodes.get(edge.from_node);
    const to = nodes.get(edge.to_node);
    return from && to ? [{ from, to }] : [];
  });
}

interface Reached {
  walked: number;
  /** The node before this one on the shortest walk, or null straight off the start's edge. */
  previous: string | null;
}

interface Queued extends Reached {
  nodeId: string;
}

/** A binary heap by distance walked: a drawn plan's graph is too big to sort per step. */
class WalkQueue {
  private readonly items: Queued[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: Queued): void {
    const items = this.items;
    items.push(item);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent]!.walked <= item.walked) {
        break;
      }
      items[index] = items[parent]!;
      index = parent;
    }
    items[index] = item;
  }

  pop(): Queued {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        if (left >= items.length) {
          break;
        }
        const right = left + 1;
        const child = right < items.length && items[right]!.walked < items[left]!.walked ? right : left;
        if (items[child]!.walked >= last.walked) {
          break;
        }
        items[index] = items[child]!;
        index = child;
      }
      items[index] = last;
    }
    return top;
  }
}

/** Edges by the square metres they cross, so a fix is matched against its neighbourhood only. */
class EdgeIndex {
  private readonly cells = new Map<string, number[]>();
  readonly size: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly spanCells: number;

  constructor(segments: readonly Segment[]) {
    const lengths = segments.map((segment) => segment.length).filter((length) => length > 0);
    const typical = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 1;
    this.size = Math.max(0.5, typical * 2);
    const xs = segments.flatMap((s) => [s.from.x, s.to.x]);
    const ys = segments.flatMap((s) => [s.from.y, s.to.y]);
    this.minX = Math.min(...xs);
    this.minY = Math.min(...ys);
    this.spanCells =
      Math.ceil(Math.max(Math.max(...xs) - this.minX, Math.max(...ys) - this.minY) / this.size) + 1;
    segments.forEach((segment, edge) => {
      const [x0, x1] = [segment.from.x, segment.to.x].sort((a, b) => a - b);
      const [y0, y1] = [segment.from.y, segment.to.y].sort((a, b) => a - b);
      for (let cx = this.cellX(x0!); cx <= this.cellX(x1!); cx++) {
        for (let cy = this.cellY(y0!); cy <= this.cellY(y1!); cy++) {
          const key = `${cx},${cy}`;
          const bucket = this.cells.get(key);
          if (bucket) {
            bucket.push(edge);
          } else {
            this.cells.set(key, [edge]);
          }
        }
      }
    });
  }

  cellX(x: number): number {
    return Math.floor((x - this.minX) / this.size);
  }

  cellY(y: number): number {
    return Math.floor((y - this.minY) / this.size);
  }

  /** Edges in the ring of cells `ring` away from the point's cell (0 is its own cell). */
  ring(point: Point, ring: number): number[] {
    const cx = this.cellX(point.x);
    const cy = this.cellY(point.y);
    const found: number[] = [];
    for (let x = cx - ring; x <= cx + ring; x++) {
      for (let y = cy - ring; y <= cy + ring; y++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) === ring) {
          found.push(...(this.cells.get(`${x},${y}`) ?? []));
        }
      }
    }
    return found;
  }

  /** Enough rings to cover the whole graph from anywhere near it. */
  get maxRing(): number {
    return this.spanCells * 2 + 2;
  }
}

export class WalkGraph {
  private readonly segments: readonly Segment[];
  private readonly incident = new Map<string, number[]>();
  private readonly nodes = new Map<string, WalkableNode>();
  private readonly index: EdgeIndex | null;

  constructor(edges: readonly WalkableEdge[]) {
    this.segments = edges.map((edge) => ({
      ...edge,
      length: Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y),
      bearing: bearingBetween(edge.from, edge.to),
      key: edgeKey(edge.from.id, edge.to.id),
    }));
    this.segments.forEach((segment, index) => {
      this.nodes.set(segment.from.id, segment.from);
      this.nodes.set(segment.to.id, segment.to);
      for (const nodeId of [segment.from.id, segment.to.id]) {
        const incident = this.incident.get(nodeId);
        if (incident) {
          incident.push(index);
        } else {
          this.incident.set(nodeId, [index]);
        }
      }
    });
    this.index = this.segments.length > INDEX_FROM_EDGES ? new EdgeIndex(this.segments) : null;
  }

  /** Whether walking this edge means walking straight beside a shelf. */
  guides(edge: number): boolean {
    return this.segments[edge]!.guides ?? true;
  }

  /** The edge's stretch of floor, named the same whichever way it was walked. */
  keyOf(edge: number): string {
    return this.segments[edge]!.key;
  }

  /** The node closest to `point`, which is where a route can be re-planned from. */
  nearestNodeId(point: Point): string | null {
    const { edge, along } = this.nearest(point);
    const segment = this.segments[edge];
    if (!segment) {
      return null;
    }
    return along <= segment.length / 2 ? segment.from.id : segment.to.id;
  }

  bearingOf(edge: number): number {
    return this.segments[edge]!.bearing;
  }

  pointAt({ edge, along }: GraphPosition): Point {
    const { from, to, length } = this.segments[edge]!;
    const share = length === 0 ? 0 : along / length;
    return { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share };
  }

  /** The closest point of the edge to `point`, limited to `span`. */
  project(point: Point, { edge, fromAlong, toAlong }: Span): GraphPosition {
    const { from, to, length } = this.segments[edge]!;
    const along =
      length === 0
        ? 0
        : ((point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y)) / length;
    return { edge, along: Math.min(toAlong, Math.max(fromAlong, along)) };
  }

  /**
   * The closest spot in the whole graph, for fixes that come from outside the walk.
   * Ties go to the lowest edge, so the answer doesn't depend on how it was found.
   */
  nearest(point: Point): GraphPosition {
    let best: GraphPosition = { edge: 0, along: 0 };
    let bestDistance = Number.POSITIVE_INFINITY;
    const consider = (edge: number) => {
      const segment = this.segments[edge]!;
      const candidate = this.project(point, { edge, fromAlong: 0, toAlong: segment.length });
      const spot = this.pointAt(candidate);
      const distance = Math.hypot(spot.x - point.x, spot.y - point.y);
      if (distance < bestDistance - 1e-12 || (Math.abs(distance - bestDistance) <= 1e-12 && edge < best.edge)) {
        best = candidate;
        bestDistance = distance;
      }
    };

    const index = this.index;
    if (!index) {
      this.segments.forEach((_, edge) => consider(edge));
      return best;
    }
    // Ring by ring outwards. An edge first met in ring r+1 is at least r cells away.
    for (let ring = 0; ring <= index.maxRing; ring++) {
      index.ring(point, ring).forEach(consider);
      if (bestDistance <= ring * index.size) {
        return best;
      }
    }
    // Far outside the graph: look at everything.
    this.segments.forEach((_, edge) => consider(edge));
    return best;
  }

  /** The bearing of the way out of a node, for an entrance with a single path in. */
  bearingOutOf(point: Point): number {
    const { edge, along } = this.nearest(point);
    const { bearing, length } = this.segments[edge]!;
    return along > length / 2 ? (bearing + 180) % 360 : bearing;
  }

  /** Everything a walker can reach from `start` within `budget` metres along the paths. */
  reachable(start: GraphPosition, budget: number): Span[] {
    const { length } = this.segments[start.edge]!;
    const spans = new Map<number, Span>();
    const addSpan = (edge: number, fromAlong: number, toAlong: number) => {
      const known = spans.get(edge);
      spans.set(edge, {
        edge,
        fromAlong: Math.min(fromAlong, known?.fromAlong ?? fromAlong),
        toAlong: Math.max(toAlong, known?.toAlong ?? toAlong),
      });
    };

    addSpan(start.edge, Math.max(0, start.along - budget), Math.min(length, start.along + budget));

    for (const [nodeId, walked] of this.walkedTo(start, budget)) {
      const remaining = budget - walked;
      for (const edge of this.incident.get(nodeId) ?? []) {
        const segment = this.segments[edge]!;
        if (segment.from.id === nodeId) {
          addSpan(edge, 0, Math.min(segment.length, remaining));
        } else {
          addSpan(edge, Math.max(0, segment.length - remaining), segment.length);
        }
      }
    }
    return [...spans.values()];
  }

  /** The walking distance between two spots. */
  pathLength(from: GraphPosition, to: GraphPosition): number {
    const target = this.segments[to.edge]!;
    const walked = this.walkedTo(from, Number.POSITIVE_INFINITY, [target.from.id, target.to.id]);
    const viaFrom = (walked.get(target.from.id) ?? Number.POSITIVE_INFINITY) + to.along;
    const viaTo =
      (walked.get(target.to.id) ?? Number.POSITIVE_INFINITY) + target.length - to.along;
    const direct = from.edge === to.edge ? Math.abs(from.along - to.along) : Number.POSITIVE_INFINITY;
    return Math.min(direct, viaFrom, viaTo);
  }

  /**
   * The shortest walk between two spots, as the points it passes through: the
   * start, every corner on the way, and the end.
   */
  pathBetween(from: GraphPosition, to: GraphPosition): Point[] {
    const start = this.pointAt(from);
    const end = this.pointAt(to);
    const target = this.segments[to.edge]!;
    const reached = this.search(from, Number.POSITIVE_INFINITY, [target.from.id, target.to.id]);
    const direct = from.edge === to.edge ? Math.abs(from.along - to.along) : Number.POSITIVE_INFINITY;
    const viaFrom = (reached.get(target.from.id)?.walked ?? Number.POSITIVE_INFINITY) + to.along;
    const viaTo =
      (reached.get(target.to.id)?.walked ?? Number.POSITIVE_INFINITY) + target.length - to.along;
    if (direct <= Math.min(viaFrom, viaTo) || !Number.isFinite(Math.min(viaFrom, viaTo))) {
      return [start, end];
    }

    const corners: Point[] = [];
    let nodeId: string | null = viaFrom <= viaTo ? target.from.id : target.to.id;
    while (nodeId !== null) {
      corners.unshift(this.nodes.get(nodeId)!);
      nodeId = reached.get(nodeId)!.previous;
    }
    return [start, ...corners, end];
  }

  /** Shortest walking distance from `start` to every node within `budget` metres. */
  private walkedTo(
    start: GraphPosition,
    budget: number,
    stopAt?: readonly string[],
  ): Map<string, number> {
    return new Map(
      [...this.search(start, budget, stopAt)].map(([nodeId, { walked }]) => [nodeId, walked]),
    );
  }

  /** Dijkstra from a spot on an edge, out to `budget`, or until every `stopAt` node is settled. */
  private search(
    start: GraphPosition,
    budget: number,
    stopAt?: readonly string[],
  ): Map<string, Reached> {
    const { from, to, length } = this.segments[start.edge]!;
    const reached = new Map<string, Reached>();
    const waiting = new Set(stopAt);
    const queue = new WalkQueue();
    queue.push({ nodeId: from.id, walked: start.along, previous: null });
    queue.push({ nodeId: to.id, walked: length - start.along, previous: null });

    while (queue.size > 0) {
      const { nodeId, walked, previous } = queue.pop();
      if (walked > budget || reached.has(nodeId)) {
        continue;
      }
      reached.set(nodeId, { walked, previous });
      waiting.delete(nodeId);
      if (stopAt && waiting.size === 0) {
        break;
      }

      for (const edge of this.incident.get(nodeId) ?? []) {
        const segment = this.segments[edge]!;
        const otherEnd = segment.from.id === nodeId ? segment.to.id : segment.from.id;
        if (!reached.has(otherEnd)) {
          queue.push({ nodeId: otherEnd, walked: walked + segment.length, previous: nodeId });
        }
      }
    }
    return reached;
  }
}

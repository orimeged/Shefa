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
}

export function toWalkableEdges(map: StoreMap): WalkableEdge[] {
  const nodes = new Map(map.nodes.map((node) => [node.id, node]));
  return map.edges.flatMap((edge) => {
    const from = nodes.get(edge.from_node);
    const to = nodes.get(edge.to_node);
    return from && to ? [{ from, to }] : [];
  });
}

/** The node closest to `point`, which is where a route can start from. */
export function nearestNodeId(map: StoreMap, point: Point): string | null {
  let nearest: string | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const node of map.nodes) {
    const distance = Math.hypot(node.x - point.x, node.y - point.y);
    if (distance < nearestDistance) {
      nearest = node.id;
      nearestDistance = distance;
    }
  }
  return nearest;
}

interface Reached {
  walked: number;
  /** The node before this one on the shortest walk, or null straight off the start's edge. */
  previous: string | null;
}

export class WalkGraph {
  private readonly segments: readonly Segment[];
  private readonly incident = new Map<string, number[]>();
  private readonly nodes = new Map<string, WalkableNode>();

  constructor(edges: readonly WalkableEdge[]) {
    this.segments = edges.map((edge) => ({
      ...edge,
      length: Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y),
      bearing: bearingBetween(edge.from, edge.to),
    }));
    this.segments.forEach((segment, index) => {
      this.nodes.set(segment.from.id, segment.from);
      this.nodes.set(segment.to.id, segment.to);
      for (const nodeId of [segment.from.id, segment.to.id]) {
        this.incident.set(nodeId, [...(this.incident.get(nodeId) ?? []), index]);
      }
    });
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

  /** The closest spot in the whole graph, for fixes that come from outside the walk. */
  nearest(point: Point): GraphPosition {
    let best: GraphPosition = { edge: 0, along: 0 };
    let bestDistance = Number.POSITIVE_INFINITY;
    this.segments.forEach((segment, edge) => {
      const candidate = this.project(point, { edge, fromAlong: 0, toAlong: segment.length });
      const spot = this.pointAt(candidate);
      const distance = Math.hypot(spot.x - point.x, spot.y - point.y);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    });
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
    const walked = this.walkedTo(from, Number.POSITIVE_INFINITY);
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
    const reached = this.search(from, Number.POSITIVE_INFINITY);
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
  private walkedTo(start: GraphPosition, budget: number): Map<string, number> {
    return new Map(
      [...this.search(start, budget)].map(([nodeId, { walked }]) => [nodeId, walked]),
    );
  }

  private search(start: GraphPosition, budget: number): Map<string, Reached> {
    const { from, to, length } = this.segments[start.edge]!;
    const reached = new Map<string, Reached>();
    const queue: { nodeId: string; walked: number; previous: string | null }[] = [
      { nodeId: from.id, walked: start.along, previous: null },
      { nodeId: to.id, walked: length - start.along, previous: null },
    ];

    while (queue.length > 0) {
      queue.sort((a, b) => a.walked - b.walked);
      const { nodeId, walked, previous } = queue.shift()!;
      if (walked > budget || reached.has(nodeId)) {
        continue;
      }
      reached.set(nodeId, { walked, previous });

      for (const edge of this.incident.get(nodeId) ?? []) {
        const segment = this.segments[edge]!;
        const otherEnd = segment.from.id === nodeId ? segment.to.id : segment.from.id;
        queue.push({ nodeId: otherEnd, walked: walked + segment.length, previous: nodeId });
      }
    }
    return reached;
  }
}

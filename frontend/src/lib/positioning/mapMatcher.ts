/**
 * Keeps a dead-reckoned walk on the store's paths.
 *
 * Snapping to the nearest edge is not enough: past a small drift the nearest
 * edge is the next aisle, and the dot jumps through the shelf. Here the dot can
 * only reach spots a walker could get to along the paths, so the worst a drift
 * can do is leave it behind in the right aisle.
 *
 * Shelves also hold back the dead-reckoned track behind the dot. A step that
 * grazes one slides along it. A step that runs into one shows the track has gone
 * wrong, because nobody walks into a shelf, so it restarts from the dot.
 */

import type { Point } from "../mapGeometry";
import { angleDifference, vectorAlong } from "./angles";
import type { ObstacleField } from "./obstacles";
import type { GraphPosition, WalkGraph } from "./walkGraph";

/** How far along the paths one step may carry the dot beyond its own length. */
const CATCH_UP_M = 2.5;
/** Short of an aisle's length: a phone turned in the hand must not fling the dot out of it. */
const MAX_CATCH_UP_M = 4;
/** How far raw dead reckoning may stray from the dot before it is pulled in. */
const LEASH_M = 1.5;
/** Metres of cost for walking square across an edge instead of along it. */
const CROSSWISE_COST_M = 2;
/** Added per stalled step: walking on against an edge says more each time. */
const STALLED_COST_M = 0.7;
/** Metres of cost for leaving the current edge, so a noisy step doesn't flip it. */
const SWITCH_COST_M = 0.3;
const STALLED_PROGRESS_M = 0.2;
/** Share of a step a wall may absorb and still count as grazing it. */
const GRAZING_SHARE = 0.3;

export class MapMatcher {
  private position: GraphPosition;
  private raw: Point;
  private stalledSteps = 0;

  constructor(
    private readonly graph: WalkGraph,
    start: Point,
    private readonly obstacles?: ObstacleField,
  ) {
    this.position = graph.nearest(start);
    this.raw = graph.pointAt(this.position);
  }

  get point(): Point {
    return this.graph.pointAt(this.position);
  }

  /** The current edge's axis. A walker can go along it either way. */
  get edgeBearing(): number {
    return this.graph.bearingOf(this.position.edge);
  }

  /** Accepts a known position, such as the shelf of an item the shopper just found. */
  anchorTo(point: Point): void {
    this.position = this.graph.nearest(point);
    this.raw = this.graph.pointAt(this.position);
    this.stalledSteps = 0;
  }

  step(bearing: number, length: number): void {
    this.raw = this.advanceTrack(vectorAlong(bearing, length), length);

    const previous = this.point;
    this.position = this.bestCandidate(bearing, length);
    const point = this.point;

    const moved = Math.hypot(point.x - previous.x, point.y - previous.y);
    this.stalledSteps = moved < STALLED_PROGRESS_M ? this.stalledSteps + 1 : 0;

    // Cast from the dot, so pulling the track in can't drag it through a shelf.
    const leashed = withinLeash(this.raw, point);
    this.raw = this.obstacles?.constrain(point, leashed).point ?? leashed;
  }

  private advanceTrack(step: Point, length: number): Point {
    const target = { x: this.raw.x + step.x, y: this.raw.y + step.y };
    if (!this.obstacles) {
      return target;
    }
    const { point, blockedM } = this.obstacles.constrain(this.raw, target);
    if (blockedM <= length * GRAZING_SHARE) {
      return point;
    }
    const dot = this.point;
    return this.obstacles.constrain(dot, { x: dot.x + step.x, y: dot.y + step.y }).point;
  }

  private bestCandidate(bearing: number, length: number): GraphPosition {
    // A step that keeps getting nowhere means the shopper turned off a junction
    // the dot has not reached yet, so the search widens until it finds it.
    const catchUp = Math.min(MAX_CATCH_UP_M, CATCH_UP_M + this.stalledSteps * length);
    const spans = this.graph.reachable(this.position, length + catchUp);

    let best = this.position;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const span of spans) {
      const candidate = this.graph.project(this.raw, span);
      const cost = this.cost(candidate, bearing);
      if (cost < bestCost) {
        best = candidate;
        bestCost = cost;
      }
    }
    return best;
  }

  private cost(candidate: GraphPosition, bearing: number): number {
    const spot = this.graph.pointAt(candidate);
    const offPath = Math.hypot(this.raw.x - spot.x, this.raw.y - spot.y);
    const turn = (angleDifference(this.graph.bearingOf(candidate.edge), bearing) * Math.PI) / 180;
    const switched = candidate.edge === this.position.edge ? 0 : SWITCH_COST_M;
    const crosswise = CROSSWISE_COST_M + this.stalledSteps * STALLED_COST_M;
    return offPath + crosswise * Math.abs(Math.sin(turn)) + switched;
  }
}

function withinLeash(raw: Point, anchor: Point): Point {
  const dx = raw.x - anchor.x;
  const dy = raw.y - anchor.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= LEASH_M) {
    return raw;
  }
  const share = LEASH_M / distance;
  return { x: anchor.x + dx * share, y: anchor.y + dy * share };
}

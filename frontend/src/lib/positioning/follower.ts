/**
 * What the screen shows between steps. The engine moves the shopper 60-80 cm at
 * a time, about twice a second, and a dot drawn there would hop. This one chases
 * the engine's position along the walk between them, so it turns corners on the
 * paths instead of cutting across a shelf.
 *
 * The chase is a critically damped spring: its speed carries over from one step
 * to the next, so a steady walk reads as steady motion rather than a lurch at
 * every footfall, and it never runs past where the shopper is.
 */

import type { Point } from "../mapGeometry";
import { angleDifference, normalizeDegrees } from "./angles";

/** How long the dot takes to settle: about one step behind at a normal pace. */
const SMOOTH_TIME_MS = 450;
/** Above a brisk walk. Catching up on steps, the dot never moves faster than a person. */
const MAX_WALK_SPEED_M_PER_S = 2.2;
/**
 * More catching up than a walk builds, so a fix such as Found it. A walk can
 * build up to three steps at once: the step detector holds the first three back
 * until it's sure they're a walk.
 */
const CORRECTION_M = 3;
/** A fix is shown as a quick slide to the right spot, there in about a third of a second. */
const CORRECTION_SMOOTH_TIME_MS = 100;
const ARRIVED_M = 0.005;
const HEADING_LAG_MS = 140;

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lengthOf(path: readonly Point[]): number {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    total += distance(path[index - 1]!, path[index]!);
  }
  return total;
}

/** `path` with its first `metres` walked off, starting at the spot reached. */
function walkOff(path: readonly Point[], metres: number): Point[] {
  let left = metres;
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1]!;
    const to = path[index]!;
    const piece = distance(from, to);
    if (left < piece) {
      const share = left / piece;
      const reached = { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share };
      return [reached, ...path.slice(index)];
    }
    left -= piece;
  }
  return [path.at(-1)!];
}

export class PathFollower {
  /** Where the dot is drawn, then the walk still ahead of it. */
  private path: Point[];
  /** Metres per second along the path, toward the target. */
  private speed = 0;
  /** Set by a jump bigger than any walk, until the dot has caught up with it. */
  private correcting = false;

  constructor(start: Point) {
    this.path = [start];
  }

  get position(): Point {
    return this.path[0]!;
  }

  /** The last position queued, where the dot is heading. */
  get target(): Point {
    return this.path.at(-1)!;
  }

  get backlogM(): number {
    return lengthOf(this.path);
  }

  /** Queues a walk that starts at the current target. */
  extend(walk: readonly Point[]): void {
    this.path.push(...walk.slice(1));
    if (this.backlogM > CORRECTION_M) {
      this.correcting = true;
    }
  }

  /** For a reduced-motion setting: no chase, the dot is where the engine is. */
  jumpTo(point: Point): void {
    this.path = [point];
    this.speed = 0;
    this.correcting = false;
  }

  /** Moves the dot on by one frame and returns where it is drawn. */
  advance(elapsedMs: number): Point {
    const backlog = this.backlogM;
    if (backlog <= ARRIVED_M) {
      this.path = [this.target];
      this.speed = 0;
      this.correcting = false;
      return this.position;
    }
    this.path = walkOff(this.path, this.springStep(backlog, elapsedMs / 1000));
    return this.position;
  }

  /**
   * One frame of a critically damped spring, in one dimension along the path:
   * the dot at 0 and the shopper at `backlog`. This is the closed form used by
   * Unity's SmoothDamp, stable at any frame length. Its speed limit works on how
   * far the target seems, not on the speed itself, so the spring stays consistent.
   */
  private springStep(backlog: number, seconds: number): number {
    const smoothTime = (this.correcting ? CORRECTION_SMOOTH_TIME_MS : SMOOTH_TIME_MS) / 1000;
    const reach = this.correcting ? backlog : Math.min(backlog, MAX_WALK_SPEED_M_PER_S * smoothTime);
    const omega = 2 / smoothTime;
    const x = omega * seconds;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const pull = (this.speed - omega * reach) * seconds;
    this.speed = (this.speed - omega * pull) * decay;
    const moved = reach + (pull - reach) * decay;

    if (moved >= backlog) {
      this.speed = 0;
      return backlog;
    }
    if (moved <= 0) {
      this.speed = 0;
      return 0;
    }
    return moved;
  }
}

/** Turns `current` toward `target` the short way round, by one frame's share. */
export function easeHeading(current: number, target: number, elapsedMs: number): number {
  const share = 1 - Math.exp(-elapsedMs / HEADING_LAG_MS);
  return normalizeDegrees(current + angleDifference(current, target) * share);
}

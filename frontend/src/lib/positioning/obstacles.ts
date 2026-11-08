/**
 * What a shopper can't walk through.
 *
 * Dead reckoning knows nothing about shelves: a heading a few degrees off walks
 * straight through one. A step that meets a wall stops there, and what's left of
 * it slides along the wall, the way someone actually walks down an aisle.
 *
 * Crossing is only checked going in. A position that somehow ends up inside a
 * shelf can always walk out, so a bad map or a bad fix can't trap the dot.
 */

import type { StoreMap } from "../../api/types";
import type { Point, Rect } from "../mapGeometry";
import { buildMapLayout } from "../mapGeometry";

export type Polygon = readonly Point[];

interface Wall {
  start: Point;
  /** Unit vector from `start` along the wall. */
  tangent: Point;
  /** Unit vector pointing out of the wall, into walkable floor. */
  normal: Point;
  length: number;
}

export interface Contact {
  /** Share of the movement completed on reaching the wall. */
  share: number;
  wall: Wall;
}

export interface ConstrainedMove {
  point: Point;
  /** Metres of the movement that went nowhere. */
  blockedM: number;
}

/** Stops a little short of a wall, so the next step doesn't start on it. */
const CLEARANCE_M = 0.05;
/** Enough for a step that slides along one wall into the next. */
const MAX_SLIDES = 3;
const EPSILON = 1e-9;

export class ObstacleField {
  private readonly walls: readonly Wall[];

  /** `outline` is the floor: everything outside it is out of bounds. */
  constructor(
    private readonly solids: readonly Polygon[],
    private readonly outline?: Polygon,
  ) {
    this.walls = [
      ...solids.flatMap((solid) => wallsOf(solid, 1)),
      ...(outline ? wallsOf(outline, -1) : []),
    ];
  }

  /** Ray casting: a point is inside if a ray from it crosses the edge an odd number of times. */
  contains(point: Point): boolean {
    return (
      this.solids.some((solid) => isInside(point, solid)) ||
      (this.outline !== undefined && !isInside(point, this.outline))
    );
  }

  /** The first wall a straight move from `from` to `to` runs into. */
  firstContact(from: Point, to: Point): Contact | null {
    const move = { x: to.x - from.x, y: to.y - from.y };
    let first: Contact | null = null;

    for (const wall of this.walls) {
      const approach = dot(move, wall.normal);
      const clearance =
        (from.x - wall.start.x) * wall.normal.x + (from.y - wall.start.y) * wall.normal.y;
      // Moving away from the wall, or already behind it.
      if (approach >= -EPSILON || clearance < -EPSILON) {
        continue;
      }
      const share = Math.max(0, clearance / -approach);
      if (share > 1 || (first && share >= first.share)) {
        continue;
      }
      const along =
        (from.x + move.x * share - wall.start.x) * wall.tangent.x +
        (from.y + move.y * share - wall.start.y) * wall.tangent.y;
      if (along >= -EPSILON && along <= wall.length + EPSILON) {
        first = { share, wall };
      }
    }
    return first;
  }

  /** How far a move really gets: up to the first wall, then sliding along it. */
  constrain(from: Point, to: Point): ConstrainedMove {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    let position = from;
    let remaining = { x: to.x - from.x, y: to.y - from.y };
    let travelled = 0;

    for (let slide = 0; slide <= MAX_SLIDES; slide += 1) {
      const target = { x: position.x + remaining.x, y: position.y + remaining.y };
      const contact = this.firstContact(position, target);
      if (!contact) {
        travelled += Math.hypot(remaining.x, remaining.y);
        position = target;
        return { point: position, blockedM: Math.max(0, distance - travelled) };
      }

      const { share, wall } = contact;
      const stopped = {
        x: position.x + remaining.x * share,
        y: position.y + remaining.y * share,
      };
      travelled += Math.hypot(remaining.x * share, remaining.y * share);
      position = keepClear(stopped, wall);

      const left = { x: remaining.x * (1 - share), y: remaining.y * (1 - share) };
      const alongWall = dot(left, wall.tangent);
      remaining = { x: wall.tangent.x * alongWall, y: wall.tangent.y * alongWall };
    }
    return { point: position, blockedM: Math.max(0, distance - travelled) };
  }
}

export function storeObstacles(map: StoreMap): ObstacleField {
  const layout = buildMapLayout(map);
  const toStore = ({ x, y }: Point): Point => ({ x, y: map.height_m - y });
  const corners = ({ x, y, width, height }: Rect): Polygon =>
    [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ].map(toStore);

  return new ObstacleField(layout.shelves.map(corners), corners(layout.floor));
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

function keepClear(point: Point, wall: Wall): Point {
  return {
    x: point.x + wall.normal.x * CLEARANCE_M,
    y: point.y + wall.normal.y * CLEARANCE_M,
  };
}

function signedArea(polygon: Polygon): number {
  return polygon.reduce((area, point, index) => {
    const next = polygon[(index + 1) % polygon.length]!;
    return area + point.x * next.y - next.x * point.y;
  }, 0);
}

/** `side` is 1 when the walkable floor is outside the polygon, -1 when it's inside. */
function wallsOf(polygon: Polygon, side: 1 | -1): Wall[] {
  const outward = Math.sign(signedArea(polygon)) * side;

  return polygon.flatMap((start, index) => {
    const end = polygon[(index + 1) % polygon.length]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      return [];
    }
    const tangent = { x: dx / length, y: dy / length };
    return [{ start, tangent, normal: { x: tangent.y * outward, y: -tangent.x * outward }, length }];
  });
}

function isInside(point: Point, polygon: Polygon): boolean {
  let inside = false;
  polygon.forEach((start, index) => {
    const end = polygon[(index + 1) % polygon.length]!;
    const straddles = start.y > point.y !== end.y > point.y;
    if (
      straddles &&
      point.x < ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x
    ) {
      inside = !inside;
    }
  });
  return inside;
}

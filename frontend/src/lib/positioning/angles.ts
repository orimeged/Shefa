/**
 * Bearings are degrees clockwise from the store's +y axis, the direction you
 * face walking in from the entrance. On the SVG map 0 is up and 90 is right.
 */

import type { Point } from "../mapGeometry";

const DEGREES = 180 / Math.PI;

export function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** The signed turn from `from` to `to`, in the range [-180, 180). */
export function angleDifference(from: number, to: number): number {
  return normalizeDegrees(to - from + 180) - 180;
}

export function bearingBetween(from: Point, to: Point): number {
  return normalizeDegrees(Math.atan2(to.x - from.x, to.y - from.y) * DEGREES);
}

export function vectorAlong(bearing: number, length: number): Point {
  const radians = bearing / DEGREES;
  return { x: Math.sin(radians) * length, y: Math.cos(radians) * length };
}

/** The mean of `bearings`, taken on the circle so that 350 and 10 average to 0. */
export function circularMean(bearings: readonly number[]): number {
  const vector = bearings.reduce(
    (sum, bearing) => {
      const unit = vectorAlong(bearing, 1);
      return { x: sum.x + unit.x, y: sum.y + unit.y };
    },
    { x: 0, y: 0 },
  );
  return bearingBetween({ x: 0, y: 0 }, vector);
}

/**
 * Yaw of the direction a phone in the hand points, from W3C device orientation
 * angles. The top edge of the phone is reliable when it lies flat and the back
 * when it stands upright, so their sum stays stable across a natural grip.
 */
export function deviceYaw(alpha: number, beta: number, gamma: number): number {
  const [cosZ, sinZ] = cosSin(alpha);
  const [cosX, sinX] = cosSin(beta);
  const [cosY, sinY] = cosSin(gamma);

  const topEast = -cosX * sinZ;
  const topNorth = cosZ * cosX;
  const backEast = -(cosY * sinZ * sinX + cosZ * sinY);
  const backNorth = cosZ * cosY * sinX - sinZ * sinY;

  return bearingBetween({ x: 0, y: 0 }, { x: topEast + backEast, y: topNorth + backNorth });
}

function cosSin(degrees: number): [number, number] {
  const radians = degrees / DEGREES;
  return [Math.cos(radians), Math.sin(radians)];
}

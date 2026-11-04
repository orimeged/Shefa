/**
 * Pedestrian dead reckoning: turns raw sensor readings into a spot on the map.
 *
 * Heading comes from the gyroscope-based `alpha` rather than the compass. Steel
 * shelves and freezers bend the magnetic field, and north alone means nothing
 * without knowing how the store sits on the map. Instead the first steps set the
 * reference: an entrance has one way in, so the shopper's direction is known.
 */

import type { Point } from "../mapGeometry";
import { angleDifference, circularMean, deviceYaw, normalizeDegrees, vectorAlong } from "./angles";
import { MapMatcher } from "./mapMatcher";
import type { ObstacleField } from "./obstacles";
import { StepDetector } from "./stepDetector";
import type { WalkableEdge } from "./walkGraph";
import { WalkGraph } from "./walkGraph";

export const DEFAULT_STEP_LENGTH_M = 0.7;

const CALIBRATION_STEPS = 4;
const YAW_SMOOTHING = 0.15;
/** Walking along an edge within this angle counts as following it. */
const ALIGNED_WITHIN_DEGREES = 30;
/** Share of the remaining heading error removed per aligned step. */
const DRIFT_CORRECTION_RATE = 0.08;

/** Below this many steps between two fixes, a stride estimate is mostly noise. */
const MIN_STEPS_FOR_STRIDE = 12;
const MIN_STEP_LENGTH_M = 0.4;
const MAX_STEP_LENGTH_M = 0.85;
const STRIDE_LEARNING_RATE = 0.7;

export interface LivePosition extends Point {
  /** Degrees clockwise from the store's +y axis. */
  heading: number;
}

export class PositioningEngine {
  private readonly graph: WalkGraph;
  private readonly matcher: MapMatcher;
  private readonly detector = new StepDetector();
  private readonly initialBearing: number;
  private readonly calibrationYaws: number[] = [];

  private smoothedYaw: Point | null = null;
  private yawToBearing: number | null = null;

  private lastFix: Point;
  private stepsSinceFix = 0;

  constructor(
    start: Point,
    edges: readonly WalkableEdge[],
    private stepLengthM: number = DEFAULT_STEP_LENGTH_M,
    obstacles?: ObstacleField,
  ) {
    this.graph = new WalkGraph(edges);
    this.matcher = new MapMatcher(this.graph, start, obstacles);
    this.initialBearing = this.graph.bearingOutOf(start);
    this.lastFix = start;
  }

  get isCalibrated(): boolean {
    return this.yawToBearing !== null;
  }

  get snapshot(): LivePosition {
    return { ...this.matcher.point, heading: this.heading };
  }

  private get yaw(): number | null {
    if (!this.smoothedYaw) {
      return null;
    }
    return normalizeDegrees((Math.atan2(this.smoothedYaw.x, this.smoothedYaw.y) * 180) / Math.PI);
  }

  private get heading(): number {
    const { yaw, yawToBearing } = this;
    return yaw === null || yawToBearing === null
      ? this.initialBearing
      : normalizeDegrees(yaw + yawToBearing);
  }

  handleOrientation(alpha: number, beta: number, gamma: number): void {
    const unit = vectorAlong(deviceYaw(alpha, beta, gamma), 1);
    const current = this.smoothedYaw;
    this.smoothedYaw = current
      ? {
          x: current.x + (unit.x - current.x) * YAW_SMOOTHING,
          y: current.y + (unit.y - current.y) * YAW_SMOOTHING,
        }
      : unit;
  }

  /** Returns true when the sample moved the shopper. */
  handleMotion(x: number, y: number, z: number, timeMs: number): boolean {
    const steps = this.detector.push(x, y, z, timeMs);
    for (let index = 0; index < steps; index += 1) {
      this.takeStep();
    }
    return steps > 0;
  }

  /** Accepts a known position. Two of them also measure the shopper's stride. */
  anchorTo(point: Point): void {
    this.learnStride(point);
    this.matcher.anchorTo(point);
    this.lastFix = point;
    this.stepsSinceFix = 0;
  }

  private learnStride(fix: Point): void {
    if (this.stepsSinceFix < MIN_STEPS_FOR_STRIDE) {
      return;
    }
    const walked = this.graph.pathLength(this.graph.nearest(this.lastFix), this.graph.nearest(fix));
    const measured = Math.min(
      MAX_STEP_LENGTH_M,
      Math.max(MIN_STEP_LENGTH_M, walked / this.stepsSinceFix),
    );
    this.stepLengthM += (measured - this.stepLengthM) * STRIDE_LEARNING_RATE;
  }

  private takeStep(): void {
    this.stepsSinceFix += 1;
    if (this.yawToBearing === null) {
      this.calibrate();
      return;
    }
    this.matcher.step(this.heading, this.stepLengthM);
    this.correctDrift();
  }

  private calibrate(): void {
    this.matcher.step(this.initialBearing, this.stepLengthM);
    if (this.yaw === null) {
      return;
    }
    this.calibrationYaws.push(this.yaw);
    if (this.calibrationYaws.length >= CALIBRATION_STEPS) {
      this.yawToBearing = angleDifference(circularMean(this.calibrationYaws), this.initialBearing);
    }
  }

  /** The gyroscope drifts over a shop, but aisles are straight: following one resets it. */
  private correctDrift(): void {
    const toEdge = angleDifference(this.heading, this.matcher.edgeBearing);
    const toNearestDirection = Math.abs(toEdge) > 90 ? angleDifference(0, toEdge + 180) : toEdge;
    if (Math.abs(toNearestDirection) <= ALIGNED_WITHIN_DEGREES) {
      this.yawToBearing! += toNearestDirection * DRIFT_CORRECTION_RATE;
    }
  }
}

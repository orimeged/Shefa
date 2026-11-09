/**
 * Test support: a seeded virtual shopper who walks a path and produces the
 * sensor stream a phone would. It exists because no phone can run in CI, so its
 * figures describe this model of walking, not a measured store.
 */

import type { Point } from "../mapGeometry";
import { bearingBetween, normalizeDegrees } from "./angles";

const SAMPLE_INTERVAL_MS = 1000 / 60;
const GRAVITY_MS2 = 9.81;

export interface WalkModel {
  meanStepM: number;
  stepSpreadM: number;
  stepDurationMs: number;
  stepAmplitudeMs2: number;
  sensorNoiseMs2: number;
  headingNoiseDegrees: number;
  /** Slow sway of the phone against the body, per step. Unlike noise it doesn't average out. */
  headingWanderDegrees: number;
  gyroDriftDegreesPerStep: number;
  /** Degrees between the phone and the walker's direction. */
  gripYawDegrees: number;
  /** Every this many steps the phone is turned in the hand, without the walker turning. */
  gripShiftEverySteps?: number;
  gripShiftDegrees?: number;
  /**
   * Standing still facing the first leg before walking, as the start screen asks:
   * the phone reports where it points, and feels no steps.
   */
  standFirstMs?: number;
  /** Degrees the shopper stands off the way in while standing there. */
  standOffDegrees?: number;
}

export const TYPICAL_WALK: WalkModel = {
  meanStepM: 0.62,
  stepSpreadM: 0.07,
  stepDurationMs: 560,
  stepAmplitudeMs2: 2.6,
  sensorNoiseMs2: 0.25,
  headingNoiseDegrees: 7,
  headingWanderDegrees: 5,
  gyroDriftDegreesPerStep: 0.12,
  gripYawDegrees: 25,
};

export interface WalkSinks {
  orientation: (alpha: number, beta: number, gamma: number) => void;
  motion: (x: number, y: number, z: number, timeMs: number) => void;
  /** Called after every simulated step with where the shopper truly is. */
  stepped: (truth: Point) => void;
  /** Called on reaching each waypoint after the first. */
  arrived?: (waypoint: Point) => void;
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

/** Walks `path`, a list of waypoints, feeding `sinks`. */
export function simulateWalk(
  path: readonly Point[],
  model: WalkModel,
  seed: number,
  sinks: WalkSinks,
): void {
  const random = seededRandom(seed);
  let timeMs = 0;
  let drift = 0;
  let wander = 0;
  let gripShift = 0;
  let stepCount = 0;
  let position = path[0]!;

  // alpha turns counter-clockwise and starts from an arbitrary reference.
  const arbitraryAlpha = random() * 360;

  const emitStep = (bearing: number, length: number) => {
    const samples = Math.round(model.stepDurationMs / SAMPLE_INTERVAL_MS);
    for (let sample = 0; sample < samples; sample += 1) {
      const phase = (2 * Math.PI * sample) / samples;
      const gait = Math.sin(phase) * model.stepAmplitudeMs2;
      const noise = normal(random) * model.sensorNoiseMs2;
      const heading =
        bearing +
        model.gripYawDegrees +
        gripShift +
        drift +
        wander +
        normal(random) * model.headingNoiseDegrees;

      sinks.orientation(normalizeDegrees(arbitraryAlpha - heading), 38, 4);
      sinks.motion(0.4, 5.9, GRAVITY_MS2 * 0.8 + gait * 0.8 + noise, timeMs);
      timeMs += SAMPLE_INTERVAL_MS;
    }
    drift += model.gyroDriftDegreesPerStep;
    wander = wander * 0.85 + normal(random) * model.headingWanderDegrees;
    stepCount += 1;
    if (model.gripShiftEverySteps && stepCount % model.gripShiftEverySteps === 0) {
      const away = random() < 0.5 ? -1 : 1;
      gripShift = gripShift === 0 ? away * (model.gripShiftDegrees ?? 0) : 0;
    }

    const radians = (bearing * Math.PI) / 180;
    position = {
      x: position.x + Math.sin(radians) * length,
      y: position.y + Math.cos(radians) * length,
    };
    sinks.stepped(position);
  };

  if (model.standFirstMs && path.length > 1) {
    const facing = bearingBetween(path[0]!, path[1]!) + (model.standOffDegrees ?? 0);
    for (let elapsed = 0; elapsed < model.standFirstMs; elapsed += SAMPLE_INTERVAL_MS) {
      const heading = facing + model.gripYawDegrees + normal(random) * model.headingNoiseDegrees;
      sinks.orientation(normalizeDegrees(arbitraryAlpha - heading), 38, 4);
      sinks.motion(0.4, 5.9, GRAVITY_MS2 * 0.8 + normal(random) * model.sensorNoiseMs2, timeMs);
      timeMs += SAMPLE_INTERVAL_MS;
    }
  }

  for (let index = 0; index + 1 < path.length; index += 1) {
    const target = path[index + 1]!;
    const bearing = bearingBetween(path[index]!, target);
    let remaining = Math.hypot(target.x - position.x, target.y - position.y);
    while (remaining > 0.01) {
      const stride = model.meanStepM + normal(random) * model.stepSpreadM;
      const length = Math.min(remaining, Math.max(0.3, stride));
      emitStep(bearing, length);
      remaining -= length;
    }
    sinks.arrived?.(target);
  }
}

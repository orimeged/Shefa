/**
 * Test support: a seeded virtual shopper who walks a path and produces the
 * sensor stream a phone would. It exists because no phone can run in CI, so its
 * figures describe this model of walking, not a measured store.
 */

import type { Point } from "../mapGeometry";
import { angleDifference, bearingBetween, normalizeDegrees } from "./angles";
import type { RotationRate } from "./stepDetector";

const SAMPLE_INTERVAL_MS = 1000 / 60;
const GRAVITY_MS2 = 9.81;
const RADIANS = Math.PI / 180;

type Vector = [number, number, number];

/**
 * What the walker's phone reads at rest, held tipped back towards the face: the
 * push against gravity, so it points up in the phone's axes.
 */
const HELD_UP: Vector = [0.4, 5.9, GRAVITY_MS2 * 0.8];
/** Seconds a turn onto the next leg takes. */
const TURN_S = 0.4;

const scale = (a: Vector, by: number): Vector => [a[0] * by, a[1] * by, a[2] * by];
const unit = (a: Vector): Vector => scale(a, 1 / Math.hypot(...a));
const cross = (a: Vector, b: Vector): Vector => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** A spin in the phone's axes (deg/s about x, y, z) as `rotationRate` reports it. */
function rotationRate([aboutX, aboutY, aboutZ]: Vector): RotationRate {
  return { alpha: aboutZ, beta: aboutX, gamma: aboutY };
}

// The held phone's up, and two level axes it sways about.
const VERTICAL = unit(HELD_UP);
const PITCH_AXIS = unit([1 - VERTICAL[0] * VERTICAL[0], -VERTICAL[0] * VERTICAL[1], -VERTICAL[0] * VERTICAL[2]]);
const ROLL_AXIS = cross(VERTICAL, PITCH_AXIS);

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
  /**
   * Degrees the phone tips forward and back with each step, held in front; half
   * that side to side. The gyroscope feels it, as it feels the turns at corners.
   */
  swayDegrees: number;
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
  swayDegrees: 4,
};

export interface WalkSinks {
  orientation: (alpha: number, beta: number, gamma: number) => void;
  motion: (x: number, y: number, z: number, timeMs: number, rotation: RotationRate) => void;
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
  // The gyroscope's own noise, apart, so adding it left every walk as it was.
  const gyroNoise = seededRandom(seed + 0x5bd1e995);
  let timeMs = 0;
  let drift = 0;
  let wander = 0;
  let gripShift = 0;
  let stepCount = 0;
  let position = path[0]!;
  // A turn onto a new leg, still being made: degrees a second about the vertical, and for how long.
  let turnRate = 0;
  let turnLeftMs = 0;

  // alpha turns counter-clockwise and starts from an arbitrary reference.
  const arbitraryAlpha = random() * 360;

  /** What the gyroscope reads: the sway of each step, a turn underway, and noise. */
  const gyroscope = (phase: number): RotationRate => {
    const stepsPerSecond = 1000 / model.stepDurationMs;
    // Forward and back once a step, side to side once a stride of two.
    const pitch = model.swayDegrees * 2 * Math.PI * stepsPerSecond * Math.cos(phase);
    const roll = (model.swayDegrees / 2) * Math.PI * stepsPerSecond * Math.cos(phase / 2);
    const turning = turnLeftMs > 0 ? turnRate : 0;
    // A turn clockwise on the floor, seen from above, is a negative spin about up.
    const spin = [0, 1, 2].map(
      (axis) =>
        PITCH_AXIS[axis]! * pitch + ROLL_AXIS[axis]! * roll - VERTICAL[axis]! * turning + normal(gyroNoise) * 2,
    ) as Vector;
    return rotationRate(spin);
  };

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
      sinks.motion(HELD_UP[0], HELD_UP[1], HELD_UP[2] + gait * 0.8 + noise, timeMs, gyroscope(phase));
      timeMs += SAMPLE_INTERVAL_MS;
      turnLeftMs -= SAMPLE_INTERVAL_MS;
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
      sinks.motion(
        HELD_UP[0],
        HELD_UP[1],
        HELD_UP[2] + normal(random) * model.sensorNoiseMs2,
        timeMs,
        rotationRate([normal(gyroNoise) * 2, normal(gyroNoise) * 2, normal(gyroNoise) * 2]),
      );
      timeMs += SAMPLE_INTERVAL_MS;
    }
  }

  let lastBearing: number | null = null;
  for (let index = 0; index + 1 < path.length; index += 1) {
    const target = path[index + 1]!;
    const bearing = bearingBetween(path[index]!, target);
    if (lastBearing !== null) {
      turnRate = angleDifference(lastBearing, bearing) / TURN_S;
      turnLeftMs = TURN_S * 1000;
    }
    lastBearing = bearing;
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

/** The phone moved about in the hand, standing still: no steps, however it feels. */
export interface HandlingModel {
  /** Degrees the phone is tipped forward and back about its usual hold; side to side, two thirds of it. */
  tiltDegrees: number;
  /** Degrees it is swung left and right. */
  swingDegrees: number;
  /** Peak acceleration of the hand, m/s², up and down half of it. */
  handAccelerationMs2: number;
  /** The hand's rhythm wanders between these, in movements a second. */
  slowestHz: number;
  fastestHz: number;
  sensorNoiseMs2: number;
}

/** Waving the phone about, the field test's "erratic or exaggerated" movement. */
export const WAVING: HandlingModel = {
  tiltDegrees: 35,
  swingDegrees: 30,
  handAccelerationMs2: 5,
  slowestHz: 0.8,
  fastestHz: 2.5,
  sensorNoiseMs2: 0.25,
};

/** Smaller: turning the phone over to look at it, gesturing with it while talking. */
export const FIDGETING: HandlingModel = {
  tiltDegrees: 15,
  swingDegrees: 15,
  handAccelerationMs2: 2.5,
  slowestHz: 0.7,
  fastestHz: 2,
  sensorNoiseMs2: 0.25,
};

/** Device to earth (east, north, up) for W3C orientation angles: Rz(alpha) Rx(beta) Ry(gamma). */
function deviceToEarth(alpha: number, beta: number, gamma: number): Vector[] {
  const [cZ, sZ] = [Math.cos(alpha * RADIANS), Math.sin(alpha * RADIANS)];
  const [cX, sX] = [Math.cos(beta * RADIANS), Math.sin(beta * RADIANS)];
  const [cY, sY] = [Math.cos(gamma * RADIANS), Math.sin(gamma * RADIANS)];
  return [
    [cZ * cY - sZ * sX * sY, -sZ * cX, cZ * sY + sZ * sX * cY],
    [sZ * cY + cZ * sX * sY, cZ * cX, sZ * sY - cZ * sX * cY],
    [-cX * sY, sX, cX * cY],
  ];
}

/** `matrix` transposed times `vector`: earth to the phone's axes. */
function toDevice(matrix: Vector[], vector: Vector): Vector {
  return [0, 1, 2].map((axis) => matrix[0]![axis]! * vector[0] + matrix[1]![axis]! * vector[1] + matrix[2]![axis]! * vector[2]) as Vector;
}

/**
 * Feeds `durationMs` of a phone handled in place. Orientation, acceleration and
 * the gyroscope all come from the one motion, so they agree as a real phone's do.
 */
export function simulateHandling(
  model: HandlingModel,
  durationMs: number,
  seed: number,
  sinks: Pick<WalkSinks, "orientation" | "motion">,
): void {
  const random = seededRandom(seed);
  const between = () => model.slowestHz + random() * (model.fastestHz - model.slowestHz);
  // Six movements, each with its own rhythm that keeps changing: pitch, roll, swing, and the hand's x, y, z.
  const phases = Array.from({ length: 6 }, () => random() * 2 * Math.PI);
  const rhythms = Array.from({ length: 6 }, between);
  const facing = random() * 360;

  const pose = () => ({
    alpha: facing + model.swingDegrees * Math.sin(phases[2]!),
    beta: 40 + model.tiltDegrees * Math.sin(phases[0]!),
    gamma: ((model.tiltDegrees * 2) / 3) * Math.sin(phases[1]!),
  });

  let before = pose();
  for (let timeMs = 0; timeMs < durationMs; timeMs += SAMPLE_INTERVAL_MS) {
    for (let index = 0; index < 6; index += 1) {
      phases[index]! += 2 * Math.PI * rhythms[index]! * (SAMPLE_INTERVAL_MS / 1000);
      // Erratic: about twice a second each rhythm drifts somewhere else.
      if (random() < SAMPLE_INTERVAL_MS / 500) {
        rhythms[index] = between();
      }
    }
    const now = pose();
    const earth = deviceToEarth(now.alpha, now.beta, now.gamma);
    const hand: Vector = [
      model.handAccelerationMs2 * Math.sin(phases[3]!),
      model.handAccelerationMs2 * Math.sin(phases[4]!),
      (model.handAccelerationMs2 / 2) * Math.sin(phases[5]!) + GRAVITY_MS2,
    ];
    const felt = toDevice(earth, hand).map((value) => value + normal(random) * model.sensorNoiseMs2) as Vector;

    // The spin between two samples, in the phone's axes: Rᵀ(before)·R(now) ≈ I + [ω]× dt.
    const was = deviceToEarth(before.alpha, before.beta, before.gamma);
    const turn = [0, 1, 2].map((row) => [0, 1, 2].map((col) => was[0]![row]! * earth[0]![col]! + was[1]![row]! * earth[1]![col]! + was[2]![row]! * earth[2]![col]!));
    const perSecond = 1 / (SAMPLE_INTERVAL_MS / 1000) / RADIANS / 2;
    const spin: Vector = [
      (turn[2]![1]! - turn[1]![2]!) * perSecond,
      (turn[0]![2]! - turn[2]![0]!) * perSecond,
      (turn[1]![0]! - turn[0]![1]!) * perSecond,
    ];
    before = now;

    sinks.orientation(normalizeDegrees(now.alpha), now.beta, now.gamma);
    sinks.motion(felt[0], felt[1], felt[2], timeMs, rotationRate(spin.map((value) => value + normal(random) * 2) as Vector));
  }
}

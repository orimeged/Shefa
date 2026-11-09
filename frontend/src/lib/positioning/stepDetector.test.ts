import { describe, expect, it } from "vitest";

import type { HandlingModel } from "./simulatedWalk";
import { FIDGETING, seededRandom, simulateHandling, simulateWalk, TYPICAL_WALK, WAVING } from "./simulatedWalk";
import { StepDetector } from "./stepDetector";

const SAMPLE_MS = 1000 / 60;
const GRAVITY = 9.81;

function countSteps(signal: (timeMs: number) => number, durationMs: number): number {
  const detector = new StepDetector();
  let steps = 0;
  for (let time = 0; time < durationMs; time += SAMPLE_MS) {
    steps += detector.push(0, 0, GRAVITY + signal(time), time);
  }
  return steps;
}

const wave = (amplitude: number, periodMs: number) => (time: number) =>
  amplitude * Math.sin((2 * Math.PI * time) / periodMs);

describe("StepDetector", () => {
  it("counts a steady walk", () => {
    expect(countSteps(wave(2.5, 550), 11000)).toBeGreaterThanOrEqual(19);
    expect(countSteps(wave(2.5, 550), 11000)).toBeLessThanOrEqual(21);
  });

  it("counts a slow walk with weak footfalls", () => {
    expect(countSteps(wave(1.1, 900), 18000)).toBeGreaterThanOrEqual(18);
  });

  it("stays silent while the phone is still", () => {
    expect(countSteps(() => 0, 10000)).toBe(0);
  });

  it("ignores hand tremor and sensor noise", () => {
    const random = seededRandom(3);
    expect(countSteps(() => (random() - 0.5) * 0.8, 10000)).toBe(0);
  });

  it("ignores a lone bump, like taking an item off a shelf", () => {
    const bump = (time: number) => (time > 3000 && time < 3250 ? 4 : 0);
    expect(countSteps(bump, 6000)).toBe(0);
  });

  it("ignores two bumps far apart", () => {
    const bump = (time: number) =>
      (time > 2000 && time < 2200) || (time > 6000 && time < 6200) ? 4 : 0;
    expect(countSteps(bump, 9000)).toBe(0);
  });

  it("ignores hard shaking", () => {
    expect(countSteps(wave(20, 500), 8000)).toBe(0);
  });

  it("does not count a vibration faster than anyone walks as more than the limit allows", () => {
    expect(countSteps(wave(3, 120), 6000)).toBeLessThanOrEqual(6000 / 280);
  });

  it("releases the held steps once a walk is confirmed", () => {
    const detector = new StepDetector();
    const confirmed: number[] = [];
    for (let time = 0; time < 2500; time += SAMPLE_MS) {
      const steps = detector.push(0, 0, GRAVITY + wave(2.5, 550)(time), time);
      if (steps > 0) confirmed.push(steps);
    }
    expect(confirmed[0]).toBe(3);
  });

  it("ignores a jolt of nearly twice gravity, which a hand gives and a footfall doesn't", () => {
    expect(countSteps(wave(9, 600), 8000)).toBe(0);
  });

  it("recovers after a gap in the sensor stream", () => {
    const detector = new StepDetector();
    let steps = 0;
    for (let time = 0; time < 3000; time += SAMPLE_MS) {
      steps += detector.push(0, 0, GRAVITY + wave(2.5, 550)(time), time);
    }
    const before = steps;
    for (let time = 9000; time < 12000; time += SAMPLE_MS) {
      steps += detector.push(0, 0, GRAVITY + wave(2.5, 550)(time), time);
    }
    expect(steps).toBeGreaterThan(before);
  });
});

/** Steps counted while `model` handles the phone for 15 s, over ten seeds; with and without the gyroscope. */
function handledSteps(model: HandlingModel): { withGyroscope: number; without: number } {
  let withGyroscope = 0;
  let without = 0;
  for (let seed = 1; seed <= 10; seed += 1) {
    const gated = new StepDetector();
    const blind = new StepDetector();
    simulateHandling(model, 15000, seed, {
      orientation: () => {},
      motion: (x, y, z, time, rotation) => {
        withGyroscope += gated.push(x, y, z, time, rotation);
        without += blind.push(x, y, z, time);
      },
    });
  }
  return { withGyroscope, without };
}

/** A walk with corners, some sharper than a right angle: every step taken, and every step counted. */
function walkedSteps(swayDegrees: number): { taken: number; counted: number; fastestTilt: number } {
  const path = [
    { x: 0, y: 0 },
    { x: 0, y: 8 },
    { x: 6, y: 8 },
    { x: 6, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: 10 },
    { x: 4, y: 3 },
  ];
  let taken = 0;
  let counted = 0;
  let fastestTilt = 0;
  for (let seed = 1; seed <= 5; seed += 1) {
    const detector = new StepDetector();
    simulateWalk(path, { ...TYPICAL_WALK, swayDegrees }, seed, {
      orientation: () => {},
      motion: (x, y, z, time, rotation) => {
        counted += detector.push(x, y, z, time, rotation);
        fastestTilt = Math.max(fastestTilt, detector.tiltDegreesPerSecond);
      },
      stepped: () => {
        taken += 1;
      },
    });
  }
  return { taken, counted, fastestTilt };
}

describe("the phone moved about in the hand", () => {
  it("counts no steps while the phone is waved about", () => {
    const { withGyroscope, without } = handledSteps(WAVING);
    // The accelerometer alone takes the waving for a walk: the dot ran off across the store.
    expect(without).toBeGreaterThan(100);
    expect(withGyroscope).toBe(0);
  });

  it("counts almost none for smaller handling, like gesturing with it", () => {
    const { withGyroscope, without } = handledSteps(FIDGETING);
    expect(withGyroscope).toBeLessThan(without / 10);
  });

  it("still counts every step of a walk, round corners and with the phone swaying", () => {
    const typical = walkedSteps(TYPICAL_WALK.swayDegrees);
    expect(typical.counted).toBe(typical.taken);
    // Turning a corner is about the vertical, so it barely registers as tipping.
    expect(typical.fastestTilt).toBeLessThan(50);
    // Even swaying twice as much, well under the hand's speed.
    const loose = walkedSteps(TYPICAL_WALK.swayDegrees * 2);
    expect(loose.counted).toBe(loose.taken);
  });

  it("counts steps again once the phone is held still to walk", () => {
    const detector = new StepDetector();
    simulateHandling(WAVING, 5000, 7, {
      orientation: () => {},
      motion: (x, y, z, time, rotation) => detector.push(x, y, z, time, rotation),
    });
    let counted = 0;
    let taken = 0;
    simulateWalk([{ x: 0, y: 0 }, { x: 0, y: 10 }], TYPICAL_WALK, 7, {
      orientation: () => {},
      motion: (x, y, z, time, rotation) => {
        counted += detector.push(x, y, z, 5000 + time, rotation);
      },
      stepped: () => {
        taken += 1;
      },
    });
    // Walking off the moment the waving stops, the hold-off and the tilt settling
    // cost about a second of it: two steps, then every one counts.
    expect(counted).toBeGreaterThanOrEqual(taken - 2);
  });
});

import { describe, expect, it } from "vitest";

import { seededRandom } from "./simulatedWalk";
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

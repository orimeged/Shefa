import { describe, expect, it } from "vitest";

import {
  angleDifference,
  bearingBetween,
  circularMean,
  deviceYaw,
  normalizeDegrees,
  vectorAlong,
} from "./angles";

describe("bearings", () => {
  const origin = { x: 0, y: 0 };

  it("measures clockwise from +y", () => {
    expect(bearingBetween(origin, { x: 0, y: 1 })).toBeCloseTo(0);
    expect(bearingBetween(origin, { x: 1, y: 0 })).toBeCloseTo(90);
    expect(bearingBetween(origin, { x: 0, y: -1 })).toBeCloseTo(180);
    expect(bearingBetween(origin, { x: -1, y: 0 })).toBeCloseTo(270);
  });

  it("turns a bearing back into a vector", () => {
    expect(vectorAlong(90, 2).x).toBeCloseTo(2);
    expect(vectorAlong(90, 2).y).toBeCloseTo(0);
  });

  it("takes the short way round", () => {
    expect(angleDifference(350, 10)).toBe(20);
    expect(angleDifference(10, 350)).toBe(-20);
  });

  it("normalizes negative angles", () => {
    expect(normalizeDegrees(-90)).toBe(270);
  });

  it("averages across north", () => {
    const mean = circularMean([350, 10]);
    expect(Math.min(mean, 360 - mean)).toBeCloseTo(0);
  });
});

describe("deviceYaw", () => {
  it("reads a phone lying flat", () => {
    expect(deviceYaw(0, 0, 0)).toBeCloseTo(0);
    expect(deviceYaw(90, 0, 0)).toBeCloseTo(270);
    expect(deviceYaw(270, 0, 0)).toBeCloseTo(90);
  });

  it("reads a phone standing upright", () => {
    expect(deviceYaw(0, 90, 0)).toBeCloseTo(0);
    expect(deviceYaw(90, 90, 0)).toBeCloseTo(270);
  });

  it("does not move when the phone only tilts forward", () => {
    for (const beta of [0, 20, 40, 60, 80, 90]) {
      expect(deviceYaw(120, beta, 0)).toBeCloseTo(240);
    }
  });

  it("barely moves with a slight sideways tilt at a natural grip", () => {
    const difference = angleDifference(deviceYaw(120, 40, 0), deviceYaw(120, 40, 10));
    expect(Math.abs(difference)).toBeLessThan(10);
  });
});

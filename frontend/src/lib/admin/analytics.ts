/** Turning the dashboard's numbers into what's drawn. */

import type { CountPair, HeatPoint, LostCategory } from "../../api/types";

export type TrendTone = "good" | "bad" | "neutral";

export interface Trend {
  direction: "up" | "down" | "flat";
  /** Null when last week was zero, where a percentage means nothing. */
  percent: number | null;
  tone: TrendTone;
}

/** More routes are good news and more missing items are bad, so the color depends on the figure. */
export function trendOf({ current, previous }: CountPair, upIsGood: boolean): Trend {
  if (current === previous) {
    return { direction: "flat", percent: 0, tone: "neutral" };
  }
  const direction = current > previous ? "up" : "down";
  return {
    direction,
    percent: previous === 0 ? null : Math.round((Math.abs(current - previous) / previous) * 100),
    tone: (direction === "up") === upIsGood ? "good" : "bad",
  };
}

/** Validated together for color blindness. Their order is part of that. */
const DEPARTMENT_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#6250d6"];
const OTHER_COLOR = "#b4b2a9";

export interface DepartmentSlice {
  key: string;
  /** Null for the slice that gathers everything else. */
  category: LostCategory | null;
  times: number;
  share: number;
  color: string;
}

/** A doughnut stops reading past six slices, so the smallest departments fold into one. */
export function departmentSlices(categories: readonly LostCategory[]): DepartmentSlice[] {
  const named = categories
    .filter((category) => category.category_name !== null)
    .sort((a, b) => b.times - a.times)
    .slice(0, DEPARTMENT_COLORS.length);
  const rest = categories.filter((category) => !named.includes(category));

  const slices: DepartmentSlice[] = named.map((category, index) => ({
    key: category.category_id ?? "",
    category,
    times: category.times,
    share: category.share,
    color: DEPARTMENT_COLORS[index]!,
  }));
  if (rest.length > 0) {
    slices.push({
      key: "other",
      category: null,
      times: rest.reduce((sum, category) => sum + category.times, 0),
      share: rest.reduce((sum, category) => sum + category.share, 0),
      color: OTHER_COLOR,
    });
  }
  return slices;
}

/** Cold to hot, and darker throughout, so it still reads with no color vision at all. */
const TRAFFIC_STOPS: readonly (readonly [number, readonly [number, number, number]])[] = [
  [0, [183, 211, 246]],
  [0.33, [242, 192, 120]],
  [0.66, [235, 104, 52]],
  [1, [180, 35, 24]],
];

const THINNEST_LINE_M = 0.22;
const WIDTH_RANGE_M = 1.05;

export function trafficColor(level: number): string {
  const clamped = Math.min(1, Math.max(0, level));
  const after = TRAFFIC_STOPS.findIndex(([stop]) => stop >= clamped);
  if (after <= 0) {
    return rgb(TRAFFIC_STOPS[0]![1]);
  }
  const [startAt, start] = TRAFFIC_STOPS[after - 1]!;
  const [endAt, end] = TRAFFIC_STOPS[after]!;
  const progress = (clamped - startAt) / (endAt - startAt);
  return rgb(start.map((value, index) => value + (end[index]! - value) * progress));
}

function rgb(channels: readonly number[]): string {
  return `rgb(${channels.map(Math.round).join(", ")})`;
}

/** The legend's bar: the same stops as the lines on the map. */
export const TRAFFIC_GRADIENT = `linear-gradient(to right, ${TRAFFIC_STOPS.map(
  ([stop, channels]) => `${rgb(channels)} ${stop * 100}%`,
).join(", ")})`;

export interface TrafficLine {
  color: string;
  width: number;
  level: number;
}

export function trafficLine(trips: number, busiest: number): TrafficLine | null {
  if (trips === 0 || busiest === 0) {
    return null;
  }
  const level = trips / busiest;
  return { color: trafficColor(level), width: THINNEST_LINE_M + WIDTH_RANGE_M * level, level };
}

export interface HeatSpot {
  key: string;
  x: number;
  y: number;
  radius: number;
  opacity: number;
}

const SMALLEST_SPOT_M = 2.2;
const SPOT_RANGE_M = 1.6;
const FAINTEST_SPOT = 0.4;

/**
 * Square roots keep a shelf with one report visible beside one with twenty. Spots
 * overlap, so a busy shelf grows hotter by itself and shouldn't need much help.
 */
export function heatSpots(points: readonly HeatPoint[]): HeatSpot[] {
  const hottest = Math.max(0, ...points.map((point) => point.count));
  return points.map(({ x, y, count }) => {
    const intensity = Math.sqrt(count / hottest);
    return {
      key: `${x},${y}`,
      x,
      y,
      radius: SMALLEST_SPOT_M + SPOT_RANGE_M * intensity,
      opacity: FAINTEST_SPOT + (1 - FAINTEST_SPOT) * intensity,
    };
  });
}

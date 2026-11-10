import type { RefObject } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import type { FrameOptions, Insets, Size, ViewBox } from "../lib/mapCamera";
import { flight, formatViewBox, frameFocus, NO_INSETS, unitsPerPixel } from "../lib/mapCamera";

/** A move between stations: long enough to follow, short enough not to wait for. */
export const FLIGHT_MS = 950;

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface CameraOptions extends FrameOptions {
  insets?: Insets;
  durationMs?: number;
}

/**
 * Points the map's camera at `focus` and flies there whenever it changes. It
 * writes the SVG's viewBox itself, every frame of a flight, so the map isn't
 * re-rendered sixty times a second; and it keeps `--u`, map units per screen
 * pixel, on the SVG, which keeps markers and badges one size on screen.
 *
 * Returns where the camera is headed, the map's size on screen once known, and
 * the view it has come to rest on: null while it's flying, so what is laid out
 * for a view, such as badges, can wait for it to land.
 */
export function useMapCamera(
  svg: RefObject<SVGSVGElement | null>,
  focus: ViewBox,
  { insets = NO_INSETS, minSpan, durationMs = FLIGHT_MS }: CameraOptions = {},
): { view: ViewBox | null; screen: Size | null; resting: ViewBox | null } {
  const [screen, setScreen] = useState<Size | null>(null);
  const [landed, setLanded] = useState<ViewBox | null>(null);
  const shown = useRef<ViewBox | null>(null);
  const shownOn = useRef<Size | null>(null);

  // Measured before the first paint, then kept up as the map's box changes.
  useLayoutEffect(() => {
    const element = svg.current;
    if (!element) {
      return;
    }
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setScreen((last) => (last && last.width === width && last.height === height ? last : { width, height }));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [svg]);

  const focusKey = formatViewBox(focus);
  const insetsKey = `${insets.top},${insets.right},${insets.bottom},${insets.left}`;
  const view = useMemo(
    () => (screen ? frameFocus(focus, screen, insets, { minSpan }) : null),
    // Keyed by value, not by the objects: a new one with the same numbers is the same shot.
    [screen, focusKey, insetsKey, minSpan],
  );

  useLayoutEffect(() => {
    const element = svg.current;
    if (!element || !view || !screen) {
      return;
    }
    const show = (next: ViewBox) => {
      shown.current = next;
      element.setAttribute("viewBox", formatViewBox(next));
      element.style.setProperty("--u", String(unitsPerPixel(next, screen)));
    };
    const from = shown.current;
    // The first shot, a resized map, or a wish for less motion: straight there.
    const resized = shownOn.current !== screen;
    shownOn.current = screen;
    if (!from || resized || durationMs <= 0 || prefersReducedMotion()) {
      show(view);
      setLanded(view);
      return;
    }
    const path = flight(from, view);
    const started = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - started) / durationMs);
      show(path(t));
      if (t < 1) {
        frame = requestAnimationFrame(step);
      } else {
        setLanded(view);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [svg, view, screen, durationMs]);

  return { view, screen, resting: landed === view ? view : null };
}

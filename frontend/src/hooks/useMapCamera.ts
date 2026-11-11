import type { RefObject } from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { FrameOptions, Insets, Size, ViewBox } from "../lib/mapCamera";
import { flight, formatViewBox, frameFocus, NO_INSETS, unitsPerPixel } from "../lib/mapCamera";
import type { Point } from "../lib/mapGeometry";
import { clampView, flickVelocity, GLIDE_DECAY_MS, GLIDE_STOP, panBy, pinch, zoomAt } from "../lib/mapGestures";

/** A move between stations: long enough to follow, short enough not to wait for. */
export const FLIGHT_MS = 950;
/** A double tap's zoom, and how close together its two taps must be. */
const DOUBLE_TAP_ZOOM = 2;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_PX = 30;
/** A finger that moves less than this is tapping, not dragging. */
const TAP_PX = 8;
/** Never closer than this many map units across: a few tiles fill a phone. */
const CLOSEST_SPAN = 4;
/** Never further out than the whole store with this much room round it. */
const FURTHEST_ZOOM_OUT = 1.6;
/** A wheel notch of 100 pixels zooms by about 15%. */
const WHEEL_ZOOM_PER_PX = 0.0015;
/** After the last wheel notch, the map is taken to be at rest. */
const WHEEL_REST_MS = 180;

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface CameraOptions extends FrameOptions {
  insets?: Insets;
  durationMs?: number;
  /** The store's extent, which the map can't be dragged away from. */
  bounds?: ViewBox;
  /** Drag, pinch, wheel and double tap move the map. */
  interactive?: boolean;
}

export interface Camera {
  /** Where the camera frames, once the map's size is known. */
  view: ViewBox | null;
  screen: Size | null;
  /** The view it has come to rest on: null while it flies, so badges can wait for it to land. */
  resting: ViewBox | null;
  /** The shopper has moved the map away from the frame. */
  isFree: boolean;
  /** Flies back to the frame. */
  recenter: () => void;
}

/**
 * The map's camera. It points at `focus`, framed in the part of the map that
 * `insets` leave clear, and flies there whenever that changes; in between, a
 * shopper may drag, pinch and zoom it, and a new frame, or `recenter`, brings it
 * back. It writes the SVG's viewBox itself, every frame, so the map isn't
 * re-rendered sixty times a second, and keeps `--u`, map units per screen pixel,
 * on the SVG, which keeps markers and badges one size on screen.
 */
export function useMapCamera(
  svg: RefObject<SVGSVGElement | null>,
  focus: ViewBox,
  { insets = NO_INSETS, minSpan, durationMs = FLIGHT_MS, bounds, interactive = false }: CameraOptions = {},
): Camera {
  const [screen, setScreen] = useState<Size | null>(null);
  const [resting, setResting] = useState<ViewBox | null>(null);
  const [isFree, setIsFree] = useState(false);
  const shown = useRef<ViewBox | null>(null);
  const shownOn = useRef<Size | null>(null);
  const motion = useRef(0);

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

  // Keyed by value, not by the objects: a new one with the same numbers is the same shot.
  const focusKey = formatViewBox(focus);
  const insetsKey = `${insets.top},${insets.right},${insets.bottom},${insets.left}`;
  const boundsKey = bounds ? formatViewBox(bounds) : "";
  const view = useMemo(
    () => (screen ? frameFocus(focus, screen, insets, { minSpan }) : null),
    [screen, focusKey, insetsKey, minSpan],
  );
  const limits = useMemo(() => {
    if (!screen || !bounds) {
      return null;
    }
    const whole = frameFocus(bounds, screen, insets, { minSpan: 0.01 });
    return { bounds, minWidth: CLOSEST_SPAN, maxWidth: whole.width * FURTHEST_ZOOM_OUT };
  }, [screen, boundsKey, insetsKey]);

  const show = useCallback(
    (next: ViewBox) => {
      const element = svg.current;
      if (!element || !screen) {
        return;
      }
      shown.current = next;
      element.setAttribute("viewBox", formatViewBox(next));
      element.style.setProperty("--u", String(unitsPerPixel(next, screen)));
    },
    [svg, screen],
  );

  const stop = useCallback(() => cancelAnimationFrame(motion.current), []);

  const flyTo = useCallback(
    (target: ViewBox, ms: number) => {
      stop();
      if (!shown.current || ms <= 0 || prefersReducedMotion()) {
        show(target);
        setResting(target);
        return;
      }
      setResting(null);
      const path = flight(shown.current, target);
      const started = performance.now();
      motion.current = requestAnimationFrame(function step(now) {
        const t = Math.min(1, (now - started) / ms);
        show(path(t));
        if (t < 1) {
          motion.current = requestAnimationFrame(step);
        } else {
          setResting(target);
        }
      });
    },
    [show, stop],
  );

  // A new frame, such as the next station's: back from wherever the shopper took the map.
  useLayoutEffect(() => {
    if (!view || !screen) {
      return;
    }
    setIsFree(false);
    // The first shot, or a resized map: straight there.
    const resized = shownOn.current !== screen;
    shownOn.current = screen;
    flyTo(view, !shown.current || resized ? 0 : durationMs);
    return stop;
  }, [view, screen, durationMs, flyTo, stop]);

  const recenter = useCallback(() => {
    if (view) {
      setIsFree(false);
      flyTo(view, durationMs);
    }
  }, [view, durationMs, flyTo]);

  // ---------- Gestures ----------
  useLayoutEffect(() => {
    const element = svg.current;
    if (!element || !interactive || !screen) {
      return;
    }
    const pointers = new Map<number, Point>();
    const moves: { time: number; dx: number; dy: number }[] = [];
    let tap: { at: Point; moved: boolean; startedAt: number } | null = null;
    let lastTap: { time: number; at: Point } | null = null;
    let lastTouch = -Infinity;
    let wheelRest = 0;

    const local = (event: { clientX: number; clientY: number }): Point => {
      const box = element.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    const within = (next: ViewBox) => (limits ? clampView(next, limits) : next);
    const takeOver = () => {
      stop();
      window.clearTimeout(wheelRest);
      setIsFree(true);
    };
    const settle = () => {
      if (shown.current) setResting({ ...shown.current });
    };
    const zoomInAt = (at: Point) => {
      if (shown.current) flyTo(within(zoomAt(shown.current, DOUBLE_TAP_ZOOM, at, screen)), 300);
    };

    // A flick keeps the map moving, slowing as a phone's own lists do.
    const glide = (velocity: Point) => {
      let speed = velocity;
      let last = performance.now();
      motion.current = requestAnimationFrame(function step(now) {
        const elapsed = Math.min(48, now - last);
        last = now;
        if (!shown.current || Math.hypot(speed.x, speed.y) < GLIDE_STOP) {
          settle();
          return;
        }
        show(within(panBy(shown.current, speed.x * elapsed, speed.y * elapsed, screen)));
        const decay = Math.exp(-elapsed / GLIDE_DECAY_MS);
        speed = { x: speed.x * decay, y: speed.y * decay };
        motion.current = requestAnimationFrame(step);
      });
    };

    const onDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      element.setPointerCapture(event.pointerId);
      const at = local(event);
      pointers.set(event.pointerId, at);
      moves.length = 0;
      tap = pointers.size === 1 ? { at, moved: false, startedAt: event.timeStamp } : null;
      takeOver();
    };

    const onMove = (event: PointerEvent) => {
      const before = pointers.get(event.pointerId);
      if (!before || !shown.current) return;
      const at = local(event);
      if (tap && Math.hypot(at.x - tap.at.x, at.y - tap.at.y) > TAP_PX) tap.moved = true;
      const other = [...pointers].find(([id]) => id !== event.pointerId)?.[1];
      pointers.set(event.pointerId, at);
      if (other) {
        // Two fingers: the other one where it was, this one before and after.
        show(within(pinch(shown.current, [before, other], [at, other], screen)));
        return;
      }
      moves.push({ time: event.timeStamp, dx: at.x - before.x, dy: at.y - before.y });
      show(within(panBy(shown.current, at.x - before.x, at.y - before.y, screen)));
    };

    const onUp = (event: PointerEvent) => {
      if (!pointers.delete(event.pointerId)) return;
      if (event.pointerType === "touch") lastTouch = event.timeStamp;
      if (pointers.size > 0) {
        // Down to one finger: a flick from here on is that finger's alone.
        moves.length = 0;
        return;
      }
      const at = local(event);
      if (tap && !tap.moved && event.timeStamp - tap.startedAt < 300) {
        // A second tap close by and soon after the first zooms in there.
        if (lastTap && event.timeStamp - lastTap.time < DOUBLE_TAP_MS && Math.hypot(at.x - lastTap.at.x, at.y - lastTap.at.y) < DOUBLE_TAP_PX) {
          lastTap = null;
          zoomInAt(at);
          return;
        }
        lastTap = { time: event.timeStamp, at };
      }
      const velocity = flickVelocity(moves, event.timeStamp);
      if (!prefersReducedMotion() && Math.hypot(velocity.x, velocity.y) > GLIDE_STOP * 4) {
        glide(velocity);
      } else {
        settle();
      }
    };

    const onWheel = (event: WheelEvent) => {
      // The map zooms, the page doesn't.
      event.preventDefault();
      if (!shown.current) return;
      takeOver();
      const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      show(within(zoomAt(shown.current, Math.exp(-pixels * WHEEL_ZOOM_PER_PX), local(event), screen)));
      wheelRest = window.setTimeout(settle, WHEEL_REST_MS);
    };

    const onDoubleClick = (event: MouseEvent) => {
      // A browser may follow two taps with a double click: the pointers zoomed already.
      if (event.timeStamp - lastTouch < 700) return;
      takeOver();
      zoomInAt(local(event));
    };

    // Safari's own pinch, which would zoom the whole page.
    const onGesture = (event: Event) => event.preventDefault();

    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointercancel", onUp);
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("dblclick", onDoubleClick);
    element.addEventListener("gesturestart", onGesture);
    return () => {
      stop();
      window.clearTimeout(wheelRest);
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onUp);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("dblclick", onDoubleClick);
      element.removeEventListener("gesturestart", onGesture);
    };
  }, [svg, interactive, screen, limits, show, stop, flyTo]);

  return { view, screen, resting, isFree, recenter };
}

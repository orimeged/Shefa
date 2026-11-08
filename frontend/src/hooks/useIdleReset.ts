import { useEffect, useRef } from "react";

import { IdleTimer } from "../lib/kiosk/idleTimer";

// Pointer events cover touch. Keys and input cover the tablet's on-screen keyboard.
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "input", "scroll"] as const;

/** Calls `onIdle` when the screen has gone untouched for `timeoutMs`. */
export function useIdleReset(timeoutMs: number, onIdle: () => void): void {
  const latest = useRef(onIdle);
  useEffect(() => {
    latest.current = onIdle;
  });

  useEffect(() => {
    const timer = new IdleTimer(timeoutMs, () => latest.current());
    // Capturing, so a list that scrolls by itself or stops a click still counts.
    const options = { capture: true, passive: true };
    ACTIVITY_EVENTS.forEach((type) => window.addEventListener(type, timer.activity, options));
    timer.activity();

    return () => {
      timer.stop();
      ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, timer.activity, options));
    };
  }, [timeoutMs]);
}

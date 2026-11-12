import { useEffect, useState } from "react";

import { ACTIVITY_EVENTS } from "./useIdleReset";

/**
 * True once the screen has gone untouched for `afterMs` while `armed`, until the
 * next touch. The kiosk uses it to say it's about to start over, so whoever is
 * still reading the map isn't surprised when it clears.
 */
export function useIdleWarning(afterMs: number, armed: boolean): boolean {
  const [isWarning, setIsWarning] = useState(false);

  useEffect(() => {
    if (!armed) {
      return;
    }
    let timer = setTimeout(() => setIsWarning(true), afterMs);
    const activity = () => {
      clearTimeout(timer);
      setIsWarning(false);
      timer = setTimeout(() => setIsWarning(true), afterMs);
    };
    const options = { capture: true, passive: true };
    ACTIVITY_EVENTS.forEach((type) => window.addEventListener(type, activity, options));
    return () => {
      clearTimeout(timer);
      setIsWarning(false);
      ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, activity, options));
    };
  }, [afterMs, armed]);

  return armed && isWarning;
}

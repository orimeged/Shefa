import { useEffect } from "react";

import type { WakeLockProvider } from "../lib/kiosk/screenWakeLock";
import { ScreenWakeLock } from "../lib/kiosk/screenWakeLock";

function browserWakeLock(): WakeLockProvider | undefined {
  return (navigator as Navigator & { wakeLock?: WakeLockProvider }).wakeLock;
}

/** Keeps the screen on while mounted. False means this page can't: it needs HTTPS. */
export function useWakeLock(): boolean {
  useEffect(() => {
    const lock = new ScreenWakeLock(
      browserWakeLock(),
      () => document.visibilityState === "visible",
    );
    const acquire = () => void lock.acquire();

    acquire();
    // The browser drops the lock when the page is hidden. Some also want a touch first.
    document.addEventListener("visibilitychange", acquire);
    window.addEventListener("pointerdown", acquire);

    return () => {
      document.removeEventListener("visibilitychange", acquire);
      window.removeEventListener("pointerdown", acquire);
      lock.close();
    };
  }, []);

  return browserWakeLock() !== undefined;
}

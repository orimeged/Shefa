import { useCallback, useEffect, useRef, useState } from "react";

import type { Point } from "../lib/mapGeometry";
import { angleDifference } from "../lib/positioning/angles";
import type { EngineOptions, LivePosition } from "../lib/positioning/engine";
import { DEFAULT_STEP_LENGTH_M, PositioningEngine } from "../lib/positioning/engine";
import type { ObstacleField } from "../lib/positioning/obstacles";
import type { WalkableEdge } from "../lib/positioning/walkGraph";

export type PositioningStatus =
  | "idle"
  | "requesting"
  /** Sensors are on, and the first steps are setting the heading. */
  | "calibrating"
  | "tracking"
  | "denied"
  | "unsupported"
  /** Browsers only offer motion sensors over HTTPS. */
  | "insecure"
  /** Permission was given, but the phone sends no readings. */
  | "no-data";

interface Options {
  startNode: Point;
  edges: readonly WalkableEdge[];
  /** Shelves and walls, which steps can't pass through. */
  obstacles?: ObstacleField;
  stepLengthM?: number;
  /** The way in from the entrance, and the map's own tuning. */
  engineOptions?: EngineOptions;
  /** The route being walked, as its legs' node ids: the dot keeps to it. Null for none. */
  route?: readonly (readonly string[])[] | null;
}

const NO_DATA_TIMEOUT_MS = 3000;
const HEADING_UPDATE_INTERVAL_MS = 100;
const HEADING_UPDATE_MIN_DEGREES = 2;

interface PermissionGatedSensor {
  requestPermission?: () => Promise<"granted" | "denied">;
}

/** iOS asks once for both sensors, and only from inside a tap. Other browsers don't ask. */
async function requestSensorPermission(): Promise<boolean> {
  const sensors = [DeviceOrientationEvent, DeviceMotionEvent] as unknown as PermissionGatedSensor[];
  try {
    const answers = await Promise.all(sensors.map((sensor) => sensor.requestPermission?.()));
    return answers.every((answer) => answer === undefined || answer === "granted");
  } catch {
    return false;
  }
}

/** Sensors stop when the screen sleeps, and nobody touches a phone while walking an aisle. */
function keepScreenOn(): () => void {
  let lock: WakeLockSentinel | null = null;
  let released = false;

  const acquire = () => {
    navigator.wakeLock
      ?.request("screen")
      .then((sentinel) => {
        if (released) {
          void sentinel.release();
        } else {
          lock = sentinel;
        }
      })
      .catch(() => {
        // Optional: tracking still works for as long as the screen stays on.
      });
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      acquire();
    }
  };

  acquire();
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    released = true;
    void lock?.release();
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

/**
 * Live position from the phone's own sensors, with no beacons or GPS.
 *
 * `start` must be called from a tap. `anchorTo` feeds in a position known for
 * sure, such as the shelf of an item the shopper just ticked: it clears drift
 * and teaches the engine this shopper's stride.
 */
export function useLiveIndoorPositioning({
  startNode,
  edges,
  obstacles,
  stepLengthM = DEFAULT_STEP_LENGTH_M,
  engineOptions,
  route = null,
}: Options) {
  const [status, setStatus] = useState<PositioningStatus>("idle");
  const [position, setPosition] = useState<LivePosition>({ ...startNode, heading: 0 });
  const [fixes, setFixes] = useState(0);
  const engineRef = useRef<PositioningEngine | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    teardownRef.current?.();
    teardownRef.current = null;
    engineRef.current = null;
    setStatus("idle");
  }, []);

  useEffect(() => () => teardownRef.current?.(), []);

  // A re-planned route, or a tick that moves on to the next leg, re-aims the pull.
  const routeRef = useRef(route);
  useEffect(() => {
    routeRef.current = route;
    engineRef.current?.followRoute(route);
  }, [route]);

  const start = useCallback(async () => {
    if (engineRef.current) {
      return;
    }
    if (!window.isSecureContext) {
      setStatus("insecure");
      return;
    }
    if (typeof DeviceMotionEvent === "undefined" || typeof DeviceOrientationEvent === "undefined") {
      setStatus("unsupported");
      return;
    }

    setStatus("requesting");
    if (!(await requestSensorPermission())) {
      setStatus("denied");
      return;
    }

    const engine = new PositioningEngine(startNode, edges, stepLengthM, obstacles, engineOptions);
    engine.followRoute(routeRef.current);
    engineRef.current = engine;
    setPosition(engine.snapshot);
    setStatus("calibrating");

    let sawOrientation = false;
    let sawMotion = false;
    let lastHeading = engine.snapshot.heading;
    let lastHeadingUpdateMs = 0;

    const publish = () => {
      const snapshot = engine.snapshot;
      lastHeading = snapshot.heading;
      setPosition(snapshot);
    };

    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha === null) {
        return;
      }
      sawOrientation = true;
      engine.handleOrientation(event.alpha, event.beta ?? 0, event.gamma ?? 0);

      // Sensors fire at 60 Hz: the map only redraws when the change is visible.
      const heading = engine.snapshot.heading;
      const turned = Math.abs(angleDifference(lastHeading, heading));
      if (
        event.timeStamp - lastHeadingUpdateMs >= HEADING_UPDATE_INTERVAL_MS &&
        turned >= HEADING_UPDATE_MIN_DEGREES
      ) {
        lastHeadingUpdateMs = event.timeStamp;
        publish();
      }
    };

    const onMotion = (event: DeviceMotionEvent) => {
      const acceleration = event.accelerationIncludingGravity;
      if (acceleration?.x == null || acceleration.y == null || acceleration.z == null) {
        return;
      }
      sawMotion = true;
      if (engine.handleMotion(acceleration.x, acceleration.y, acceleration.z, event.timeStamp)) {
        publish();
        if (engine.isCalibrated) {
          setStatus("tracking");
        }
      }
    };

    window.addEventListener("deviceorientation", onOrientation);
    window.addEventListener("devicemotion", onMotion);
    const releaseScreen = keepScreenOn();

    const teardown = () => {
      clearTimeout(noDataTimer);
      window.removeEventListener("deviceorientation", onOrientation);
      window.removeEventListener("devicemotion", onMotion);
      releaseScreen();
    };
    teardownRef.current = teardown;

    const noDataTimer = setTimeout(() => {
      if (!sawOrientation || !sawMotion) {
        teardown();
        teardownRef.current = null;
        engineRef.current = null;
        setStatus("no-data");
      }
    }, NO_DATA_TIMEOUT_MS);
  }, [startNode, edges, obstacles, stepLengthM, engineOptions]);

  const anchorTo = useCallback((point: Point) => {
    const engine = engineRef.current;
    if (engine) {
      engine.anchorTo(point);
      setPosition(engine.snapshot);
      setFixes((count) => count + 1);
    }
  }, []);

  return { ...position, fixes, status, start, stop, anchorTo };
}

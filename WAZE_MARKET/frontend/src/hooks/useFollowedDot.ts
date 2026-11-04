import type { RefObject } from "react";
import { useLayoutEffect, useRef } from "react";

import type { MapLayout } from "../lib/mapGeometry";
import { translateTo } from "../lib/mapGeometry";
import type { LivePosition } from "../lib/positioning/engine";
import { easeHeading, PathFollower } from "../lib/positioning/follower";
import type { WalkGraph } from "../lib/positioning/walkGraph";

/** A tab coming back from the background shouldn't fling the dot in one frame. */
const MAX_FRAME_MS = 100;

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Draws the live dot gliding along the paths and its cone turning smoothly. It
 * writes to the SVG every frame itself, so the map isn't re-rendered 60 times a
 * second, and the elements must not get those attributes from React too.
 */
export function useFollowedDot(
  live: LivePosition | null,
  graph: WalkGraph,
  layout: MapLayout,
  marker: RefObject<SVGGElement | null>,
  cone: RefObject<SVGPathElement | null>,
): void {
  const follower = useRef<PathFollower | null>(null);
  const heading = useRef({ shown: 0, target: 0 });
  const isLive = live !== null;
  const { x, y, heading: liveHeading } = live ?? {};

  // Each new estimate is queued as the walk to it along the paths.
  useLayoutEffect(() => {
    if (x === undefined || y === undefined || liveHeading === undefined) {
      follower.current = null;
      return;
    }
    const target = { x, y };
    const current = follower.current;
    if (!current) {
      follower.current = new PathFollower(target);
      heading.current = { shown: liveHeading, target: liveHeading };
      return;
    }
    heading.current.target = liveHeading;
    if (current.target.x === x && current.target.y === y) {
      return;
    }
    if (prefersReducedMotion()) {
      current.jumpTo(target);
      heading.current.shown = liveHeading;
    } else {
      current.extend(graph.pathBetween(graph.nearest(current.target), graph.nearest(target)));
    }
  }, [x, y, liveHeading, graph]);

  useLayoutEffect(() => {
    if (!isLive) {
      return;
    }
    let frame = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const elapsed = Math.min(MAX_FRAME_MS, Math.max(0, now - last));
      last = now;
      const current = follower.current;
      if (current) {
        const spot = layout.toSvg(current.advance(elapsed));
        marker.current?.style.setProperty("transform", translateTo(spot));
        heading.current.shown = easeHeading(heading.current.shown, heading.current.target, elapsed);
        cone.current?.setAttribute("transform", `rotate(${heading.current.shown})`);
      }
      frame = requestAnimationFrame(draw);
    };
    // Drawn before the first paint, so the dot never shows a frame with no position.
    draw(last);
    return () => cancelAnimationFrame(frame);
  }, [isLive, layout, marker, cone]);
}

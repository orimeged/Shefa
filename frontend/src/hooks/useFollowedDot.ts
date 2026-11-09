import type { RefObject } from "react";
import { useLayoutEffect, useRef } from "react";

import type { CameraState } from "../lib/mapCamera";
import { cameraTransform, followZoom, parseViewBox, unitsPerMetre, uprightAngle } from "../lib/mapCamera";
import type { MapLayout } from "../lib/mapGeometry";
import { translateTo } from "../lib/mapGeometry";
import type { LivePosition } from "../lib/positioning/engine";
import { easeHeading, PathFollower } from "../lib/positioning/follower";
import type { WalkGraph } from "../lib/positioning/walkGraph";

/** A tab coming back from the background shouldn't fling the dot in one frame. */
const MAX_FRAME_MS = 100;
/** The move into navigation mode and back out, about two thirds of a second. */
const CAMERA_BLEND_MS = 220;
/**
 * The map turns slower than the cone: the cone shows every turn of the hand, the
 * map only the way the shopper walks, so it doesn't swing at each glance aside.
 */
const CAMERA_TURN_LAG_MS = 650;

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface FollowCamera {
  /** The group holding the map's content, which the camera moves. */
  world: RefObject<SVGGElement | null>;
  /** Navigation mode: follow the dot, closer in, its heading up. */
  follow: boolean;
}

/** Labels marked to stay readable: "up" ones level, "along" ones along their shelf. */
function setLabels(world: SVGGElement, turn: number | null): void {
  for (const label of world.querySelectorAll<SVGElement>("[data-upright]")) {
    const { x = "0", y = "0", angle = "0", upright } = label.dataset;
    const base = Number(angle);
    if (turn === null) {
      // Back to how they were drawn.
      if (base === 0) {
        label.removeAttribute("transform");
      } else {
        label.setAttribute("transform", `rotate(${base} ${x} ${y})`);
      }
      continue;
    }
    const rotation = upright === "along" ? uprightAngle(base, turn) : turn;
    label.setAttribute("transform", `rotate(${rotation} ${x} ${y})`);
  }
}

/**
 * Draws the live dot gliding along the paths and its cone turning smoothly, and
 * in navigation mode moves the camera with it. It writes to the SVG every frame
 * itself, so the map isn't re-rendered 60 times a second, and the elements must
 * not get those attributes from React too.
 */
export function useFollowedDot(
  live: LivePosition | null,
  graph: WalkGraph | null,
  layout: MapLayout,
  marker: RefObject<SVGGElement | null>,
  cone: RefObject<SVGPathElement | null>,
  camera?: FollowCamera,
): void {
  const follower = useRef<PathFollower | null>(null);
  const heading = useRef({ shown: 0, target: 0 });
  const view = useRef<CameraState>({ zoom: 1, rotation: 0, blend: 0 });
  const following = useRef(false);
  following.current = Boolean(camera?.follow);
  const world = camera?.world;
  const isLive = live !== null;
  const { x, y, heading: liveHeading, fixes = 0 } = live ?? {};
  const fixesSeen = useRef(fixes);

  // Each new estimate is queued as the walk to it along the paths.
  useLayoutEffect(() => {
    if (x === undefined || y === undefined || liveHeading === undefined) {
      follower.current = null;
      return;
    }
    const target = { x, y };
    const current = follower.current;
    const isFix = fixes !== fixesSeen.current;
    fixesSeen.current = fixes;
    if (!current) {
      follower.current = new PathFollower(target);
      heading.current = { shown: liveHeading, target: liveHeading };
      view.current.rotation = liveHeading;
      return;
    }
    heading.current.target = liveHeading;
    if (current.target.x === x && current.target.y === y) {
      return;
    }
    if (prefersReducedMotion() || !graph) {
      current.jumpTo(target);
      heading.current.shown = liveHeading;
    } else {
      current.extend(graph.pathBetween(graph.nearest(current.target), graph.nearest(target)), {
        isFix,
      });
    }
  }, [x, y, liveHeading, fixes, graph]);

  useLayoutEffect(() => {
    if (!isLive) {
      return;
    }
    const box = parseViewBox(layout.viewBox);
    const zoom = followZoom(box, unitsPerMetre(layout.toSvg));
    const calm = prefersReducedMotion();
    let frame = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const elapsed = Math.min(MAX_FRAME_MS, Math.max(0, now - last));
      last = now;
      const current = follower.current;
      if (current) {
        const spot = layout.toSvg(current.advance(elapsed));
        heading.current.shown = easeHeading(heading.current.shown, heading.current.target, elapsed);
        cone.current?.setAttribute("transform", `rotate(${heading.current.shown})`);

        const state = view.current;
        const goal = following.current ? 1 : 0;
        state.blend = calm ? goal : state.blend + (goal - state.blend) * (1 - Math.exp(-elapsed / CAMERA_BLEND_MS));
        state.rotation = calm
          ? heading.current.target
          : easeHeading(state.rotation, heading.current.shown, elapsed, CAMERA_TURN_LAG_MS);
        state.zoom = zoom;
        const scale = 1 + (zoom - 1) * state.blend;
        const group = world?.current;
        if (group && state.blend > 0.001) {
          group.setAttribute("transform", cameraTransform(box, spot, state));
          setLabels(group, state.rotation * state.blend);
        } else if (group) {
          group.removeAttribute("transform");
          setLabels(group, null);
        }
        // The dot keeps its size on screen however far the camera zooms in.
        marker.current?.style.setProperty("transform", `${translateTo(spot)} scale(${1 / scale})`);
      }
      frame = requestAnimationFrame(draw);
    };
    // Drawn before the first paint, so the dot never shows a frame with no position.
    draw(last);
    return () => {
      cancelAnimationFrame(frame);
      view.current.blend = 0;
      const group = world?.current;
      if (group) {
        group.removeAttribute("transform");
        setLabels(group, null);
      }
    };
  }, [isLive, layout, marker, cone, world]);
}

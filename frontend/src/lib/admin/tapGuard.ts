import type { Point } from "../mapGeometry";

/** About a fingertip's wobble. Anything further is someone dragging the map. */
const MAX_TAP_MOVEMENT_PX = 8;

/** Dragging the map also ends in a click, which mustn't open the shelf under the pointer. */
export function isTap(pressedAt: Point | null, releasedAt: Point): boolean {
  return (
    pressedAt !== null &&
    Math.hypot(releasedAt.x - pressedAt.x, releasedAt.y - pressedAt.y) <= MAX_TAP_MOVEMENT_PX
  );
}

/**
 * The camera of navigation mode: the map follows the shopper, closer in, turned
 * so the way they face points up the screen, the way a satnav does it.
 *
 * Everything is in the SVG's own units. The camera only moves the map's content:
 * the SVG keeps its viewBox, so the whole store is one blend away.
 */

import type { Point } from "./mapGeometry";

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraState {
  /** How far in, 1 being the whole store. */
  zoom: number;
  /** The heading that points up the screen, in degrees clockwise from the map's up. */
  rotation: number;
  /** 0 is the whole store as drawn, 1 the camera on the shopper; between, the move into it. */
  blend: number;
}

/** About this many metres across the screen: an aisle and what's either side of it. */
export const FOLLOW_WINDOW_M = 16;
/** The shopper sits below the middle, so more of what lies ahead is in view. */
export const FOLLOW_ANCHOR_Y = 0.64;

export function parseViewBox(viewBox: string): ViewBox {
  const [x = 0, y = 0, width = 1, height = 1] = viewBox.trim().split(/[\s,]+/).map(Number);
  return { x, y, width, height };
}

/** The zoom that shows about `windowM` metres across, never less than the whole store. */
export function followZoom(view: ViewBox, unitsPerMetre: number, windowM = FOLLOW_WINDOW_M): number {
  return Math.max(1, view.width / (windowM * unitsPerMetre));
}

function lerp(a: Point, b: Point, share: number): Point {
  return { x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share };
}

/** Where on the view the shopper is shown once the camera follows them. */
export function followAnchor(view: ViewBox): Point {
  return { x: view.x + view.width / 2, y: view.y + view.height * FOLLOW_ANCHOR_Y };
}

/**
 * An SVG transform for the map's content: `spot` moved to the follow anchor,
 * turned by -rotation so that heading points up, and scaled by the zoom. At blend
 * 0 it is no transform at all; every value eases between, so going in is a move.
 */
export function cameraTransform(view: ViewBox, spot: Point, { zoom, rotation, blend }: CameraState): string {
  const centre = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  const at = lerp(centre, followAnchor(view), blend);
  const pivot = lerp(centre, spot, blend);
  const scale = 1 + (zoom - 1) * blend;
  const turn = -rotation * blend;
  return `translate(${at.x} ${at.y}) rotate(${turn}) scale(${scale}) translate(${-pivot.x} ${-pivot.y})`;
}

/** Where a point of the map lands on the view under the camera: the same transform, worked out. */
export function onView(view: ViewBox, spot: Point, camera: CameraState, point: Point): Point {
  const centre = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  const at = lerp(centre, followAnchor(view), camera.blend);
  const pivot = lerp(centre, spot, camera.blend);
  const scale = 1 + (camera.zoom - 1) * camera.blend;
  const radians = (-camera.rotation * camera.blend * Math.PI) / 180;
  const dx = (point.x - pivot.x) * scale;
  const dy = (point.y - pivot.y) * scale;
  return {
    x: at.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: at.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

function signed(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/**
 * The rotation to give a label on a map turned by `rotation`, so it keeps lying
 * along its shelf (`base`) but never reads upside down on the screen.
 */
export function uprightAngle(base: number, rotation: number): number {
  const onScreen = signed(base - rotation);
  // A quarter turn either way still reads; past it, the label flips over.
  const readable = onScreen > 90 ? onScreen - 180 : onScreen < -90 ? onScreen + 180 : onScreen;
  return readable + rotation;
}

/** SVG units per metre, from a layout's own conversion: 1 on the graph, one per tile on a plan. */
export function unitsPerMetre(toSvg: (point: Point) => Point): number {
  const a = toSvg({ x: 0, y: 0 });
  const b = toSvg({ x: 1, y: 0 });
  return Math.hypot(b.x - a.x, b.y - a.y);
}

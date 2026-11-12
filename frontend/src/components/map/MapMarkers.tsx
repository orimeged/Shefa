import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { Point } from "../../lib/mapGeometry";
import { BADGE_HEIGHT_PX, badgeWidth, COMPACT_BADGE_PX } from "../../lib/mapLabels";
import { CategoryIcon } from "../CategoryIcon";

/** --color-next and --color-brand: SVG paint takes a colour, and these must match the sheet's. */
const NEXT = "#f2a33a";
const BRAND = "#0b7a5b";
const BRAND_STRONG = "#064e3a";
const INK = "#16201c";
const DONE = "#a8a29e";
const DANGER = "#b42318";

/** A teardrop standing on its point, 15 px round, its middle 26 px up. */
const TEARDROP = "M0 0 C-3 -7 -15 -13 -15 -26 A15 15 0 1 1 15 -26 C15 -13 3 -7 0 0 Z";

/**
 * Drawn in screen pixels at a point of the map: one size on screen at any zoom.
 * `--u` (map units per pixel) comes from the camera, `--marker-scale` from the
 * view, larger on the kiosk's big screen.
 */
export function OnScreen({
  at,
  className,
  nudgePx = 0,
  isLabel = false,
  children,
}: {
  at: Point;
  className?: string;
  /** Pixels to the side, for markers that share a spot. */
  nudgePx?: number;
  /** A label keeps its size where the view enlarges markers: the names have to fit side by side. */
  isLabel?: boolean;
  children: ReactNode;
}) {
  const scale = isLabel ? "var(--u, 0.08)" : "calc(var(--u, 0.08) * var(--marker-scale, 1))";
  return (
    <g className={className} style={{ transform: `translate(${at.x}px, ${at.y}px) scale(${scale})` }}>
      {nudgePx ? <g transform={`translate(${nudgePx} 0)`}>{children}</g> : children}
    </g>
  );
}

/** The station being headed for: an orange pin with its department's icon, breathing at its foot. */
export function NextStationPin({ at, categoryId }: { at: Point; categoryId: string }) {
  return (
    <OnScreen at={at}>
      <g data-station="next">
        <ellipse rx={12} ry={4.5} fill={NEXT} className="ground-pulse" />
        <g className="pin-drop" style={{ filter: "drop-shadow(0 3px 4px rgb(15 23 42 / 0.35))" }}>
          <path d={TEARDROP} fill={NEXT} stroke="#ffffff" strokeWidth={2.5} strokeLinejoin="round" />
          <CategoryIcon categoryId={categoryId} x={-9} y={-35} size={18} color={INK} strokeWidth={2.2} />
        </g>
      </g>
    </OnScreen>
  );
}

/** A station still to come, with its number in the trip. */
export function StationPin({ at, number, nudgePx = 0 }: { at: Point; number: number; nudgePx?: number }) {
  return (
    <OnScreen at={at} nudgePx={nudgePx}>
      <g data-station="ahead" style={{ filter: "drop-shadow(0 1px 2px rgb(15 23 42 / 0.25))" }}>
        <circle r={11} fill="#ffffff" stroke={BRAND} strokeWidth={2.5} />
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={12}
          fontWeight={700}
          fill={BRAND_STRONG}
          direction="ltr"
        >
          {number}
        </text>
      </g>
    </OnScreen>
  );
}

/** A station behind the shopper: ticked off, or given up as not on the shelf. */
export function DoneStationPin({ at, missing = false, nudgePx = 0 }: { at: Point; missing?: boolean; nudgePx?: number }) {
  return (
    <OnScreen at={at} nudgePx={nudgePx}>
      <g data-station={missing ? "missing" : "done"}>
        <circle r={9} fill={missing ? "#fdecea" : DONE} stroke={missing ? DANGER : "#ffffff"} strokeWidth={2} />
        <path
          d={missing ? "M-3.2 -3.2 L3.2 3.2 M3.2 -3.2 L-3.2 3.2" : "M-4 0.4 L-1.3 3.1 L4.1 -2.6"}
          fill="none"
          stroke={missing ? DANGER : "#ffffff"}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </OnScreen>
  );
}

/** Where the shopper stands: the last station reached, or the entrance. Not a live position. */
export function HereMarker({ at }: { at: Point }) {
  return (
    <OnScreen at={at}>
      <g data-here="">
        <circle r={14} fill={INK} opacity={0.1} />
        <circle r={8} fill="#ffffff" style={{ filter: "drop-shadow(0 1px 2px rgb(15 23 42 / 0.4))" }} />
        <circle r={4.5} fill={INK} />
      </g>
    </OnScreen>
  );
}

interface PillProps {
  at: Point;
  text: string;
  isRtl: boolean;
  /** The icon's circle; null draws none. */
  accent: string;
  children: ReactNode;
  dark?: boolean;
  /** Pixels below its point. */
  dropPx?: number;
  className?: string;
}

/** A rounded label in screen pixels: an icon in a coloured circle, then the name. */
function Pill({ at, text, isRtl, accent, children, dark = false, dropPx = 0, className }: PillProps) {
  const width = badgeWidth(text);
  const half = width / 2;
  const iconX = isRtl ? half - 11 : -half + 11;
  const textX = isRtl ? half - 22 : -half + 22;
  return (
    <OnScreen at={at} className={className} isLabel>
      <g
        transform={dropPx ? `translate(0 ${dropPx})` : undefined}
        style={{ filter: "drop-shadow(0 1px 3px rgb(15 23 42 / 0.22))" }}
      >
        <rect
          x={-half}
          y={-BADGE_HEIGHT_PX / 2}
          width={width}
          height={BADGE_HEIGHT_PX}
          rx={BADGE_HEIGHT_PX / 2}
          fill={dark ? INK : "#ffffff"}
        />
        <circle cx={iconX} r={8} fill={accent} />
        <g transform={`translate(${iconX - 5.5} -5.5)`}>{children}</g>
        <text
          x={textX}
          // Text is laid out left to right here, Hebrew runs within it still read right to left.
          direction="ltr"
          textAnchor={isRtl ? "end" : "start"}
          dominantBaseline="central"
          fontSize={11}
          fontWeight={600}
          fill={dark ? "#ffffff" : INK}
        >
          {text}
        </text>
      </g>
    </OnScreen>
  );
}

interface DepartmentBadgeProps {
  at: Point;
  name: string;
  categoryId: string | undefined;
  accent: string;
  isRtl: boolean;
  shown: boolean;
  /** Its icon alone, where the camera leaves no room for the name. */
  compact?: boolean;
  isNext: boolean;
}

/** A department's name and icon on its shelf, so a shopper knows where they are by what's around. */
export function DepartmentBadge({ at, name, categoryId, accent, isRtl, shown, compact = false, isNext }: DepartmentBadgeProps) {
  const icon = <CategoryIcon categoryId={categoryId ?? ""} size={11} color="#ffffff" strokeWidth={2.4} />;
  return (
    <g
      data-badge={name}
      data-shown={shown || undefined}
      data-compact={(shown && compact) || undefined}
      aria-hidden
      className={`map-badge ${shown ? "" : "is-hidden"}`}
    >
      {compact ? (
        <OnScreen at={at} isLabel>
          <g style={{ filter: "drop-shadow(0 1px 3px rgb(15 23 42 / 0.25))" }}>
            <circle r={COMPACT_BADGE_PX / 2} fill="#ffffff" />
            <circle r={COMPACT_BADGE_PX / 2 - 2} fill={isNext ? NEXT : accent} />
            <g transform="translate(-4.5 -4.5) scale(0.82)">{icon}</g>
          </g>
        </OnScreen>
      ) : (
        <Pill at={at} text={name} isRtl={isRtl} accent={isNext ? NEXT : accent}>
          {icon}
        </Pill>
      )}
    </g>
  );
}

/** The end of the trip: the tills, once every station is done. */
export function CheckoutPin({ at, icon: Icon }: { at: Point; icon: LucideIcon }) {
  return (
    <OnScreen at={at}>
      <g data-station="checkout">
        <ellipse rx={12} ry={4.5} fill={BRAND} className="ground-pulse" />
        <g className="pin-drop" style={{ filter: "drop-shadow(0 3px 4px rgb(15 23 42 / 0.35))" }}>
          <path d={TEARDROP} fill={BRAND} stroke="#ffffff" strokeWidth={2.5} strokeLinejoin="round" />
          <Icon x={-9} y={-35} size={18} color="#ffffff" strokeWidth={2.2} />
        </g>
      </g>
    </OnScreen>
  );
}

/** The entrance and the tills, dark so they read as fixed points rather than departments. */
interface EndpointBadgeProps {
  at: Point;
  text: string;
  icon: LucideIcon;
  isRtl: boolean;
  /** Below the point, clear of what stands on it, such as the shopper at the door. */
  dropPx?: number;
  /** False where the camera would cut it off. */
  shown?: boolean;
}

export function EndpointBadge({ at, text, icon: Icon, isRtl, dropPx = 0, shown = true }: EndpointBadgeProps) {
  return (
    <g data-endpoint={text} aria-hidden className={`map-badge ${shown ? "" : "is-hidden"}`}>
      <Pill at={at} text={text} isRtl={isRtl} accent={BRAND} dark dropPx={dropPx}>
        <Icon size={11} color="#ffffff" strokeWidth={2.4} />
      </Pill>
    </g>
  );
}

interface AisleNameProps {
  /** The shelf's whole name, which identifies it. */
  name: string;
  /** As written: shortened if the gondola is too short for it. */
  text: string;
  /** A column's subcategory, close in; a gondola's department, further out. */
  level: "subcategory" | "department";
  /** The middle of the shelf's raised top, in map units. */
  at: Point;
  /** In map units, to fit across the shelf. */
  fontSize: number;
  colour: string;
  isNext: boolean;
}

/**
 * A gondola's name written along it, as an aisle's sign would be: every gondola
 * named the same way, whatever room the camera leaves between them.
 */
export function AisleName({ name, text, level, at, fontSize, colour, isNext }: AisleNameProps) {
  return (
    <text
      data-badge={name}
      data-shown=""
      data-aisle={level}
      aria-hidden
      x={at.x}
      y={at.y}
      transform={`rotate(-90 ${at.x} ${at.y})`}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={fontSize}
      fontWeight={isNext ? 800 : 650}
      fill={isNext ? INK : colour}
      className="pointer-events-none"
    >
      {text}
    </text>
  );
}

/** A department's icon over the top end of its gondola: a row of them along the store. */
export function AisleSign({ at, categoryId, accent }: { at: Point; categoryId: string; accent: string }) {
  return (
    <OnScreen at={at} isLabel>
      <g data-aisle-sign={categoryId} aria-hidden transform="translate(0 -13)" style={{ filter: "drop-shadow(0 1px 2px rgb(15 23 42 / 0.25))" }}>
        <circle r={9.5} fill="#ffffff" />
        <circle r={7.5} fill={accent} />
        <g transform="translate(-5 -5)">
          <CategoryIcon categoryId={categoryId} size={10} color="#ffffff" strokeWidth={2.4} />
        </g>
      </g>
    </OnScreen>
  );
}

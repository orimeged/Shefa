import { useId } from "react";

import { usePresence } from "../hooks/usePresence";
import { zoneTone } from "../lib/zoneCode";

export interface ZonePin {
  key: string;
  x: number;
  y: number;
  code: string;
  tone: number;
}

/** Two pins on facing shelves of one aisle sit this far apart, so they just touch. */
const RADIUS_M = 1.35;
const EXIT_MS = 260;
const pinKey = (pin: ZonePin) => pin.key;

/**
 * A shelf's code in a coloured disc, standing on the shelf on the map. Each item
 * keeps its colour, which it shares with its card in the list. New pins drop in
 * and removed ones shrink away rather than vanishing.
 */
export function ZonePins({ pins }: { pins: readonly ZonePin[] }) {
  // useId gives characters that aren't safe inside url(#...).
  const shadow = `zone-shadow-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const shown = usePresence(pins, pinKey, EXIT_MS);

  return (
    <g>
      <defs>
        <filter id={shadow} x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx={0} dy={0.16} stdDeviation={0.22} floodColor="#16201c" floodOpacity={0.4} />
        </filter>
      </defs>
      {shown.map(({ item: pin, leaving }) => (
        <g
          key={pin.key}
          data-zone={pin.code}
          className={leaving ? "zone-pin is-leaving" : "zone-pin"}
          style={{ transform: `translate(${pin.x}px, ${pin.y}px)` }}
        >
          <g className="zone-pin-body" filter={`url(#${shadow})`}>
            <circle
              r={RADIUS_M}
              style={{ fill: zoneTone(pin.tone) }}
              className="stroke-surface"
              strokeWidth={0.26}
            />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              direction="ltr"
              fontSize={1.05}
              fontWeight={800}
              className="fill-white"
            >
              {pin.code}
            </text>
          </g>
        </g>
      ))}
    </g>
  );
}

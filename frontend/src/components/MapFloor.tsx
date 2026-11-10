import { useId, useMemo } from "react";

import type { BlockColours } from "../lib/departments";
import { departmentColours, PLAIN_SHELF, TILL, WALL } from "../lib/departments";
import type { MapLayout, Rect } from "../lib/mapGeometry";

const LABEL_OFFSET_M = 1.9;

/**
 * How far each kind of block stands up, in map units: the top is drawn that
 * much higher than the footprint, and the side shows in between, as seen by
 * someone looking down at the store from a little in front of it.
 */
export const BLOCK_LIFT = { shelf: 0.3, wall: 0.45, till: 0.22 } as const;

/** Where a block's shadow falls: down and a little to the side, as if lit from above the entrance. */
const SHADOW = { dx: 0.12, dy: 0.32 };

/** The next station's department stands out with the next station's orange. */
const HIGHLIGHT = "#f2a33a";

type BlockKind = keyof typeof BLOCK_LIFT;

interface Block extends Rect {
  key: string;
  kind: BlockKind;
  label?: string;
  colours: BlockColours;
}

interface MapFloorProps {
  layout: MapLayout;
  /** A department to pick out, such as the next station's. */
  highlight?: string | null;
  /** Names written along the shelves, for managers' maps; shoppers' maps carry badges instead. */
  showShelfNames?: boolean;
}

/**
 * The store itself, under whatever a view draws on top of it: the floor flat and
 * light, and everything that stands on it raised, with its shadow, its side and
 * its top, each department in its own colour.
 */
export function MapFloor({ layout, highlight = null, showShelfNames = true }: MapFloorProps) {
  const ids = useId().replace(/:/g, "");
  const blocks = useMemo(() => blocksOf(layout), [layout]);
  const isPlan = layout.kind === "floor";

  return (
    <>
      <defs>
        <filter id={`${ids}-shade`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={0.22} />
        </filter>
        <filter id={`${ids}-lift`} x="-10%" y="-10%" width="120%" height="125%">
          <feDropShadow dx={0} dy={0.25} stdDeviation={0.5} floodColor="#0f172a" floodOpacity={0.14} />
        </filter>
        {/* Floor tiles: a hairline every tile, barely there. */}
        <pattern id={`${ids}-tiles`} width={1} height={1} patternUnits="userSpaceOnUse">
          <path d="M1 0H0V1" fill="none" stroke="#0f172a" strokeOpacity={0.05} strokeWidth={0.035} />
        </pattern>
      </defs>

      <rect {...layout.floor} rx={0.6} className="fill-surface" filter={`url(#${ids}-lift)`} />
      {isPlan && <rect {...layout.floor} rx={0.6} fill={`url(#${ids}-tiles)`} />}
      <rect {...layout.floor} rx={0.6} fill="none" className="stroke-line" strokeWidth={0.08} />

      {layout.walkways.map(({ key, from, to }) => (
        <line
          key={key}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          className="stroke-paper"
          strokeWidth={1.1}
          strokeLinecap="round"
        />
      ))}

      {layout.doors?.map((door) => (
        <rect key={`${door.x},${door.y}`} {...door} data-block="door" className="fill-brand-soft" />
      ))}

      {/* Every shadow in one blurred layer, under every block. */}
      <g filter={`url(#${ids}-shade)`} fill="#0f172a" opacity={0.2} className="pointer-events-none">
        {blocks.map((block) => (
          <rect
            key={block.key}
            x={block.x + SHADOW.dx}
            y={block.y + SHADOW.dy}
            width={block.width}
            height={block.height}
            rx={radiusOf(block, layout)}
          />
        ))}
      </g>

      {blocks.map((block) => {
        const lift = BLOCK_LIFT[block.kind];
        const radius = radiusOf(block, layout);
        const isPicked = highlight !== null && block.label === highlight;
        return (
          <g key={block.key} data-block={block.kind} data-label={block.label} data-picked={isPicked || undefined}>
            <rect x={block.x} y={block.y} width={block.width} height={block.height} rx={radius} fill={block.colours.side} />
            <rect
              x={block.x}
              y={block.y - lift}
              width={block.width}
              height={block.height}
              rx={radius}
              fill={block.colours.top}
              stroke={isPicked ? HIGHLIGHT : "#ffffff"}
              strokeOpacity={isPicked ? 1 : 0.6}
              strokeWidth={isPicked ? 2.5 : 1}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}

      {showShelfNames &&
        layout.shelfNames?.map(({ key, text, fontSize, isVertical, x, y }) => {
          const top = y - BLOCK_LIFT.shelf;
          return (
            <text
              key={key}
              x={x}
              y={top}
              transform={isVertical ? `rotate(-90 ${x} ${top})` : undefined}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={fontSize}
              fontWeight={600}
              className="pointer-events-none fill-ink"
            >
              {text}
            </text>
          );
        })}

      {layout.sectionDots.map(({ x, y }) => (
        <circle key={`${x},${y}`} cx={x} cy={y} r={0.16} className="fill-muted/40" />
      ))}

      {layout.aisleLabels.map(({ aisleNo, x, y }) => (
        <text
          key={aisleNo}
          x={x}
          y={y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={1.15}
          fontWeight={600}
          className="fill-muted"
        >
          {aisleNo}
        </text>
      ))}
    </>
  );
}

/**
 * Shelves, walls and tills, furthest first: a block lower on the map is nearer
 * the viewer, so its raised top is drawn over the side of the one behind it.
 */
function blocksOf(layout: MapLayout): Block[] {
  const colours = departmentColours(layout.shelfNames?.map((name) => name.key) ?? []);
  const blocks: Block[] = [
    ...layout.shelves.map((shelf) => ({
      ...shelf,
      key: `shelf:${shelf.x},${shelf.y}`,
      kind: "shelf" as const,
      colours: (shelf.label && colours.get(shelf.label)) || PLAIN_SHELF,
    })),
    ...(layout.walls ?? []).map((wall) => ({ ...wall, key: `wall:${wall.x},${wall.y}`, kind: "wall" as const, colours: WALL })),
    ...(layout.counters ?? []).map((till) => ({ ...till, key: `till:${till.x},${till.y}`, kind: "till" as const, colours: TILL })),
  ];
  return blocks.sort((a, b) => a.y + a.height - (b.y + b.height) || a.x - b.x);
}

function radiusOf(block: Block, layout: MapLayout): number {
  if (block.kind === "wall") return 0.06;
  if (block.kind === "till") return 0.14;
  return layout.shelfRadius ?? 0.35;
}

export function MapEndpoint({ point, label }: { point: { x: number; y: number }; label: string }) {
  return (
    <g>
      <rect
        x={point.x - 1.3}
        y={point.y - 0.22}
        width={2.6}
        height={0.44}
        rx={0.22}
        className="fill-ink"
      />
      <text
        x={point.x}
        y={point.y + LABEL_OFFSET_M - 0.3}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={1.2}
        fontWeight={600}
        className="fill-ink"
      >
        {label}
      </text>
    </g>
  );
}

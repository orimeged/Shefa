import type { MapLayout } from "../lib/mapGeometry";

const LABEL_OFFSET_M = 1.9;

interface MapFloorProps {
  layout: MapLayout;
  /** Shoppers' maps use a darker shelf, readable in a store's glare. */
  shelfClassName?: string;
}

/** The store itself, under whatever a view draws on top of it. */
export function MapFloor({ layout, shelfClassName = "fill-shelf" }: MapFloorProps) {
  return (
    <>
      <rect {...layout.floor} rx={1} className="fill-surface stroke-line" strokeWidth={0.12} />

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
        <rect key={`${door.x},${door.y}`} {...door} className="fill-brand-soft" />
      ))}

      {layout.shelves.map((shelf) => (
        <rect
          key={`${shelf.x},${shelf.y}`}
          {...shelf}
          rx={layout.shelfRadius ?? 0.35}
          className={shelfClassName}
        />
      ))}

      {/* A drawn plan's walls and checkout counters, which the graph's map doesn't have. */}
      {layout.walls?.map((wall) => (
        <rect key={`${wall.x},${wall.y}`} {...wall} className="fill-ink" />
      ))}
      {layout.counters?.map((counter) => (
        <rect key={`${counter.x},${counter.y}`} {...counter} rx={0.12} className="fill-sky-700" />
      ))}
      {layout.shelfNames?.map(({ key, text, fontSize, isVertical, x, y }) => (
        <text
          key={key}
          x={x}
          y={y}
          transform={isVertical ? `rotate(-90 ${x} ${y})` : undefined}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fontSize}
          fontWeight={600}
          className="pointer-events-none fill-ink"
        >
          {text}
        </text>
      ))}

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

import { useMemo } from "react";

import type { EdgeFlow, HeatPoint } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import { heatSpots, TRAFFIC_GRADIENT, trafficLine } from "../../lib/admin/analytics";
import type { MapLayout } from "../../lib/mapGeometry";

const HEAT_COLOR = "#dc2626";

/** Sits on top of the shelves, but lets every click through to the zone under it. */
export function HeatLayer({ points, layout }: { points: readonly HeatPoint[]; layout: MapLayout }) {
  const spots = useMemo(() => heatSpots(points), [points]);

  return (
    <g data-layer="heat" className="pointer-events-none" style={{ mixBlendMode: "multiply" }}>
      <defs>
        <radialGradient id="heat-spot">
          <stop offset="0%" stopColor={HEAT_COLOR} stopOpacity={0.42} />
          <stop offset="45%" stopColor={HEAT_COLOR} stopOpacity={0.2} />
          <stop offset="100%" stopColor={HEAT_COLOR} stopOpacity={0} />
        </radialGradient>
      </defs>
      {spots.map(({ key, x, y, radius, opacity }) => {
        const center = layout.toSvg({ x, y });
        return (
          <circle
            key={key}
            cx={center.x}
            cy={center.y}
            r={radius}
            fill="url(#heat-spot)"
            opacity={opacity}
          />
        );
      })}
    </g>
  );
}

export function TrafficLayer({
  edges,
  layout,
}: {
  edges: readonly EdgeFlow[];
  layout: MapLayout;
}) {
  const { t } = useLanguage();
  const lines = useMemo(() => {
    const busiest = Math.max(0, ...edges.map((edge) => edge.trips));
    const trips = new Map(edges.map((edge) => [`${edge.from_node}-${edge.to_node}`, edge.trips]));
    return layout.walkways
      .flatMap((walkway) => {
        const count = trips.get(walkway.key) ?? 0;
        const line = trafficLine(count, busiest);
        return line ? [{ ...walkway, ...line, count }] : [];
      })
      .sort((a, b) => a.level - b.level);
  }, [edges, layout]);

  return (
    <g data-layer="traffic">
      {lines.map(({ key, from, to, color, width, count }) => (
        <line
          key={key}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
        >
          <title>{t.trafficTrips(count)}</title>
        </line>
      ))}
    </g>
  );
}

interface MapLegendProps {
  heat: boolean;
  traffic: boolean;
  className: string;
}

export function MapLegend({ heat, traffic, className }: MapLegendProps) {
  const { t } = useLanguage();
  if (!heat && !traffic) {
    return null;
  }

  return (
    <div
      dir={t.direction}
      className={`pointer-events-none items-center gap-4 rounded-xl bg-white/90 px-3 py-1.5 text-xs whitespace-nowrap text-slate-600 shadow-sm ring-1 ring-slate-200 backdrop-blur-sm ${className}`}
    >
      {traffic && (
        <span className="flex items-center gap-2">
          {t.legendTrafficLow}
          <span
            aria-hidden
            className="h-2 w-20 rounded-full rtl:-scale-x-100"
            style={{ backgroundImage: TRAFFIC_GRADIENT }}
          />
          {t.legendTrafficHigh}
        </span>
      )}
      {heat && (
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-3.5 rounded-full"
            style={{
              backgroundImage: `radial-gradient(${HEAT_COLOR} 15%, transparent 72%)`,
            }}
          />
          {t.legendHeat}
        </span>
      )}
    </div>
  );
}

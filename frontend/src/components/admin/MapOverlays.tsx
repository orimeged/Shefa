import { useMemo } from "react";

import type { HeatPoint } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import { heatSpots } from "../../lib/admin/analytics";
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
        return <circle key={key} cx={center.x} cy={center.y} r={radius} fill="url(#heat-spot)" opacity={opacity} />;
      })}
    </g>
  );
}

/** What a red patch on the map means. */
export function HeatLegend({ className }: { className: string }) {
  const { t } = useLanguage();
  return (
    <div
      dir={t.direction}
      className={`pointer-events-none items-center gap-1.5 rounded-full bg-surface/90 px-3 py-1.5 text-xs whitespace-nowrap text-muted shadow-sm ring-1 ring-line backdrop-blur-sm ${className}`}
    >
      <span
        aria-hidden
        className="size-3.5 rounded-full"
        style={{ backgroundImage: `radial-gradient(${HEAT_COLOR} 15%, transparent 72%)` }}
      />
      {t.legendHeat}
    </div>
  );
}

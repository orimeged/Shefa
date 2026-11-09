import type { ReactNode } from "react";
import { useMemo } from "react";

import type { EdgeFlow, HeatPoint } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import { trafficLine } from "../../lib/admin/analytics";
import type { FloorMap } from "../../lib/floorPlanMap";
import { parseCellId } from "../../lib/floorPlanMap";
import { MapEndpoint, MapFloor } from "../MapFloor";
import { HeatLayer } from "./MapOverlays";

const TILE_LINE_SCALE = 0.5;

interface FloorAnalyticsMapProps {
  floor: FloorMap;
  /** Shoppers' "not here" reports, when the heat layer is on. */
  heat: readonly HeatPoint[] | null;
  /** Steps between tiles with the trips that took them, when the traffic layer is on. */
  cellEdges: readonly EdgeFlow[] | null;
  legend?: ReactNode;
}

/** The plan managers drew, with what shoppers did on it: where they walked, what they missed. */
export function FloorAnalyticsMap({ floor, heat, cellEdges, legend }: FloorAnalyticsMapProps) {
  const { t } = useLanguage();
  const { layout } = floor;
  return (
    <div className="relative overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200">
      <svg
        viewBox={layout.viewBox}
        role="img"
        aria-label={t.mapPanelTitle}
        data-map="floor"
        className="block h-auto max-h-[70vh] w-full"
      >
        <MapFloor layout={layout} />
        {cellEdges && <TileTrafficLayer edges={cellEdges} />}
        <MapEndpoint point={layout.entrance} label={t.entrance} />
        <MapEndpoint point={layout.checkout} label={t.checkout} />
        {heat && <HeatLayer points={heat} layout={layout} />}
      </svg>
      {legend}
    </div>
  );
}

/** Each step between two tiles, coloured and widened by how many trips took it. */
function TileTrafficLayer({ edges }: { edges: readonly EdgeFlow[] }) {
  const { t } = useLanguage();
  const lines = useMemo(() => {
    const busiest = edges.reduce((most, edge) => Math.max(most, edge.trips), 0);
    return edges
      .flatMap((edge) => {
        const from = parseCellId(edge.from_node);
        const to = parseCellId(edge.to_node);
        const line = trafficLine(edge.trips, busiest);
        return from && to && line
          ? [
              {
                key: `${edge.from_node}-${edge.to_node}`,
                // One SVG unit is one tile; a tile's middle is half a unit in.
                from: { x: from.col + 0.5, y: from.row + 0.5 },
                to: { x: to.col + 0.5, y: to.row + 0.5 },
                count: edge.trips,
                ...line,
                // Widths suit the graph's three-metre aisles; here a tile is the aisle.
                width: line.width * TILE_LINE_SCALE,
              },
            ]
          : [];
      })
      .sort((a, b) => a.level - b.level);
  }, [edges]);

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

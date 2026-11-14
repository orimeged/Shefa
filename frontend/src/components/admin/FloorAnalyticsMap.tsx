import type { ReactNode } from "react";

import type { HeatPoint } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { FloorMap } from "../../lib/floorPlanMap";
import { MapEndpoint, MapFloor } from "../MapFloor";
import { HeatLayer } from "./MapOverlays";

interface FloorAnalyticsMapProps {
  floor: FloorMap;
  /** Shoppers' "not here" reports; null while they load. */
  heat: readonly HeatPoint[] | null;
  legend?: ReactNode;
}

/** The plan managers drew, with where shoppers said "not here" glowing on it. */
export function FloorAnalyticsMap({ floor, heat, legend }: FloorAnalyticsMapProps) {
  const { t } = useLanguage();
  const { layout } = floor;
  return (
    <div className="relative overflow-hidden rounded-2xl bg-paper ring-1 ring-line">
      <svg
        viewBox={layout.viewBox}
        role="img"
        aria-label={t.overviewHeatTitle}
        data-map="floor"
        className="block h-auto max-h-[70vh] w-full"
      >
        <MapFloor layout={layout} />
        <MapEndpoint point={layout.entrance} label={t.entrance} />
        <MapEndpoint point={layout.checkout} label={t.checkout} />
        {heat && <HeatLayer points={heat} layout={layout} />}
      </svg>
      {legend}
    </div>
  );
}

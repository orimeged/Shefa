import { Flame, MapPin, Waypoints } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import type { AdminApi } from "../../api/adminClient";
import type { NotFoundReportRow, StoreMap, Zone } from "../../api/types";
import { usePolledReport } from "../../hooks/usePolledReport";
import { useLanguage } from "../../i18n/LanguageProvider";
import { buildMapLayout } from "../../lib/mapGeometry";
import { Notice } from "../Notice";
import { AdminMapEditor } from "./AdminMapEditor";
import { HeatLayer, MapLegend, TrafficLayer } from "./MapOverlays";

interface StoreMapPanelProps {
  api: AdminApi;
  map: StoreMap;
  zones: readonly Zone[];
  selectedNodeId: number | null;
  /** The alert whose item is getting a new shelf. */
  placing: NotFoundReportRow | null;
  refreshKey: number;
  onSelectZone: (nodeId: number) => void;
  onCancelPlacing: () => void;
}

/** The floor plan a manager edits, with what shoppers did drawn over it. */
export function StoreMapPanel({
  api,
  map,
  zones,
  selectedNodeId,
  placing,
  refreshKey,
  onSelectZone,
  onCancelPlacing,
}: StoreMapPanelProps) {
  const { t } = useLanguage();
  const layout = useMemo(() => buildMapLayout(map), [map]);
  const [showHeat, setShowHeat] = useState(true);
  const [showTraffic, setShowTraffic] = useState(false);
  const heat = usePolledReport(api.notFoundHeatmap, refreshKey);
  const traffic = usePolledReport(api.trafficFlow, refreshKey);
  const layerFailed = (showHeat && heat.failed) || (showTraffic && traffic.failed);

  return (
    <section
      aria-labelledby="store-map-title"
      className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="store-map-title" className="text-lg font-semibold text-slate-900">
          {t.mapPanelTitle}
        </h2>
        <div className="flex gap-2">
          <LayerToggle isOn={showHeat} onToggle={() => setShowHeat((on) => !on)}>
            <Flame aria-hidden className="size-4" />
            {t.layerHeat}
          </LayerToggle>
          <LayerToggle isOn={showTraffic} onToggle={() => setShowTraffic((on) => !on)}>
            <Waypoints aria-hidden className="size-4" />
            {t.layerTraffic}
          </LayerToggle>
        </div>
      </div>

      {layerFailed && (
        <Notice
          message={t.loadFailed}
          onRetry={() => {
            heat.retry();
            traffic.retry();
          }}
        />
      )}

      {placing && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl bg-next-soft px-4 py-2 ring-1 ring-next"
        >
          <MapPin aria-hidden className="size-5 shrink-0" />
          <p className="min-w-0 flex-1 font-medium">{t.placingBanner(placing.item_query)}</p>
          <button
            type="button"
            onClick={onCancelPlacing}
            className="min-h-11 shrink-0 rounded-xl px-3 font-medium text-muted"
          >
            {t.placingCancel}
          </button>
        </div>
      )}

      <AdminMapEditor
        layout={layout}
        zones={zones}
        selectedNodeId={selectedNodeId}
        onSelectZone={onSelectZone}
        underZones={
          showTraffic && traffic.data ? (
            <TrafficLayer edges={traffic.data.edges} layout={layout} />
          ) : null
        }
        overZones={
          showHeat && heat.data ? <HeatLayer points={heat.data.points} layout={layout} /> : null
        }
        legend={
          <MapLegend
            heat={showHeat}
            traffic={showTraffic}
            className="absolute bottom-16 left-1/2 z-10 hidden -translate-x-1/2 sm:flex"
          />
        }
      />
      {/* On a phone the store front is too shallow to float a legend over. */}
      <MapLegend
        heat={showHeat}
        traffic={showTraffic}
        className="flex self-center sm:hidden"
      />

      <p className="text-sm text-slate-500">{t.adminMapHint}</p>
    </section>
  );
}

function LayerToggle({
  isOn,
  onToggle,
  children,
}: {
  isOn: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={isOn}
      onClick={onToggle}
      className={`flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium ring-1 transition-colors ${
        isOn
          ? "bg-slate-900 text-white ring-slate-900"
          : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

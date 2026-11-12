import { Flame, Grid3x3, MapPin, Waypoints } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import type { AdminApi } from "../../api/adminClient";
import type { CatalogCategory, NotFoundReportRow, StoreMap, Zone } from "../../api/types";
import type { Catalog } from "../../hooks/useCatalog";
import { usePolledReport } from "../../hooks/usePolledReport";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { ShelfOption } from "../../lib/admin/catalog";
import type { FloorMap } from "../../lib/floorPlanMap";
import { buildMapLayout } from "../../lib/mapGeometry";
import { Notice } from "../Notice";
import { AdminMapEditor } from "./AdminMapEditor";
import { FloorAnalyticsMap, TileTrafficLayer } from "./FloorAnalyticsMap";
import { HeatLayer, MapLegend, TrafficLayer } from "./MapOverlays";
import { ShelvesMap } from "./ShelvesMap";

interface StoreMapPanelProps {
  api: AdminApi;
  map: StoreMap;
  /** The plan shoppers walk, once managers drew one that routes. */
  floor: FloorMap | null;
  /** The drawn plan's shelves products can stand on; with `floor`, they replace the graph's zones. */
  shelves: readonly ShelfOption[] | null;
  catalog: Catalog;
  categories: readonly CatalogCategory[];
  zones: readonly Zone[];
  selectedNodeId: number | null;
  /** The alert whose item is getting a new shelf. */
  placing: NotFoundReportRow | null;
  refreshKey: number;
  onSelectZone: (nodeId: number) => void;
  onCancelPlacing: () => void;
  /** A product went onto a drawn shelf for the alert being placed. */
  onPlaced: (row: NotFoundReportRow, shelf: string) => void;
}

/** The floor plan a manager edits, with what shoppers did drawn over it. */
export function StoreMapPanel({
  api,
  map,
  floor,
  shelves,
  catalog,
  categories,
  zones,
  selectedNodeId,
  placing,
  refreshKey,
  onSelectZone,
  onCancelPlacing,
  onPlaced,
}: StoreMapPanelProps) {
  const { t } = useLanguage();
  const layout = useMemo(() => buildMapLayout(map), [map]);
  const [showHeat, setShowHeat] = useState(true);
  const [showTraffic, setShowTraffic] = useState(false);
  const heat = usePolledReport(api.notFoundHeatmap, refreshKey);
  const traffic = usePolledReport(api.trafficFlow, refreshKey);
  const layerFailed = (showHeat && heat.failed) || (showTraffic && traffic.failed);
  const [view, setView] = useState<"floor" | "zones">("floor");
  // A store with a drawn plan keeps its products on that plan's shelves: the
  // graph's zones are what shoppers walked before it, so they'd be stale here.
  const showsShelves = floor !== null && shelves !== null && (view === "zones" || placing !== null);
  const showsFloor = floor !== null && !showsShelves;
  const tileLayers = (
    <>
      {showTraffic && traffic.data && <TileTrafficLayer edges={traffic.data.cell_edges ?? []} />}
      {showHeat && heat.data && floor && <HeatLayer points={heat.data.points} layout={floor.layout} />}
    </>
  );
  const floatingLegend = (
    <MapLegend
      heat={showHeat}
      traffic={showTraffic}
      className="absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 sm:flex"
    />
  );

  return (
    <section
      aria-labelledby="store-map-title"
      className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="store-map-title" className="text-lg font-semibold text-slate-900">
          {t.mapPanelTitle}
        </h2>
        <div className="flex flex-wrap gap-2">
          {floor && placing === null && (
            <div role="group" aria-label={t.floorViewLabel} className="flex rounded-full bg-slate-100 p-1">
              {(["floor", "zones"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={view === option}
                  onClick={() => setView(option)}
                  className={`flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium ${
                    view === option ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                  }`}
                >
                  {option === "floor" ? (
                    <Grid3x3 aria-hidden className="size-4" />
                  ) : (
                    <MapPin aria-hidden className="size-4" />
                  )}
                  {option === "floor" ? t.floorViewDrawn : t.floorViewZones}
                </button>
              ))}
            </div>
          )}
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

      {showsShelves && floor && shelves ? (
        <ShelvesMap
          floor={floor}
          shelves={shelves}
          catalog={catalog}
          categories={categories}
          placing={placing}
          layers={tileLayers}
          legend={floatingLegend}
          onPlaced={onPlaced}
        />
      ) : showsFloor && floor ? (
        <FloorAnalyticsMap
          floor={floor}
          heat={showHeat && heat.data ? heat.data.points : null}
          cellEdges={showTraffic && traffic.data ? (traffic.data.cell_edges ?? []) : null}
          legend={floatingLegend}
        />
      ) : (
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
      )}
      {/* On a phone the store front is too shallow to float a legend over. */}
      <MapLegend
        heat={showHeat}
        traffic={showTraffic}
        className="flex self-center sm:hidden"
      />

      <p className="text-sm text-slate-500">
        {showsShelves ? t.shelvesHint : showsFloor ? t.floorMapHint : t.adminMapHint}
      </p>
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

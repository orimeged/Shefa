import { MapPin, PencilRuler } from "lucide-react";
import { useMemo } from "react";

import type { CatalogCategory, NotFoundReportRow, StoreMap, Zone } from "../../api/types";
import type { Catalog } from "../../hooks/useCatalog";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { ShelfOption } from "../../lib/admin/catalog";
import type { FloorMap } from "../../lib/floorPlanMap";
import { buildMapLayout } from "../../lib/mapGeometry";
import { AdminMapEditor } from "./AdminMapEditor";
import { CARD, SECONDARY_BUTTON } from "./cards";
import { ShelvesMap } from "./ShelvesMap";

interface MapPanelProps {
  map: StoreMap;
  /** The plan shoppers walk, once managers drew one that routes. */
  floor: FloorMap | null;
  /** The drawn plan's shelves products can stand on. */
  shelves: readonly ShelfOption[] | null;
  catalog: Catalog;
  categories: readonly CatalogCategory[];
  /** The aisle zones of a store that has no drawn plan yet. */
  zones: readonly Zone[];
  selectedNodeId: number | null;
  /** The alert whose item is getting a new shelf. */
  placing: NotFoundReportRow | null;
  onSelectZone: (nodeId: number) => void;
  onCancelPlacing: () => void;
  /** A product went onto a drawn shelf for the alert being placed. */
  onPlaced: (row: NotFoundReportRow, shelf: string) => void;
  onEdit: () => void;
}

/**
 * The store's one map: every shelf, what's on it, and a way to add or move a
 * product onto it. The floor plan itself is drawn in the editor behind "Edit".
 */
export function MapPanel({
  map,
  floor,
  shelves,
  catalog,
  categories,
  zones,
  selectedNodeId,
  placing,
  onSelectZone,
  onCancelPlacing,
  onPlaced,
  onEdit,
}: MapPanelProps) {
  const { t } = useLanguage();
  const layout = useMemo(() => buildMapLayout(map), [map]);
  const hasPlan = floor !== null && shelves !== null;

  return (
    <section aria-labelledby="store-map-title" className={`${CARD} gap-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="store-map-title" className="text-2xl font-semibold text-ink">
            {t.mapPanelTitle}
          </h2>
          <p className="max-w-2xl text-muted">{hasPlan ? t.shelvesHint : t.mapNoPlan}</p>
        </div>
        {placing === null && (
          <button type="button" onClick={onEdit} className={SECONDARY_BUTTON}>
            <PencilRuler aria-hidden className="size-5" />
            {t.mapEdit}
          </button>
        )}
      </div>

      {placing && (
        <div role="status" className="flex items-center gap-3 rounded-2xl bg-next-soft px-4 py-2 ring-1 ring-next">
          <MapPin aria-hidden className="size-5 shrink-0" />
          <p className="min-w-0 flex-1 font-semibold">{t.placingBanner(placing.item_query)}</p>
          <button
            type="button"
            onClick={onCancelPlacing}
            className="min-h-11 shrink-0 rounded-xl px-3 font-medium text-muted"
          >
            {t.placingCancel}
          </button>
        </div>
      )}

      {hasPlan ? (
        <ShelvesMap
          floor={floor}
          shelves={shelves}
          catalog={catalog}
          categories={categories}
          placing={placing}
          onPlaced={onPlaced}
        />
      ) : (
        <>
          <AdminMapEditor layout={layout} zones={zones} selectedNodeId={selectedNodeId} onSelectZone={onSelectZone} />
          <p className="text-sm text-muted">{t.adminMapHint}</p>
        </>
      )}
    </section>
  );
}

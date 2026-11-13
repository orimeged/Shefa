import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AdminApi } from "../api/adminClient";
import { createAdminApi } from "../api/adminClient";
import type { CatalogCategory, NotFoundReportRow, Resolution, SavedFloorPlan, Zone } from "../api/types";
import { AdminLogin } from "../components/admin/AdminLogin";
import { CatalogPanel } from "../components/admin/CatalogPanel";
import { FloorGridEditor } from "../components/admin/FloorGridEditor";
import { KpiRow } from "../components/admin/KpiRow";
import { LostDemandWidget } from "../components/admin/LostDemandWidget";
import { LostSalesPanel } from "../components/admin/LostSalesPanel";
import { PickingCard } from "../components/admin/PickingCard";
import type { AlertOutcome } from "../components/admin/ShelfStockAlerts";
import { ShelfStockAlerts } from "../components/admin/ShelfStockAlerts";
import { SignsPanel } from "../components/admin/SignsPanel";
import { StoreMapPanel } from "../components/admin/StoreMapPanel";
import { ZoneManagementModal } from "../components/admin/ZoneManagementModal";
import { LanguageToggle } from "../components/LanguageToggle";
import { Notice } from "../components/Notice";
import { useCatalog } from "../hooks/useCatalog";
import { usePolledReport } from "../hooks/usePolledReport";
import { useStockAlerts } from "../hooks/useStockAlerts";
import { useStoreMap } from "../hooks/useStoreMap";
import { useLanguage } from "../i18n/LanguageProvider";
import { planShelves } from "../lib/admin/catalog";
import { createGrid, DEFAULT_CELL_SIZE_M, fromPayload, readCellSize } from "../lib/admin/floorGrid";
import { countAlerts } from "../lib/admin/stockAlerts";
import { readFloorMap } from "../lib/floorPlanMap";

// For this tab only: a shared tablet shouldn't stay signed in overnight.
const TOKEN_KEY = "admin-token";

type Tab = "dashboard" | "alerts" | "catalog" | "signs" | "floor";

export default function AdminView() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY));

  const signOut = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
  }, []);

  const api = useMemo(() => (token ? createAdminApi(token, signOut) : null), [token, signOut]);

  if (!api) {
    return (
      <AdminLogin
        onSignedIn={(entered) => {
          sessionStorage.setItem(TOKEN_KEY, entered);
          setToken(entered);
        }}
      />
    );
  }
  return <Dashboard api={api} onSignOut={signOut} />;
}

function Dashboard({ api, onSignOut }: { api: AdminApi; onSignOut: () => void }) {
  const { t } = useLanguage();
  const { map, failed: mapFailed, retry: retryMap } = useStoreMap();
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  // The editor loads its plan on first opening, not with every visit to the dashboard.
  const [hasOpenedFloor, setHasOpenedFloor] = useState(false);
  // Hundreds of rows: drawn once the tab is first opened, then kept with their filters.
  const [hasOpenedCatalog, setHasOpenedCatalog] = useState(false);
  /** The alert whose item is getting a new shelf, while a manager picks one on the map. */
  const [placing, setPlacing] = useState<NotFoundReportRow | null>(null);
  const [outcome, setOutcome] = useState<AlertOutcome | null>(null);
  /** Goes up when an alert closes, since the figures and the heat depend on them. */
  const [closedAlerts, setClosedAlerts] = useState(0);
  const mapSection = useRef<HTMLDivElement>(null);

  const alerts = useStockAlerts(api);
  const catalog = useCatalog(api);
  const alertCount = alerts.rows ? countAlerts(alerts.rows) : 0;
  const counts = usePolledReport(api.dashboardCounts, closedAlerts);
  const lostSales = usePolledReport(api.lostSales, closedAlerts);
  const picking = usePolledReport(api.picking);
  const lostDemand = usePolledReport(api.lostDemand);

  const reload = useCallback(() => setAttempt((current) => current + 1), []);

  // Loaded once for both the map panel and the editor; a save updates both.
  const [savedFloor, setSavedFloor] = useState<SavedFloorPlan | null | undefined>(undefined);
  const [floorFailed, setFloorFailed] = useState(false);
  const [floorAttempt, setFloorAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFloorFailed(false);
    api
      .floorPlan(controller.signal)
      // The same plan again keeps its objects, so the maps over it don't redraw.
      .then((next) =>
        setSavedFloor((current) => (current && next && current.updated_at === next.updated_at ? current : next)),
      )
      .catch(() => {
        if (!controller.signal.aborted) {
          setFloorFailed(true);
        }
      });
    return () => controller.abort();
  }, [api, floorAttempt]);
  const floor = useMemo(() => (savedFloor ? readFloorMap(savedFloor) : null), [savedFloor]);
  const shelves = useMemo(() => (floor && savedFloor ? planShelves(savedFloor.check) : null), [floor, savedFloor]);

  // The plan and the catalog can change elsewhere, in another tab or by a seed
  // script: both are read again whenever the dashboard comes back into view.
  const refresh = useCallback(() => {
    setFloorAttempt((current) => current + 1);
    catalog.reload();
  }, [catalog.reload]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    Promise.all([api.zones(controller.signal), api.categories(controller.signal)])
      .then(([nextZones, nextCategories]) => {
        setZones(nextZones);
        setCategories(nextCategories);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
        }
      });
    return () => controller.abort();
  }, [api, attempt]);

  const openTab = (next: Tab) => {
    setTab(next);
    setPlacing(null);
    if (next === "floor") {
      setHasOpenedFloor(true);
    } else if (next === "catalog") {
      setHasOpenedCatalog(true);
    }
    if (next !== tab && (next === "dashboard" || next === "catalog")) {
      refresh();
    }
  };

  const closeAlert = async (row: NotFoundReportRow, resolution: Resolution = "restocked") => {
    const closed = await alerts.resolve(row, resolution);
    if (closed) {
      setClosedAlerts((current) => current + 1);
    }
    return closed;
  };

  const markRestocked = async (row: NotFoundReportRow) => {
    setOutcome(null);
    if (!(await closeAlert(row))) {
      setOutcome({ ok: false, text: t.alertResolveFailed });
    }
  };

  const markOnShelf = async (row: NotFoundReportRow) => {
    setOutcome(null);
    setOutcome(
      (await closeAlert(row, "on_shelf"))
        ? { ok: true, text: t.alertOnShelfDone(row.item_query) }
        : { ok: false, text: t.alertResolveFailed },
    );
  };

  const startPlacing = (row: NotFoundReportRow) => {
    setOutcome(null);
    setPlacing(row);
    setTab("dashboard");
    // The table can be long, and the shelf to pick is on the map.
    requestAnimationFrame(() => mapSection.current?.scrollIntoView({ block: "start" }));
  };

  // The location is already saved here, so a failed close only leaves a false alert open.
  const finishPlacing = async (row: NotFoundReportRow, shelf?: string) => {
    const zone = shelf ?? zones?.find((candidate) => candidate.id === selectedNodeId)?.zone_name ?? "";
    setPlacing(null);
    setSelectedNodeId(null);
    setTab("alerts");
    setOutcome(
      (await closeAlert(row, "relocated"))
        ? { ok: true, text: t.alertMoved(row.item_query, zone) }
        : { ok: false, text: t.alertMovedStillOpen(row.item_query) },
    );
  };

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 pt-[calc(1rem+env(safe-area-inset-top))] sm:p-6">
        <header className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">{t.adminTitle}</h1>
            <p className="text-sm text-slate-500">
              {map?.name ? `${map.name} · ` : ""}
              {t.adminSubtitle}
            </p>
          </div>
          <LanguageToggle className="h-11" />
          <button
            type="button"
            onClick={onSignOut}
            className="flex h-11 items-center gap-2 rounded-full bg-white px-4 font-medium ring-1 ring-slate-200"
          >
            <LogOut aria-hidden className="size-4 rtl:-scale-x-100" />
            {t.adminSignOut}
          </button>
        </header>

        <KpiRow
          counts={counts.data}
          lostSales={lostSales.data}
          failed={counts.failed || lostSales.failed}
          onRetry={() => {
            counts.retry();
            lostSales.retry();
          }}
          onOpenAlerts={() => openTab("alerts")}
        />

        <div role="tablist" aria-label={t.adminTitle} className="flex flex-wrap gap-1">
          <TabButton isSelected={tab === "dashboard"} onSelect={() => openTab("dashboard")}>
            {t.adminTabDashboard}
          </TabButton>
          <TabButton isSelected={tab === "alerts"} onSelect={() => openTab("alerts")}>
            {t.adminTabAlerts}
            {alertCount > 0 && (
              <span className="grid h-6 min-w-6 place-items-center rounded-full bg-danger px-1.5 text-sm font-semibold text-white">
                {alertCount}
              </span>
            )}
          </TabButton>
          <TabButton isSelected={tab === "catalog"} onSelect={() => openTab("catalog")}>
            {t.adminTabCatalog}
          </TabButton>
          <TabButton isSelected={tab === "signs"} onSelect={() => openTab("signs")}>
            {t.adminTabSigns}
          </TabButton>
          <TabButton isSelected={tab === "floor"} onSelect={() => openTab("floor")}>
            {t.adminTabFloorEditor}
          </TabButton>
        </div>

        {/* Stays mounted while hidden, so going to the alerts and back keeps the zoom. */}
        <div role="tabpanel" hidden={tab !== "dashboard"} aria-label={t.adminTabDashboard}>
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div ref={mapSection} className="scroll-mt-4">
              {mapFailed && <Notice message={t.loadFailed} onRetry={retryMap} />}
              {failed && <Notice message={t.loadFailed} onRetry={reload} />}
              {map && zones ? (
                <StoreMapPanel
                  api={api}
                  map={map}
                  floor={floor}
                  shelves={shelves}
                  catalog={catalog}
                  categories={categories}
                  zones={zones}
                  selectedNodeId={selectedNodeId}
                  placing={placing}
                  refreshKey={closedAlerts}
                  onSelectZone={setSelectedNodeId}
                  onCancelPlacing={() => openTab("alerts")}
                  onPlaced={(row, shelf) => void finishPlacing(row, shelf)}
                />
              ) : (
                !mapFailed &&
                !failed && (
                  <div className="aspect-[34/29.6] w-full animate-pulse rounded-2xl bg-slate-200/70" />
                )
              )}
            </div>
            <div className="flex flex-col gap-5">
              <LostSalesPanel report={lostSales.data} failed={lostSales.failed} onRetry={lostSales.retry} />
              <PickingCard report={picking.data} />
              <LostDemandWidget
                report={lostDemand.data}
                failed={lostDemand.failed}
                onRetry={lostDemand.retry}
              />
            </div>
          </div>
        </div>

        <div role="tabpanel" hidden={tab !== "alerts"} aria-label={t.adminTabAlerts}>
          <ShelfStockAlerts
            rows={alerts.rows}
            failed={alerts.failed}
            resolvingKey={alerts.resolvingKey}
            outcome={outcome}
            onRetry={alerts.retry}
            onRestocked={(row) => void markRestocked(row)}
            onOnShelf={(row) => void markOnShelf(row)}
            onUpdateLocation={startPlacing}
          />
        </div>

        <div role="tabpanel" hidden={tab !== "catalog"} aria-label={t.adminTabCatalog}>
          {hasOpenedCatalog && <CatalogPanel catalog={catalog} categories={categories} shelves={shelves} />}
        </div>

        {/* Only while open: its signs go to the printer, and the dashboard prints nothing else. */}
        {tab === "signs" && (
          <div role="tabpanel" aria-label={t.adminTabSigns}>
            <SignsPanel shelves={shelves} />
          </div>
        )}

        {/* Mounted while hidden too, so a drawing and its undo steps survive a look at the alerts. */}
        <div role="tabpanel" hidden={tab !== "floor"} aria-label={t.adminTabFloorEditor}>
          {hasOpenedFloor && (
            <FloorEditorPanel
              api={api}
              categories={categories}
              saved={savedFloor}
              failed={floorFailed}
              onRetry={() => setFloorAttempt((current) => current + 1)}
              onSaved={(next) => {
                setSavedFloor(next);
                // Which shelf each product reaches depends on the plan.
                catalog.reload();
              }}
            />
          )}
        </div>

        {selectedNodeId !== null && zones && (
          <ZoneManagementModal
            key={selectedNodeId}
            api={api}
            nodeId={selectedNodeId}
            zones={zones}
            categories={categories}
            placing={placing}
            onChanged={() => {
              reload();
              catalog.reload();
            }}
            onPlaced={(row) => void finishPlacing(row)}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  );
}

function FloorEditorPanel({
  api,
  categories,
  saved,
  failed,
  onRetry,
  onSaved,
}: {
  api: AdminApi;
  categories: readonly CatalogCategory[];
  /** Undefined while loading; null when nothing is saved yet. */
  saved: SavedFloorPlan | null | undefined;
  failed: boolean;
  onRetry: () => void;
  onSaved: (saved: SavedFloorPlan) => void;
}) {
  const { t, pick } = useLanguage();
  // Departments, each followed by its subcategories: a shelf can be as fine as "פירות".
  const suggestions = useMemo(() => {
    const seen = new Map<string, string | undefined>();
    for (const category of categories) {
      const department = pick(category.name, category.name_en);
      seen.set(department, seen.get(department));
      for (const sub of category.subcategories ?? []) {
        if (!seen.has(sub)) seen.set(sub, department);
      }
    }
    return [...seen].map(([value, within]) => ({ value, within }));
  }, [categories, pick]);
  // Only read when the editor first appears; it keeps its own state after that.
  const start = useMemo(() => {
    const grid = saved ? fromPayload(saved.floor_plan) : null;
    return grid && saved
      ? { grid, check: saved.check, cellSize: readCellSize(saved.floor_plan) }
      : { grid: createGrid(), check: null, cellSize: DEFAULT_CELL_SIZE_M };
  }, [saved]);

  if (failed && saved === undefined) {
    return <Notice message={t.floorLoadFailed} onRetry={onRetry} />;
  }
  if (saved === undefined) {
    return <div className="h-[36rem] w-full animate-pulse rounded-2xl bg-slate-200/70" />;
  }
  return (
    <FloorGridEditor
      initialGrid={start.grid}
      initialCheck={start.check}
      initialCellSize={start.cellSize}
      suggestions={suggestions}
      onSave={async (_, json) => {
        try {
          const next = await api.saveFloorPlan(json);
          onSaved(next);
          return next.check;
        } catch {
          return null;
        }
      }}
    />
  );
}

function TabButton({
  isSelected,
  onSelect,
  children,
}: {
  isSelected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isSelected}
      onClick={onSelect}
      className={`flex min-h-11 items-center gap-2 rounded-full px-4 font-medium ring-1 ${
        isSelected ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

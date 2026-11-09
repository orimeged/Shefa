import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AdminApi } from "../api/adminClient";
import { createAdminApi } from "../api/adminClient";
import type { CatalogCategory, NotFoundReportRow, SavedFloorPlan, Zone } from "../api/types";
import { AdminLogin } from "../components/admin/AdminLogin";
import { FloorGridEditor } from "../components/admin/FloorGridEditor";
import { KpiRow } from "../components/admin/KpiRow";
import { LostDemandWidget } from "../components/admin/LostDemandWidget";
import type { AlertOutcome } from "../components/admin/ShelfStockAlerts";
import { ShelfStockAlerts } from "../components/admin/ShelfStockAlerts";
import { StoreMapPanel } from "../components/admin/StoreMapPanel";
import { ZoneManagementModal } from "../components/admin/ZoneManagementModal";
import { LanguageToggle } from "../components/LanguageToggle";
import { Notice } from "../components/Notice";
import { usePolledReport } from "../hooks/usePolledReport";
import { useStockAlerts } from "../hooks/useStockAlerts";
import { useStoreMap } from "../hooks/useStoreMap";
import { useLanguage } from "../i18n/LanguageProvider";
import { createGrid, DEFAULT_CELL_SIZE_M, fromPayload, readCellSize } from "../lib/admin/floorGrid";
import { countAlerts } from "../lib/admin/stockAlerts";
import { readFloorMap } from "../lib/floorPlanMap";

// For this tab only: a shared tablet shouldn't stay signed in overnight.
const TOKEN_KEY = "admin-token";

type Tab = "dashboard" | "alerts" | "floor";

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
  /** The alert whose item is getting a new shelf, while a manager picks one on the map. */
  const [placing, setPlacing] = useState<NotFoundReportRow | null>(null);
  const [outcome, setOutcome] = useState<AlertOutcome | null>(null);
  /** Goes up when an alert closes, since the figures and the heat depend on them. */
  const [closedAlerts, setClosedAlerts] = useState(0);
  const mapSection = useRef<HTMLDivElement>(null);

  const alerts = useStockAlerts(api);
  const alertCount = alerts.rows ? countAlerts(alerts.rows) : 0;
  const counts = usePolledReport(api.dashboardCounts, closedAlerts);
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
      .then(setSavedFloor)
      .catch(() => {
        if (!controller.signal.aborted) {
          setFloorFailed(true);
        }
      });
    return () => controller.abort();
  }, [api, floorAttempt]);
  const floor = useMemo(() => (savedFloor ? readFloorMap(savedFloor) : null), [savedFloor]);

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
    }
  };

  const closeAlert = async (row: NotFoundReportRow) => {
    const closed = await alerts.resolve(row);
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

  const startPlacing = (row: NotFoundReportRow) => {
    setOutcome(null);
    setPlacing(row);
    setTab("dashboard");
    // The table can be long, and the shelf to pick is on the map.
    requestAnimationFrame(() => mapSection.current?.scrollIntoView({ block: "start" }));
  };

  // The location is already saved here, so a failed close only leaves a false alert open.
  const finishPlacing = async (row: NotFoundReportRow) => {
    const zone = zones?.find((candidate) => candidate.id === selectedNodeId);
    setPlacing(null);
    setSelectedNodeId(null);
    setTab("alerts");
    setOutcome(
      (await closeAlert(row))
        ? { ok: true, text: t.alertMoved(row.item_query, zone?.zone_name ?? "") }
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
          failed={counts.failed}
          onRetry={counts.retry}
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
                  zones={zones}
                  selectedNodeId={selectedNodeId}
                  placing={placing}
                  refreshKey={closedAlerts}
                  onSelectZone={setSelectedNodeId}
                  onCancelPlacing={() => openTab("alerts")}
                />
              ) : (
                !mapFailed &&
                !failed && (
                  <div className="aspect-[34/29.6] w-full animate-pulse rounded-2xl bg-slate-200/70" />
                )
              )}
            </div>
            <LostDemandWidget
              report={lostDemand.data}
              failed={lostDemand.failed}
              onRetry={lostDemand.retry}
            />
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
            onUpdateLocation={startPlacing}
          />
        </div>

        {/* Mounted while hidden too, so a drawing and its undo steps survive a look at the alerts. */}
        <div role="tabpanel" hidden={tab !== "floor"} aria-label={t.adminTabFloorEditor}>
          {hasOpenedFloor && (
            <FloorEditorPanel
              api={api}
              categories={categories}
              saved={savedFloor}
              failed={floorFailed}
              onRetry={() => setFloorAttempt((current) => current + 1)}
              onSaved={setSavedFloor}
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
            onChanged={reload}
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
  const suggestions = useMemo(
    () => [...new Set(categories.map((category) => pick(category.name, category.name_en)))],
    [categories, pick],
  );
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

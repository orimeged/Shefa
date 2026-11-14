import { ArrowRight, Bell, LayoutDashboard, LogOut, Map as MapIcon, Package, QrCode } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { AdminApi } from "../api/adminClient";
import { createAdminApi } from "../api/adminClient";
import type { CatalogCategory, NotFoundReportRow, Resolution, SavedFloorPlan, Zone } from "../api/types";
import { AdminLogin } from "../components/admin/AdminLogin";
import { AlertsPanel } from "../components/admin/AlertsPanel";
import { SECONDARY_BUTTON } from "../components/admin/cards";
import { FloorGridEditor } from "../components/admin/FloorGridEditor";
import { MapPanel } from "../components/admin/MapPanel";
import { OverviewPanel } from "../components/admin/OverviewPanel";
import { ProductsPanel } from "../components/admin/ProductsPanel";
import { SignsPanel } from "../components/admin/SignsPanel";
import { ZoneManagementModal } from "../components/admin/ZoneManagementModal";
import { LanguageToggle } from "../components/LanguageToggle";
import { Toast } from "../components/mobile/Toast";
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

type Tab = "overview" | "alerts" | "products" | "map" | "signs";

export default function AdminView() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY));
  useAdminTitle();

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

/** The browser tab says which screen this is, not the shoppers' app's name. */
function useAdminTitle() {
  const { t } = useLanguage();
  useEffect(() => {
    const before = document.title;
    document.title = `${t.direction === "rtl" ? "שפע" : "Shefa"} · ${t.adminTitle}`;
    return () => {
      document.title = before;
    };
  }, [t]);
}

function Dashboard({ api, onSignOut }: { api: AdminApi; onSignOut: () => void }) {
  const { t } = useLanguage();
  const { map, failed: mapFailed, retry: retryMap } = useStoreMap();
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  /** The map tab shows the shelves, or the editor the plan is drawn in. */
  const [isEditing, setIsEditing] = useState(false);
  // The editor loads its plan on first opening, and then keeps its drawing and undo steps.
  const [hasOpenedEditor, setHasOpenedEditor] = useState(false);
  // Hundreds of rows: drawn once the tab is first opened, then kept with their filters.
  const [hasOpenedProducts, setHasOpenedProducts] = useState(false);
  /** The alert whose item is getting a new shelf, while a manager picks one on the map. */
  const [placing, setPlacing] = useState<NotFoundReportRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Goes up when an alert closes, since the figures and the heat depend on them. */
  const [closedAlerts, setClosedAlerts] = useState(0);

  const alerts = useStockAlerts(api);
  const catalog = useCatalog(api);
  const urgentAlerts = alerts.rows ? countAlerts(alerts.rows) : 0;
  const counts = usePolledReport(api.dashboardCounts, closedAlerts);
  const lostSales = usePolledReport(api.lostSales, closedAlerts);
  const picking = usePolledReport(api.picking);
  const lostDemand = usePolledReport(api.lostDemand);
  const heat = usePolledReport(api.notFoundHeatmap, closedAlerts);
  const dismissToast = useCallback(() => setToast(null), []);

  const reload = useCallback(() => setAttempt((current) => current + 1), []);

  // Loaded once for the overview, the products, the map and the editor; a save updates all of them.
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
    if (next !== tab && (next === "overview" || next === "products" || next === "map")) {
      refresh();
    }
    setTab(next);
    setPlacing(null);
    if (next === "products") setHasOpenedProducts(true);
    window.scrollTo({ top: 0 });
  };

  const openEditor = () => {
    setHasOpenedEditor(true);
    setIsEditing(true);
    window.scrollTo({ top: 0 });
  };

  const closeAlert = async (row: NotFoundReportRow, resolution: Resolution) => {
    const closed = await alerts.resolve(row, resolution);
    if (closed) {
      setClosedAlerts((current) => current + 1);
    }
    return closed;
  };

  const markRestocked = async (row: NotFoundReportRow) => {
    setToast((await closeAlert(row, "restocked")) ? t.staffClosed(row.item_query) : t.alertResolveFailed);
  };

  const markOnShelf = async (row: NotFoundReportRow) => {
    setToast((await closeAlert(row, "on_shelf")) ? t.alertOnShelfDone(row.item_query) : t.alertResolveFailed);
  };

  const startPlacing = (row: NotFoundReportRow) => {
    setToast(null);
    setTab("map");
    setIsEditing(false);
    setPlacing(row);
    window.scrollTo({ top: 0 });
  };

  // The location is already saved here, so a failed close only leaves a false alert open.
  const finishPlacing = async (row: NotFoundReportRow, shelf?: string) => {
    const zone = shelf ?? zones?.find((candidate) => candidate.id === selectedNodeId)?.zone_name ?? "";
    setPlacing(null);
    setSelectedNodeId(null);
    setTab("alerts");
    setToast(
      (await closeAlert(row, "relocated")) ? t.alertMoved(row.item_query, zone) : t.alertMovedStillOpen(row.item_query),
    );
  };

  const navItems: { id: Tab; label: string; icon: ReactNode; badge?: number }[] = [
    { id: "overview", label: t.adminNav.overview, icon: <LayoutDashboard aria-hidden className="size-6 md:size-5" /> },
    {
      id: "alerts",
      label: t.adminNav.alerts,
      icon: <Bell aria-hidden className="size-6 md:size-5" />,
      badge: urgentAlerts,
    },
    { id: "products", label: t.adminNav.products, icon: <Package aria-hidden className="size-6 md:size-5" /> },
    { id: "map", label: t.adminNav.map, icon: <MapIcon aria-hidden className="size-6 md:size-5" /> },
    { id: "signs", label: t.adminNav.signs, icon: <QrCode aria-hidden className="size-6 md:size-5" /> },
  ];

  return (
    <div className="min-h-dvh bg-paper pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-ink md:pb-10">
      <header className="sticky top-0 z-20 bg-slate-900 text-white print:hidden">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg leading-tight font-semibold">{t.adminTitle}</h1>
            {map?.name && <p className="truncate text-sm text-white/60">{map.name}</p>}
          </div>
          <nav
            role="tablist"
            aria-label={t.adminTitle}
            className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 gap-1 border-t border-line bg-surface px-2 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] md:static md:z-auto md:flex md:gap-1 md:rounded-full md:border-0 md:bg-white/10 md:p-1"
          >
            {navItems.map((item) => (
              <NavButton
                key={item.id}
                isSelected={tab === item.id}
                onSelect={() => openTab(item.id)}
                label={item.label}
                badge={item.badge}
              >
                {item.icon}
              </NavButton>
            ))}
          </nav>
          <LanguageToggle compact className="h-10 min-w-10 bg-white/10 px-3 text-white ring-1 ring-white/20" />
          <button
            type="button"
            onClick={onSignOut}
            aria-label={t.adminSignOut}
            title={t.adminSignOut}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 ring-1 ring-white/20 hover:bg-white/20"
          >
            <LogOut aria-hidden className="size-4 rtl:-scale-x-100" />
          </button>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 pt-5 sm:px-6">
        {(mapFailed || failed) && (
          <Notice
            message={t.loadFailed}
            onRetry={() => {
              retryMap();
              reload();
            }}
          />
        )}

        {/* Its figures live up here, so it can come and go with its tab; so can the map's, and the two never share a page. */}
        {tab === "overview" && (
          <div role="tabpanel" aria-label={t.adminNav.overview}>
            <OverviewPanel
              counts={counts}
              lostSales={lostSales}
              picking={picking}
              lostDemand={lostDemand}
              heat={heat}
              floor={floor}
              map={map}
              zones={zones}
              selectedNodeId={selectedNodeId}
              onSelectZone={setSelectedNodeId}
              openAlerts={alerts.rows ? alerts.rows.length : null}
              urgentAlerts={urgentAlerts}
              onOpenAlerts={() => openTab("alerts")}
              onOpenMap={() => openTab("map")}
            />
          </div>
        )}

        <div role="tabpanel" hidden={tab !== "alerts"} aria-label={t.adminNav.alerts}>
          <AlertsPanel
            rows={alerts.rows}
            failed={alerts.failed}
            resolvingKey={alerts.resolvingKey}
            onRetry={alerts.retry}
            onRestocked={(row) => void markRestocked(row)}
            onOnShelf={(row) => void markOnShelf(row)}
            onElsewhere={startPlacing}
          />
        </div>

        <div role="tabpanel" hidden={tab !== "products"} aria-label={t.adminNav.products}>
          {hasOpenedProducts && (
            <ProductsPanel catalog={catalog} categories={categories} shelves={shelves} floor={floor} />
          )}
        </div>

        <div role="tabpanel" hidden={tab !== "map"} aria-label={t.adminNav.map}>
          <div hidden={isEditing}>
            {tab !== "map" ? null : map && zones ? (
              <MapPanel
                map={map}
                floor={floor}
                shelves={shelves}
                catalog={catalog}
                categories={categories}
                zones={zones}
                selectedNodeId={selectedNodeId}
                placing={placing}
                onSelectZone={setSelectedNodeId}
                onCancelPlacing={() => openTab("alerts")}
                onPlaced={(row, shelf) => void finishPlacing(row, shelf)}
                onEdit={openEditor}
              />
            ) : (
              !mapFailed && !failed && <div className="aspect-[3/2] w-full animate-pulse rounded-3xl bg-line/60" />
            )}
          </div>
          {/* Mounted while hidden too, so a drawing and its undo steps survive a look at the shelves. */}
          {hasOpenedEditor && (
            <div hidden={!isEditing} role="region" aria-label={t.floorEditorTitle} className="flex flex-col gap-4">
              <button type="button" onClick={() => setIsEditing(false)} className={`${SECONDARY_BUTTON} self-start`}>
                <ArrowRight aria-hidden className="size-5 ltr:-scale-x-100" />
                {t.mapBack}
              </button>
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
            </div>
          )}
        </div>

        {/* Only while open: its signs go to the printer, and the dashboard prints nothing else. */}
        {tab === "signs" && (
          <div role="tabpanel" aria-label={t.adminNav.signs}>
            <SignsPanel shelves={shelves} />
          </div>
        )}

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
      </main>

      {toast && <Toast message={toast} onDismiss={dismissToast} aboveAction />}
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
    return <div className="h-[36rem] w-full animate-pulse rounded-3xl bg-line/60" />;
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

/** A section of the dashboard: a pill in the header on a tablet, a tab in the bottom bar on a phone, as in the staff app. */
function NavButton({
  isSelected,
  onSelect,
  label,
  badge,
  children,
}: {
  isSelected: boolean;
  onSelect: () => void;
  label: string;
  badge?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isSelected}
      onClick={onSelect}
      className={`relative flex h-16 flex-col items-center justify-center gap-0.5 rounded-2xl text-sm font-medium md:h-10 md:flex-row md:gap-2 md:rounded-full md:px-4 md:text-base ${
        isSelected
          ? "text-brand-strong md:bg-white md:text-ink md:shadow-sm"
          : "text-muted md:text-white/75 md:hover:bg-white/10 md:hover:text-white"
      }`}
    >
      {children}
      {label}
      {badge ? (
        <span className="absolute start-[calc(50%+0.5rem)] top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-xs font-semibold text-white md:static md:h-6 md:min-w-6 md:text-sm">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AdminApi } from "../api/adminClient";
import { createAdminApi } from "../api/adminClient";
import type { CatalogCategory, NotFoundReportRow, Zone } from "../api/types";
import { AdminLogin } from "../components/admin/AdminLogin";
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
import { countAlerts } from "../lib/admin/stockAlerts";

// For this tab only: a shared tablet shouldn't stay signed in overnight.
const TOKEN_KEY = "admin-token";

type Tab = "dashboard" | "alerts";

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

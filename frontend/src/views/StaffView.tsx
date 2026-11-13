import { Bell, ClipboardList, LogOut, ScanLine } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getFloorPlan } from "../api/client";
import type { StaffApi } from "../api/staffClient";
import { checkStaffToken, createStaffApi } from "../api/staffClient";
import type { CatalogCategory, CatalogProduct, NotFoundReportRow } from "../api/types";
import { AdminLogin } from "../components/admin/AdminLogin";
import { LanguageToggle } from "../components/LanguageToggle";
import { Toast } from "../components/mobile/Toast";
import { Notice } from "../components/Notice";
import { PickPanel } from "../components/staff/PickPanel";
import { PlacePanel } from "../components/staff/PlacePanel";
import { PushSwitch } from "../components/staff/PushSwitch";
import { StaffAlertCard } from "../components/staff/StaffAlertCard";
import { usePushAlerts } from "../hooks/usePushAlerts";
import { useStockAlerts } from "../hooks/useStockAlerts";
import { useLanguage } from "../i18n/LanguageProvider";
import type { ShelfOption } from "../lib/admin/catalog";
import { planShelves } from "../lib/admin/catalog";
import type { FloorMap } from "../lib/floorPlanMap";
import { readFloorMap } from "../lib/floorPlanMap";
import { reportRowKey } from "../lib/admin/stockAlerts";

// The shift manager's own phone: it stays signed in, unlike the shared dashboard tablet.
const TOKEN_KEY = "staff-token";
// Faster than the dashboard: this is the screen that sends someone to the shelf.
const REFRESH_MS = 15_000;
const BUZZ = [180, 80, 180];

type Tab = "alerts" | "place" | "pick";

/** The installed app opens on /staff, with its own name and icon, not the shoppers' app. */
function useStaffInstallIdentity() {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const appTitle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const before = { manifest: link?.getAttribute("href"), appTitle: appTitle?.content, theme: theme?.content, title: document.title };
    link?.setAttribute("href", "/staff.webmanifest");
    if (appTitle) appTitle.content = "שפע צוות";
    if (theme) theme.content = "#0f172a";
    document.title = "שפע · צוות הסניף";
    return () => {
      if (before.manifest) link?.setAttribute("href", before.manifest);
      if (appTitle && before.appTitle !== undefined) appTitle.content = before.appTitle;
      if (theme && before.theme !== undefined) theme.content = before.theme;
      document.title = before.title;
    };
  }, []);
}

export default function StaffView() {
  const { t } = useLanguage();
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  useStaffInstallIdentity();

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
  }, []);
  const api = useMemo(() => (token ? createStaffApi(token, signOut) : null), [token, signOut]);

  if (!api) {
    return (
      <AdminLogin
        title={t.staffTitle}
        check={checkStaffToken}
        onSignedIn={(entered) => {
          localStorage.setItem(TOKEN_KEY, entered);
          setToken(entered);
        }}
      />
    );
  }
  return <StaffApp api={api} onSignOut={signOut} />;
}

/** The plan, its shelves and the store's departments, for placing and picking. Read once, on first need. */
function usePlacingData(api: StaffApi, wanted: boolean) {
  const [shelves, setShelves] = useState<ShelfOption[] | null | undefined>(undefined);
  const [floor, setFloor] = useState<FloorMap | null>(null);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    setFailed(false);
    Promise.all([getFloorPlan(controller.signal), api.categories(controller.signal)])
      .then(([plan, nextCategories]) => {
        setShelves(plan?.check.routable ? planShelves(plan.check) : null);
        setFloor(readFloorMap(plan));
        setCategories(nextCategories);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [api, wanted, attempt]);
  return { shelves, floor, categories, failed, retry: () => setAttempt((current) => current + 1) };
}

function StaffApp({ api, onSignOut }: { api: StaffApi; onSignOut: () => void }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>("alerts");
  const [hasOpenedPlace, setHasOpenedPlace] = useState(false);
  /** The alert "somewhere else" was tapped on, while its product is scanned where it stands. */
  const [relocating, setRelocating] = useState<NotFoundReportRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const onNew = useCallback(
    (rows: NotFoundReportRow[]) => {
      navigator.vibrate?.(BUZZ);
      setToast(t.staffNewAlert(rows[0]?.item_query ?? ""));
    },
    [t],
  );
  const alerts = useStockAlerts(api, { refreshMs: REFRESH_MS, onNew });
  const push = usePushAlerts(api);
  const placing = usePlacingData(api, hasOpenedPlace);
  const dismissToast = useCallback(() => setToast(null), []);

  // A tapped notification brings the app forward: show the newest alerts straight away.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "alert-opened") {
        setTab("alerts");
        alerts.retry();
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, [alerts.retry]);

  const openTab = (next: Tab) => {
    setTab(next);
    if (next === "place" || next === "pick") setHasOpenedPlace(true);
    if (next === "alerts") setRelocating(null);
    window.scrollTo({ top: 0 });
  };

  const close = async (row: NotFoundReportRow, onShelf: boolean) => {
    const closed = await alerts.resolve(row, onShelf ? "on_shelf" : "restocked");
    setToast(closed ? (onShelf ? t.staffMisplacedClosed(row.item_query) : t.staffClosed(row.item_query)) : t.alertResolveFailed);
  };

  const startRelocating = (row: NotFoundReportRow) => {
    setRelocating(row);
    openTab("place");
  };

  const placed = async (_product: CatalogProduct, answered: NotFoundReportRow | null): Promise<boolean> => {
    if (!answered) return false;
    setRelocating(null);
    return alerts.resolve(answered, "relocated");
  };

  const rows = alerts.rows;
  return (
    <div className="min-h-dvh bg-paper pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-ink">
      <header className="sticky top-0 z-20 flex items-center gap-2 bg-slate-900 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 text-white">
        <h1 className="flex-1 text-lg font-semibold">{t.staffTitle}</h1>
        <LanguageToggle compact className="h-10 bg-white/10 text-white ring-white/20" />
        <button
          type="button"
          onClick={onSignOut}
          aria-label={t.adminSignOut}
          className="grid size-10 place-items-center rounded-full bg-white/10 ring-1 ring-white/20"
        >
          <LogOut aria-hidden className="size-4 rtl:-scale-x-100" />
        </button>
      </header>

      {tab === "alerts" && (
        <>
          <PushSwitch
            state={push.state}
            isBusy={push.isBusy}
            onEnable={() => void push.enable()}
            onDisable={() => void push.disable()}
            onTest={push.test}
          />
          <main className="flex flex-col gap-3 px-4 pt-4">
            <h2 className="text-xl font-semibold" aria-live="polite">
              {rows ? (rows.length ? t.staffOpenAlerts(rows.length) : t.staffEmpty) : t.staffTitle}
            </h2>
            {alerts.failed && <Notice message={t.loadFailed} onRetry={alerts.retry} />}
            {rows === null && !alerts.failed && <div className="h-56 animate-pulse rounded-3xl bg-line/60" />}
            {rows?.length === 0 && (
              <p className="rounded-3xl bg-surface px-4 py-6 text-center text-muted ring-1 ring-line">{t.staffEmptyHint}</p>
            )}
            {rows && rows.length > 0 && (
              <ul className="flex flex-col gap-3">
                {rows.map((row) => (
                  <StaffAlertCard
                    key={reportRowKey(row)}
                    row={row}
                    isResolving={alerts.resolvingKey === reportRowKey(row)}
                    onRestocked={(target) => void close(target, false)}
                    onOnShelf={(target) => void close(target, true)}
                    onElsewhere={startRelocating}
                  />
                ))}
              </ul>
            )}
          </main>
        </>
      )}

      {hasOpenedPlace && (
        <main hidden={tab !== "place"} className="px-4 pt-4">
          {placing.failed && <Notice message={t.loadFailed} onRetry={placing.retry} />}
          {placing.shelves === undefined && !placing.failed && <div className="h-56 animate-pulse rounded-3xl bg-line/60" />}
          {placing.shelves !== undefined && (
            <PlacePanel
              api={api}
              shelves={placing.shelves}
              categories={placing.categories}
              relocating={relocating}
              onCancelRelocating={() => setRelocating(null)}
              onPlaced={placed}
            />
          )}
        </main>
      )}

      {hasOpenedPlace && (
        <main hidden={tab !== "pick"} className="px-4 pt-4">
          {placing.failed && <Notice message={t.loadFailed} onRetry={placing.retry} />}
          {placing.shelves === undefined && !placing.failed && <div className="h-56 animate-pulse rounded-3xl bg-line/60" />}
          {placing.shelves !== undefined && <PickPanel api={api} floor={placing.floor} />}
        </main>
      )}

      <nav
        aria-label={t.staffTitle}
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 gap-1 border-t border-line bg-surface px-2 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))]"
      >
        <NavButton isSelected={tab === "alerts"} onSelect={() => openTab("alerts")} label={t.staffNav.alerts} badge={rows?.length}>
          <Bell aria-hidden className="size-6" />
        </NavButton>
        <NavButton isSelected={tab === "place"} onSelect={() => openTab("place")} label={t.staffNav.place}>
          <ScanLine aria-hidden className="size-6" />
        </NavButton>
        <NavButton isSelected={tab === "pick"} onSelect={() => openTab("pick")} label={t.staffNav.pick}>
          <ClipboardList aria-hidden className="size-6" />
        </NavButton>
      </nav>

      {toast && <Toast message={toast} onDismiss={dismissToast} aboveAction />}
    </div>
  );
}

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
      aria-current={isSelected ? "page" : undefined}
      onClick={onSelect}
      className={`relative flex h-16 flex-col items-center justify-center gap-0.5 rounded-2xl text-sm font-medium ${
        isSelected ? "text-brand-strong" : "text-muted"
      }`}
    >
      {children}
      {label}
      {badge ? (
        <span className="absolute top-1.5 start-[calc(50%+0.5rem)] grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-xs font-semibold text-white">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

import { Hand, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import type { StoreMap } from "../api/types";
import { ProductDepartmentsProvider } from "../components/CategoryIcon";
import { KioskHeader } from "../components/kiosk/KioskHeader";
import { KioskMap } from "../components/kiosk/KioskMap";
import { KioskPanel } from "../components/kiosk/KioskPanel";
import { KioskQrCard } from "../components/kiosk/KioskQrCard";
import { publicOrigin } from "../components/kiosk/publicOrigin";
import type { CartItem } from "../components/kiosk/types";
import { useStopBadges } from "../components/kiosk/useStopBadges";
import { Notice } from "../components/Notice";
import { useCategorySearch } from "../hooks/useCategorySearch";
import { useIdleReset } from "../hooks/useIdleReset";
import { useIdleWarning } from "../hooks/useIdleWarning";
import { PlacementsProvider, usePlacements } from "../hooks/usePlace";
import { useQuickRoute } from "../hooks/useQuickRoute";
import type { PlanRoute } from "../hooks/useShopperStore";
import { useShopperStore } from "../hooks/useShopperStore";
import { useWakeLock } from "../hooks/useWakeLock";
import { useLanguage } from "../i18n/LanguageProvider";
import { newUuid } from "../lib/events/notFoundQueue";
import type { FloorMap } from "../lib/floorPlanMap";
import { addQuickItem } from "../lib/kiosk/quickList";
import type { MapLayout } from "../lib/mapGeometry";
import { isReachableFromPhone } from "../lib/shareUrl";

const IDLE_TIMEOUT_MS = 30_000;
/** When the screen says it's about to start over: the last stretch before the reset. */
const IDLE_WARNING_MS = 20_000;
/** How long the notice stays, faded, after the touch that answers it: long enough for that tap's click. */
const WARNING_LINGER_MS = 600;

/**
 * The tablet at the entrance. Nobody can reload it, and whoever walks up next
 * shouldn't see the last shopper's items, so going idle does both jobs: it starts
 * a new visit and fetches the map again, picking up any change a manager made.
 */
export default function KioskView() {
  const { t, resetLanguage } = useLanguage();
  const { map, floor, layout, planRoute, failed, retry } = useShopperStore();
  const [visit, setVisit] = useState(0);
  const screenCanStayOn = useWakeLock();

  useIdleReset(IDLE_TIMEOUT_MS, () => {
    setVisit((current) => current + 1);
    resetLanguage();
    retry();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper select-none">
      {failed && !map && <Notice message={t.searchFailed} onRetry={retry} className="m-3" />}
      <PlacementsProvider placements={floor?.placements ?? null}>
        <ProductDepartmentsProvider productStops={map?.product_stops} departments={map?.categories}>
          <KioskVisit
            key={visit}
            map={map}
            floor={floor}
            layout={layout}
            planRoute={planRoute}
            screenCanStayOn={screenCanStayOn}
          />
        </ProductDepartmentsProvider>
      </PlacementsProvider>
    </div>
  );
}

interface KioskVisitProps {
  map: StoreMap | null;
  floor: FloorMap | null;
  layout: MapLayout | null;
  planRoute: PlanRoute;
  screenCanStayOn: boolean;
}

/** Everything one shopper touches. A new key clears all of it at once. */
function KioskVisit({ map, floor, layout, planRoute, screenCanStayOn }: KioskVisitProps) {
  const { t } = useLanguage();
  const placements = usePlacements();
  const [items, setItems] = useState<readonly CartItem[]>([]);
  const [term, setTerm] = useState("");
  const [sessionId] = useState(newUuid);
  const { hits, failed: searchFailed, isSearching } = useCategorySearch(term, sessionId);
  const quick = useQuickRoute(
    items.map((item) => item.categoryId),
    sessionId,
    planRoute,
  );
  // The hook keeps its last walk while the next loads; with nothing picked there's none.
  const route = items.length > 0 ? quick.route : null;
  const { codeOf, badges } = useStopBadges(map, floor !== null, route, items);
  const isBusy = items.length > 0 || term !== "";
  const isWarning = useIdleWarning(IDLE_WARNING_MS, isBusy);
  // While typing, the shelf the first result is on lights up on the map.
  const firstHit = term.trim() ? hits[0] : undefined;
  const highlight = firstHit ? (placements?.[firstHit.category_id] ?? null) : null;
  const caption = highlight ? t.kioskMapShowing(highlight) : route ? t.kioskRouteEnds : t.kioskMapIdle;
  const warnings = [
    ...(isReachableFromPhone(publicOrigin()) ? [] : [t.qrUnreachable]),
    ...(screenCanStayOn ? [] : [t.screenMaySleep]),
  ];

  return (
    <>
      <KioskHeader
        storeName={map?.name ?? null}
        caption={caption}
        canReset={isBusy}
        onReset={() => {
          setItems([]);
          setTerm("");
        }}
      />
      {warnings.length > 0 && (
        // For whoever sets the tablet up. A live store never shows these.
        <div dir={t.direction} className="flex flex-wrap gap-2 px-[2.2vh] pb-[1.4vh]">
          {warnings.map((message) => (
            <p
              key={message}
              role="alert"
              className="flex items-center gap-2 rounded-xl bg-next-soft px-3 py-1.5 font-medium text-ink ring-1 ring-next"
            >
              <TriangleAlert aria-hidden className="size-5 shrink-0" />
              {message}
            </p>
          ))}
        </div>
      )}
      <main
        dir={t.direction}
        className="grid min-h-0 flex-1 gap-[2.2vh] px-[2.2vh] pb-[2.2vh] landscape:grid-cols-[minmax(25rem,5fr)_minmax(0,7fr)] portrait:grid-rows-[auto_minmax(0,1fr)]"
      >
        <KioskPanel
          map={map}
          items={items}
          route={route}
          routeFailed={quick.failed}
          codeOf={codeOf}
          term={term}
          onTermChange={setTerm}
          hits={hits}
          searchFailed={searchFailed}
          isSearching={isSearching}
          onAdd={(item) => setItems((current) => addQuickItem(current, item))}
          onRemove={(categoryId) => setItems((current) => current.filter((item) => item.categoryId !== categoryId))}
        />
        {/* The map takes what the code leaves: a wide frame, as stores are wider than deep. */}
        <div className="flex min-h-0 flex-col gap-[2.2vh]">
          <KioskMap layout={layout} route={route} highlight={highlight} badges={badges} caption={caption} />
          <KioskQrCard categoryIds={items.map((item) => item.categoryId)} />
        </div>
      </main>
      <IdleWarning isOn={isWarning} seconds={(IDLE_TIMEOUT_MS - IDLE_WARNING_MS) / 1000} />
    </>
  );
}

/**
 * Says the screen is about to clear, with a bar that runs out as its time does.
 * After the touch that answers it, it fades but stays a moment: a tap's click
 * lands only once the finger lifts, and with the notice gone it would land on
 * whatever is underneath, such as a department tile.
 */
function IdleWarning({ isOn, seconds }: { isOn: boolean; seconds: number }) {
  const { t } = useLanguage();
  const [isMounted, setIsMounted] = useState(isOn);
  useEffect(() => {
    if (isOn) {
      setIsMounted(true);
      return;
    }
    const timer = setTimeout(() => setIsMounted(false), WARNING_LINGER_MS);
    return () => clearTimeout(timer);
  }, [isOn]);

  if (!isMounted) {
    return null;
  }
  return (
    <div dir={t.direction} className="pointer-events-none fixed inset-x-0 bottom-[3vh] z-30 flex justify-center px-4">
      <div
        role={isOn ? "status" : undefined}
        aria-hidden={!isOn}
        className={`card-in pointer-events-auto w-[min(42rem,92vw)] overflow-hidden rounded-3xl bg-ink/90 text-white shadow-2xl transition-opacity duration-200 ${
          isOn ? "opacity-100" : "opacity-0"
        }`}
      >
        <p className="flex items-center gap-3 px-6 py-4 text-[clamp(1.1rem,2.3vh,1.5rem)] font-medium">
          <Hand aria-hidden className="size-7 shrink-0 text-next" />
          {t.kioskIdleWarning}
        </p>
        <div className="h-1.5 bg-white/15">
          <div className="idle-bar h-full bg-next" style={{ animationDuration: `${seconds}s` }} />
        </div>
      </div>
    </div>
  );
}

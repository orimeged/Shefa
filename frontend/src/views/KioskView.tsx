import { useState } from "react";

import type { StoreMap } from "../api/types";
import { KioskQrPanel } from "../components/kiosk/KioskQrPanel";
import { QuickSearchPanel } from "../components/kiosk/QuickSearchPanel";
import type { CartItem } from "../components/kiosk/types";
import { Notice } from "../components/Notice";
import { useIdleReset } from "../hooks/useIdleReset";
import { ProductDepartmentsProvider } from "../components/CategoryIcon";
import { PlacementsProvider } from "../hooks/usePlace";
import type { PlanRoute } from "../hooks/useShopperStore";
import { useShopperStore } from "../hooks/useShopperStore";
import { useWakeLock } from "../hooks/useWakeLock";
import { useLanguage } from "../i18n/LanguageProvider";
import { newUuid } from "../lib/events/notFoundQueue";
import type { FloorMap } from "../lib/floorPlanMap";
import { addQuickItem } from "../lib/kiosk/quickList";
import type { MapLayout } from "../lib/mapGeometry";

const IDLE_TIMEOUT_MS = 30_000;

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
    <div className="flex h-dvh flex-col select-none">
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
  const [items, setItems] = useState<readonly CartItem[]>([]);
  const [sessionId] = useState(newUuid);

  return (
    // The code stays on the left in both languages. Each panel sets its own direction.
    <main dir="ltr" className="grid min-h-0 flex-1 portrait:grid-rows-2 landscape:grid-cols-2">
      <KioskQrPanel
        storeName={map?.name ?? null}
        categoryIds={items.map((item) => item.categoryId)}
        screenCanStayOn={screenCanStayOn}
      />
      <QuickSearchPanel
        map={map}
        layout={layout}
        isFloorPlan={floor !== null}
        planRoute={planRoute}
        items={items}
        sessionId={sessionId}
        onAdd={(item) => setItems((current) => addQuickItem(current, item))}
        onRemove={(categoryId) =>
          setItems((current) => current.filter((item) => item.categoryId !== categoryId))
        }
        onClear={() => setItems([])}
      />
    </main>
  );
}

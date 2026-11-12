import { X } from "lucide-react";
import { useCallback, useMemo } from "react";

import type { StoreMap } from "../../api/types";
import { usePlace } from "../../hooks/usePlace";
import { useQuickRoute } from "../../hooks/useQuickRoute";
import type { PlanRoute } from "../../hooks/useShopperStore";
import { useLanguage } from "../../i18n/LanguageProvider";
import { inRouteOrder } from "../../lib/kiosk/quickList";
import type { MapLayout } from "../../lib/mapGeometry";
import type { FoundSet } from "../../lib/routeProgress";
import { categoryZoneCode, zoneCodes } from "../../lib/zoneCode";
import { StoreMapView } from "../mobile/StoreMapView";
import { Notice } from "../Notice";
import { ZoneBadge } from "../ZoneBadge";
import type { CartItem } from "./types";

interface QuickRouteProps {
  map: StoreMap | null;
  layout: MapLayout | null;
  /** A drawn plan has no aisles to code, so its badges count the walk instead. */
  isFloorPlan: boolean;
  planRoute: PlanRoute;
  items: readonly CartItem[];
  sessionId: string;
  onRemove: (categoryId: string) => void;
}

const NOTHING_FOUND: FoundSet = new Set();

/**
 * Where the picked items are, for someone who won't scan the code. The items
 * sit in one row so the map can take every bit of height that's left.
 */
export function QuickRoute({
  map,
  layout,
  isFloorPlan,
  planRoute,
  items,
  sessionId,
  onRemove,
}: QuickRouteProps) {
  const { t, pick } = useLanguage();
  const where = usePlace();
  const { route, failed } = useQuickRoute(
    items.map((item) => item.categoryId),
    sessionId,
    planRoute,
  );

  const codes = useMemo(() => (map && !isFloorPlan ? zoneCodes(map) : null), [map, isFloorPlan]);
  // 1, 2, 3 in walking order: the card and its pin share the number.
  const walkOrder = useMemo(
    () => new Map(route?.stops.map((stop, index) => [stop.category_id, String(index + 1)])),
    [route],
  );
  const codeOf = useCallback(
    (categoryId: string) => {
      if (isFloorPlan) {
        return walkOrder.get(categoryId) ?? null;
      }
      return map && codes ? categoryZoneCode(map, codes, categoryId) : null;
    },
    [isFloorPlan, walkOrder, map, codes],
  );
  const badges = useMemo(
    () =>
      new Map(
        items.flatMap((item) => {
          const code = codeOf(item.categoryId);
          return code ? [[item.categoryId, { code, tone: item.tone }] as const] : [];
        }),
      ),
    [items, codeOf],
  );

  const placeOnRoute = (categoryId: string) =>
    route?.stops.find((stop) => stop.category_id === categoryId)?.department;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ol className="grid shrink-0 auto-cols-fr grid-flow-col gap-2">
        {inRouteOrder(items, route).map((item) => {
          const name = pick(item.name, item.nameEn);
          const code = codeOf(item.categoryId);
          return (
            <li
              key={item.categoryId}
              className="card-in relative flex min-w-0 items-center gap-2.5 rounded-2xl bg-surface py-2.5 ps-2.5 pe-9 shadow-sm ring-1 ring-line"
            >
              {code && <ZoneBadge code={code} tone={item.tone} className="size-12 text-lg" />}
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-lg leading-tight font-semibold">{name}</span>
                <span className="block truncate text-sm font-medium text-muted">
                  {/* On a drawn plan, the shelf the route chose: a department may have several. */}
                  {placeOnRoute(item.categoryId) ? t.onShelf(placeOnRoute(item.categoryId)!) : where(item.categoryId, item.aisleNo, item.side, true)}
                </span>
              </span>
              {/* A full tap target that overlaps the corner, so the name keeps the width. */}
              <button
                type="button"
                onClick={() => onRemove(item.categoryId)}
                aria-label={t.removeItem(name)}
                className="absolute end-0 top-0 grid size-11 place-items-center rounded-xl text-muted hover:bg-danger-soft hover:text-danger"
              >
                <X aria-hidden className="size-4.5" />
              </button>
            </li>
          );
        })}
      </ol>

      {failed && <Notice message={t.rerouteFailed} />}
      <div className="min-h-0 flex-1">
        {layout && route ? (
          <StoreMapView
            layout={layout}
            route={route}
            found={NOTHING_FOUND}
            zoneBadges={badges}
            // A screen at the door: the whole store and the whole walk, markers sized for a tablet.
            focus="overview"
            emphasis="all"
            markerScale={1.25}
            interactive={false}
            className="block h-full w-full"
          />
        ) : (
          !failed && <div className="h-full animate-pulse rounded-2xl bg-line/60" />
        )}
      </div>
    </div>
  );
}

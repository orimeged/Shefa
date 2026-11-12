import { useCallback, useMemo } from "react";

import type { Route, StoreMap } from "../../api/types";
import { categoryZoneCode, zoneCodes } from "../../lib/zoneCode";
import type { CartItem } from "./types";

/**
 * The disc each picked item wears, on its card and on its map pin alike. On the
 * graph's aisles it's the shelf's code, such as "2B"; a drawn plan has no aisles
 * to code, so there it's the item's place in the walk: 1, 2, 3.
 */
export function useStopBadges(
  map: StoreMap | null,
  isFloorPlan: boolean,
  route: Route | null,
  items: readonly CartItem[],
) {
  const codes = useMemo(() => (map && !isFloorPlan ? zoneCodes(map) : null), [map, isFloorPlan]);
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
  return { codeOf, badges };
}

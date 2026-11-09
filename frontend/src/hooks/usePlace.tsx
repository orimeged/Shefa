import type { ReactNode } from "react";
import { createContext, use, useCallback } from "react";

import type { Side } from "../api/types";
import { useLanguage } from "../i18n/LanguageProvider";

/** Category id to drawn department, on a store routed by its floor plan; null on the graph. */
const PlacementsContext = createContext<Readonly<Record<string, string>> | null>(null);

export function PlacementsProvider({
  placements,
  children,
}: {
  placements: Readonly<Record<string, string>> | null;
  children: ReactNode;
}) {
  return <PlacementsContext value={placements}>{children}</PlacementsContext>;
}

/**
 * Says where a category stands. On the graph that is its aisle and side; on a
 * drawn plan there are no aisles, so it is the shelf the manager named, or that
 * it isn't on the map at all.
 */
export function usePlace() {
  const { t } = useLanguage();
  const placements = use(PlacementsContext);
  return useCallback(
    (categoryId: string, aisleNo: number, side: Side, isShort = false): string => {
      if (placements === null) {
        return isShort ? t.aisleShort(aisleNo, side) : t.aisle(aisleNo, side);
      }
      const department = placements[categoryId];
      return department ? t.onShelf(department) : t.notOnMap;
    },
    [placements, t],
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";

import { resolveList } from "../api/client";
import type { Category, ResolvedItem, SearchHit, StoreMap } from "../api/types";
import { newUuid } from "../lib/events/notFoundQueue";
import { parseShoppingText } from "../lib/list/parseList";
import type { ListPhase } from "../lib/list/sessionStore";
import { loadSession, phaseOf, saveSession } from "../lib/list/sessionStore";
import type { ItemPlacement, ListItem } from "../lib/list/shoppingItems";
import {
  appendItems,
  applyResolved,
  categoryIdsOf,
  groupByCategory,
  itemsFromCategories,
  matchedItem,
  pendingItem,
  placementOfCategory,
  placementOfHit,
  withoutPlacement,
} from "../lib/list/shoppingItems";
import type { FoundSet } from "../lib/routeProgress";

/** What to tell the shopper after an addition. */
export interface AddNotice {
  count: number;
  unmatched: number;
  /** Set for a single item: where it is, or null when the store doesn't have it. */
  single: { text: string; placement: ItemPlacement | null } | null;
}

function noticeOf(resolved: readonly ResolvedItem[]): AddNotice {
  const [first] = resolved;
  return {
    count: resolved.length,
    unmatched: resolved.filter((row) => !row.hit).length,
    single:
      resolved.length === 1 && first
        ? { text: first.text, placement: first.hit ? placementOfHit(first.hit) : null }
        : null,
  };
}

/**
 * The shopper's list and what they've found, kept through reloads.
 *
 * Text appears on the list the moment it's added and is matched in one request
 * afterwards, so a weak signal delays the match but never the typing.
 */
export function useShoppingList(map: StoreMap | null, seedIds: readonly string[]) {
  const seedKey = seedIds.join(",");
  const [restored] = useState(() => {
    const session = loadSession();
    return seedKey && session?.seedKey !== seedKey ? null : session;
  });

  const [items, setItems] = useState<ListItem[]>(restored?.items ?? []);
  const [found, setFound] = useState<FoundSet>(() => new Set(restored?.found));
  const [seededKey, setSeededKey] = useState(restored?.seedKey ?? "");
  const [resolveFailed, setResolveFailed] = useState(false);
  const [notice, setNotice] = useState<AddNotice | null>(null);
  const [positionNodeId, rememberPosition] = useState(restored?.positionNodeId ?? null);
  const [sessionId, setSessionId] = useState(() => restored?.sessionId ?? newUuid());
  const [phase, setPhase] = useState<ListPhase>(() => phaseOf(restored));
  // Where a reloaded trip resumes from. A new trip mustn't inherit it.
  const [restoredNodeId, setRestoredNodeId] = useState(restored?.positionNodeId ?? null);

  /** Everything that belongs to one trip, so nothing carries over to the next. */
  const startNewTrip = useCallback((nextItems: ListItem[], nextSeedKey: string) => {
    setItems(nextItems);
    setFound(new Set());
    rememberPosition(null);
    setRestoredNodeId(null);
    setPhase("building");
    setSeededKey(nextSeedKey);
    setSessionId(newUuid());
  }, []);

  /**
   * The shopper is standing here, by an aisle-end sign: the next route starts from it.
   * A trip already under way re-plans from it too (see useShoppingRoute's anchor).
   */
  const placeShopperAt = useCallback((nodeId: string) => {
    rememberPosition(nodeId);
    setRestoredNodeId(nodeId);
  }, []);

  useEffect(() => {
    if (map && seedKey && seedKey !== seededKey) {
      startNewTrip(itemsFromCategories(seedIds, map), seedKey);
    }
  }, [map, seedKey, seededKey, seedIds, startNewTrip]);

  useEffect(() => {
    saveSession({ items, found: [...found], positionNodeId, seedKey: seededKey, sessionId, phase });
  }, [items, found, positionNodeId, seededKey, sessionId, phase]);

  // Removing the last item one by one ends the trip as surely as clearing the list.
  useEffect(() => {
    if (items.length === 0 && phase === "shopping") {
      startNewTrip([], seedKey);
    }
  }, [items.length, phase, seedKey, startNewTrip]);

  const resolveBatch = useCallback(
    (batch: readonly ListItem[]) => {
      setResolveFailed(false);
      resolveList(
        batch.map((item) => item.query),
        sessionId,
      )
        .then((resolved) => {
          setItems((current) => applyResolved(current, batch, resolved));
          setNotice(noticeOf(resolved));
        })
        .catch(() => setResolveFailed(true));
    },
    [sessionId],
  );

  const addText = useCallback(
    (raw: string) => {
      const batch = parseShoppingText(raw).map(pendingItem);
      if (batch.length > 0) {
        setItems((current) => appendItems(current, batch));
        resolveBatch(batch);
      }
    },
    [resolveBatch],
  );

  const addHit = useCallback((hit: SearchHit) => {
    const placement = placementOfHit(hit);
    setItems((current) => appendItems(current, [matchedItem(hit.matched_text, placement)]));
    setNotice({ count: 1, unmatched: 0, single: { text: hit.matched_text, placement } });
  }, []);

  const removeCategory = useCallback((categoryId: string) => {
    setItems((current) => current.filter((item) => item.placement?.categoryId !== categoryId));
    setFound((current) => {
      const next = new Set(current);
      next.delete(categoryId);
      return next;
    });
  }, []);

  /** Chips work as a switch: a second tap takes the department off the list. */
  const toggleCategory = useCallback(
    (category: Category) => {
      const placement = map && placementOfCategory(category, map);
      if (!placement) {
        return;
      }
      setItems((current) =>
        current.some((item) => item.placement?.categoryId === category.id)
          ? current.filter((item) => item.placement?.categoryId !== category.id)
          : [...current, matchedItem(placement.name, placement)],
      );
    },
    [map],
  );

  const assignCategory = useCallback(
    (itemId: string, category: Category) => {
      const placement = map && placementOfCategory(category, map);
      if (placement) {
        setItems((current) =>
          current.map((item) =>
            item.id === itemId ? { ...item, status: "matched", placement } : item,
          ),
        );
      }
    },
    [map],
  );

  const removeItem = useCallback((itemId: string) => {
    setItems((current) => current.filter((item) => item.id !== itemId));
  }, []);

  const setMissing = useCallback((itemIds: readonly string[], missing: boolean) => {
    const ids = new Set(itemIds);
    setItems((current) =>
      current.map((item) => (ids.has(item.id) ? { ...item, missing } : item)),
    );
  }, []);

  const markUnplaced = useCallback((categoryIds: readonly string[]) => {
    setItems((current) => withoutPlacement(current, categoryIds));
  }, []);

  const clear = useCallback(() => startNewTrip([], seedKey), [seedKey, startNewTrip]);

  // The last "added" notice belongs to building the list: left up, it would cover the first station.
  const startShopping = useCallback(() => {
    setNotice(null);
    setPhase("shopping");
  }, []);

  const pendingItems = useMemo(() => items.filter((item) => item.status === "pending"), [items]);
  const unmatchedItems = useMemo(
    () => items.filter((item) => item.status === "unmatched"),
    [items],
  );
  const categoryIds = useMemo(() => categoryIdsOf(items), [items]);
  const groups = useMemo(() => groupByCategory(items), [items]);

  const retryResolve = useCallback(() => resolveBatch(pendingItems), [resolveBatch, pendingItems]);

  // A reload can catch items still waiting for their match.
  const [startupPending] = useState(() => items.filter((item) => item.status === "pending"));
  useEffect(() => {
    if (startupPending.length > 0) {
      resolveBatch(startupPending);
    }
  }, [resolveBatch, startupPending]);

  return {
    items,
    sessionId,
    phase,
    startShopping,
    isEmpty: items.length === 0,
    pendingItems,
    unmatchedItems,
    categoryIds,
    groups,
    found,
    setFound,
    restoredNodeId,
    rememberPosition,
    placeShopperAt,
    resolveFailed,
    retryResolve,
    notice,
    dismissNotice: useCallback(() => setNotice(null), []),
    addText,
    addHit,
    toggleCategory,
    assignCategory,
    removeCategory,
    removeItem,
    setMissing,
    markUnplaced,
    clear,
  };
}

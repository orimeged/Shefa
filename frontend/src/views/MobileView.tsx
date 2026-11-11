import { CircleAlert, Navigation, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import type { RouteStop, SearchHit } from "../api/types";
import { ProductDepartmentsProvider } from "../components/CategoryIcon";
import { AddedToast } from "../components/mobile/AddedToast";
import { DictationOverlay } from "../components/mobile/DictationOverlay";
import { FoundBurst } from "../components/mobile/FoundBurst";
import { ListDraft } from "../components/mobile/ListDraft";
import { ListEntry } from "../components/mobile/ListEntry";
import { MobileSearchBar } from "../components/mobile/MobileSearchBar";
import { NotFoundSheet } from "../components/mobile/NotFoundSheet";
import { QuickCategoryChips } from "../components/mobile/QuickCategoryChips";
import { ShoppingList } from "../components/mobile/ShoppingList";
import { StationSheet } from "../components/mobile/StationSheet";
import { StoreMapView } from "../components/mobile/StoreMapView";
import { Toast } from "../components/mobile/Toast";
import { TripHeader } from "../components/mobile/TripHeader";
import { UnmatchedItems } from "../components/mobile/UnmatchedItems";
import { Notice } from "../components/Notice";
import { useDictation } from "../hooks/useDictation";
import { useElementBox } from "../hooks/useElementBox";
import { useNotFoundReports } from "../hooks/useNotFoundReports";
import { useShoppingList } from "../hooks/useShoppingList";
import { useShoppingRoute } from "../hooks/useShoppingRoute";
import { PlacementsProvider } from "../hooks/usePlace";
import { useShopperStore } from "../hooks/useShopperStore";
import { useLanguage } from "../i18n/LanguageProvider";
import { buzz, FOUND_BUZZ, LIST_DONE_BUZZ } from "../lib/haptics";
import type { ListItem } from "../lib/list/shoppingItems";
import { completesList, currentPoint, distanceToNextStop, remainingDistance } from "../lib/routeProgress";
import { parseCategoryIds } from "../lib/shareUrl";

const NO_STOPS: readonly string[] = [];
const FINALE_MS = 1600;
/** Clear of the screen's edges when the camera frames a walk, in pixels. */
const SIDE_INSET_PX = 18;

export default function MobileView() {
  const { t, language } = useLanguage();
  const [params] = useSearchParams();
  const seedIds = useMemo(() => parseCategoryIds(params.get("categories")), [params]);

  const { map, floor, layout, planRoute, failed: mapFailed, retry: retryMap } = useShopperStore();
  const list = useShoppingList(map, seedIds);
  const { addText, categoryIds, found, groups, markUnplaced, rememberPosition, setMissing } = list;
  const isBuilding = list.phase === "building";
  const isShopping = !isBuilding && categoryIds.length > 0;

  const stickyTop = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isOverview, setIsOverview] = useState(false);
  const [isListOpen, setIsListOpen] = useState(false);

  // While the list is being built there's nothing to route, whatever is added to it.
  const { route, pending, knownStops, isUpdating, failed, toggleFound, retry } = useShoppingRoute({
    categoryIds: isBuilding ? NO_STOPS : categoryIds,
    found,
    setFound: list.setFound,
    restoredNodeId: list.restoredNodeId,
    sessionId: list.sessionId,
    planRoute,
  });

  const dictation = useDictation({ language, onTranscript: addText });
  const reportNotFound = useNotFoundReports(list.sessionId);
  const [choosingAt, setChoosingAt] = useState<RouteStop | null>(null);
  const [tripMessage, setTripMessage] = useState<string | null>(null);
  const dismissTripMessage = useCallback(() => setTripMessage(null), []);
  const [finale, setFinale] = useState(0);

  useEffect(() => {
    if (finale > 0) {
      const timer = setTimeout(() => setFinale(0), FINALE_MS);
      return () => clearTimeout(timer);
    }
  }, [finale]);

  useEffect(() => {
    if (route) {
      rememberPosition(currentPoint(route, found).node_id);
    }
  }, [route, found, rememberPosition]);

  useEffect(() => {
    if (route && route.unplaced_category_ids.length > 0) {
      markUnplaced(route.unplaced_category_ids);
    }
  }, [route, markUnplaced]);

  // On the trip a pinch zooms the map, never the page: Safari pinches the page
  // with gestures of its own, which the stage's touch-action doesn't reach.
  useEffect(() => {
    if (!isShopping) {
      return;
    }
    const keep = (event: Event) => event.preventDefault();
    document.addEventListener("gesturestart", keep, { passive: false });
    document.addEventListener("gesturechange", keep, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", keep);
      document.removeEventListener("gesturechange", keep);
    };
  }, [isShopping]);

  // A new trip starts on its route, with the search and the list put away.
  useEffect(() => {
    if (!isShopping) {
      setIsSearching(false);
      setIsOverview(false);
      setIsListOpen(false);
    }
  }, [isShopping]);

  // Building the list: focus and scrolling into view must stop clear of the sticky
  // search above and the answer bar below, or a focused row sits hidden under one.
  useEffect(() => {
    const root = document.documentElement;
    const top = stickyTop.current;
    if (!top) {
      return;
    }
    const observer = new ResizeObserver(() => {
      root.style.scrollPaddingTop = `${top.offsetHeight}px`;
    });
    observer.observe(top);
    return () => {
      observer.disconnect();
      root.style.scrollPaddingTop = "";
    };
  }, [isShopping]);

  const clearList = () => {
    if (window.confirm(t.clearConfirm)) {
      list.clear();
    }
  };

  const markNotFound = (stop: RouteStop, items: readonly ListItem[]) => {
    // The shelf they were sent to is where they are.
    for (const item of items) {
      reportNotFound({ itemQuery: item.query, categoryId: stop.category_id, x: stop.x, y: stop.y });
    }
    setMissing(
      items.map((item) => item.id),
      true,
    );
    // Nothing left to look for at this stop, so the route moves on.
    if (items.length === groups.get(stop.category_id)?.items.length) {
      toggleFound(stop.category_id);
    }
    setChoosingAt(null);
    setTripMessage(t.notFoundThanks(items.map((item) => item.text).join(", ")));
  };

  const handleFound = (categoryId: string) => {
    if (completesList(categoryIds, found, categoryId)) {
      setTripMessage(missingCount > 0 ? t.routeFinished(missingCount) : t.listComplete);
      setFinale((count) => count + 1);
      buzz(LIST_DONE_BUZZ);
    } else if (!found.has(categoryId)) {
      buzz(FOUND_BUZZ);
    }
    toggleFound(categoryId);
  };

  const handleNotFound = (stop: RouteStop) => {
    const items = groups.get(stop.category_id)?.items ?? [];
    if (items.length > 1) {
      setChoosingAt(stop);
    } else {
      markNotFound(stop, items);
    }
  };

  const departments = map && (
    <section>
      <h2 className="mb-3 px-1 text-sm font-medium text-muted">{t.departments}</h2>
      <QuickCategoryChips map={map} selectedIds={categoryIds} onSelect={list.toggleCategory} />
    </section>
  );

  const listedQueries = useMemo(() => new Set(list.items.map((item) => item.query)), [list.items]);
  const isListed = useCallback(
    (hit: SearchHit) => listedQueries.has(hit.matched_text),
    [listedQueries],
  );

  const hasRoute = route !== null && categoryIds.length > 0;
  const nextStop = hasRoute ? pending[0] : undefined;
  // Whole metres: a drawn plan's diagonals come back as 14.73, which nobody paces out.
  const plannedM = hasRoute ? distanceToNextStop(route, found) : null;
  const distanceM = plannedM === null ? null : Math.round(plannedM);
  const placedCount = list.items.filter((item) => item.placement).length;
  const canStart = isBuilding && placedCount > 0;
  useEffect(() => {
    const root = document.documentElement;
    root.style.scrollPaddingBottom = canStart ? "calc(7rem + env(safe-area-inset-bottom))" : "";
    return () => {
      root.style.scrollPaddingBottom = "";
    };
  }, [canStart]);
  const total = categoryIds.length;
  const foundCount = categoryIds.filter((id) => found.has(id)).length;
  const missingCount = list.items.filter((item) => item.missing).length;
  const isDictating =
    dictation.status === "starting" ||
    dictation.status === "listening" ||
    dictation.status === "finishing";

  // The stations behind the shopper, ticked or given up, wherever later routes go.
  const reached = useMemo(
    () => categoryIds.flatMap((id) => (found.has(id) ? (knownStops.get(id) ?? []) : [])),
    [categoryIds, found, knownStops],
  );
  const missingIds = useMemo(
    () =>
      new Set(
        categoryIds.filter((id) => {
          // A group keeps what's still looked for apart from what was given up.
          const group = groups.get(id);
          return group !== undefined && group.items.length === 0 && group.missing.length > 0;
        }),
      ),
    [categoryIds, groups],
  );

  // What floats over the map, which the camera frames around. The pulled-up list
  // covers the map on purpose, so the frame stays where the closed sheet left it.
  const headerBox = useElementBox(header, isShopping);
  const sheetBox = useElementBox(sheet, isShopping && hasRoute);
  const [sheetInset, setSheetInset] = useState(0);
  useEffect(() => {
    if (!isListOpen && sheetBox.height > 0) {
      setSheetInset(window.innerHeight - sheetBox.top);
    }
  }, [isListOpen, sheetBox]);
  const insets = useMemo(
    () => ({ top: headerBox.bottom + 10, right: SIDE_INSET_PX, bottom: sheetInset + 10, left: SIDE_INSET_PX }),
    [headerBox.bottom, sheetInset],
  );
  const aboveSheetPx = hasRoute && sheetBox.height > 0 ? window.innerHeight - sheetBox.top : undefined;

  const overlays = (
    <>
      {finale > 0 && (
        <div
          className="pointer-events-none fixed inset-x-0 z-40 mx-auto h-0 max-w-xl"
          style={{ bottom: `calc(${aboveSheetPx ?? 80}px + env(safe-area-inset-bottom))` }}
        >
          <FoundBurst key={finale} finale />
        </div>
      )}

      {tripMessage ? (
        <Toast
          message={tripMessage}
          onDismiss={dismissTripMessage}
          aboveAction={nextStop !== undefined}
          offsetPx={isShopping ? aboveSheetPx : undefined}
        />
      ) : (
        list.notice && (
          <AddedToast
            notice={list.notice}
            onDismiss={list.dismissNotice}
            aboveAction={canStart || nextStop !== undefined}
            offsetPx={isShopping ? aboveSheetPx : undefined}
          />
        )
      )}

      {choosingAt && (
        <NotFoundSheet
          items={groups.get(choosingAt.category_id)?.items ?? []}
          onPick={(items) => markNotFound(choosingAt, items)}
          onClose={() => setChoosingAt(null)}
        />
      )}

      {isDictating && (
        <DictationOverlay
          status={dictation.status}
          transcript={dictation.transcript}
          isSpeaking={dictation.isSpeaking}
          failedSegments={dictation.failedSegments}
          onFinish={dictation.finish}
          onCancel={dictation.cancel}
        />
      )}
    </>
  );

  const searchBar = (
    <MobileSearchBar
      sessionId={list.sessionId}
      isBuilding={isBuilding}
      isListed={isListed}
      micUnavailable={dictation.status === "unavailable"}
      onAddHit={list.addHit}
      onAddText={addText}
      onDictate={dictation.start}
      onDismissMicHint={dictation.dismissUnavailable}
      quickAddPanel={isBuilding ? null : departments}
    />
  );

  if (isShopping) {
    return (
      <PlacementsProvider placements={floor?.placements ?? null}>
      <ProductDepartmentsProvider productStops={map?.product_stops}>
        {/* Scrolling inside the sheet still works; pinching the page doesn't. */}
        <div className="trip-stage fixed inset-0 overflow-hidden bg-paper">
          <h1 className="sr-only">{t.routeTitle}</h1>

          {layout && hasRoute ? (
            <StoreMapView
              layout={layout}
              route={route}
              found={found}
              reached={reached}
              missing={missingIds}
              focus={isOverview ? "overview" : "route"}
              insets={insets}
              firstNumber={foundCount + 1}
              className="absolute inset-0 block h-full w-full"
            />
          ) : (
            !failed &&
            !mapFailed && <div aria-hidden className="map-loading absolute inset-0" />
          )}

          <TripHeader
            ref={header}
            foundCount={foundCount}
            total={total}
            remainingM={hasRoute ? Math.round(remainingDistance(route, found)) : null}
            isUpdating={isUpdating && route !== null}
            isOverview={isOverview}
            onToggleOverview={() => setIsOverview((overview) => !overview)}
            onSearch={() => setIsSearching(true)}
          />

          {(failed || mapFailed) && (
            <div className="absolute inset-x-0 top-28 z-20 mx-auto max-w-xl px-3">
              {failed && <Notice message={route ? t.rerouteFailed : t.loadFailed} onRetry={retry} />}
              {mapFailed && <Notice message={t.loadFailed} onRetry={retryMap} />}
            </div>
          )}

          {isSearching && (
            <div className="trip-search absolute inset-x-0 top-0 z-30 mx-auto max-w-xl rounded-b-3xl bg-paper/95 pt-[env(safe-area-inset-top)] pb-1 shadow-xl backdrop-blur-md">
              <div className="flex items-start">
                <div className="min-w-0 flex-1">{searchBar}</div>
                <button
                  type="button"
                  onClick={() => setIsSearching(false)}
                  aria-label={t.closeSearch}
                  className="me-2 mt-2.5 grid size-12 shrink-0 place-items-center rounded-full text-muted hover:bg-line/60"
                >
                  <X aria-hidden className="size-5" />
                </button>
              </div>
            </div>
          )}

          {hasRoute && (
            <div className="absolute inset-x-0 bottom-0 z-20 mx-auto max-w-xl px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              <StationSheet
                ref={sheet}
                stop={nextStop}
                number={Math.min(foundCount + 1, total)}
                total={total}
                itemTexts={nextStop ? (groups.get(nextStop.category_id)?.itemTexts ?? []) : []}
                distanceM={distanceM}
                then={pending[1]}
                missingCount={missingCount}
                waiting={list.unmatchedItems.map((item) => item.text)}
                onArrived={handleFound}
                onNotFound={handleNotFound}
                expanded={isListOpen}
                onToggleExpanded={() => setIsListOpen((open) => !open)}
              >
                <div className="flex flex-col gap-4">
                  <UnmatchedItems
                    map={map}
                    pendingCount={list.pendingItems.length}
                    unmatched={list.unmatchedItems}
                    resolveFailed={list.resolveFailed}
                    onRetry={list.retryResolve}
                    onAssign={list.assignCategory}
                    onRemove={list.removeItem}
                  />
                  <ShoppingList
                    pending={pending}
                    foundIds={[...found]}
                    groups={groups}
                    onToggle={handleFound}
                    onRemove={list.removeCategory}
                    onNotFound={handleNotFound}
                    onFoundAfterAll={(itemId) => setMissing([itemId], false)}
                  />
                  <button
                    type="button"
                    onClick={clearList}
                    className="mx-auto flex h-11 items-center gap-2 px-4 text-sm font-medium text-muted"
                  >
                    <Trash2 aria-hidden className="size-4" />
                    {t.clearList}
                  </button>
                </div>
              </StationSheet>
            </div>
          )}

          {overlays}
        </div>
      </ProductDepartmentsProvider>
      </PlacementsProvider>
    );
  }

  return (
    <PlacementsProvider placements={floor?.placements ?? null}>
      <ProductDepartmentsProvider productStops={map?.product_stops}>
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
        <div ref={stickyTop} className="sticky top-0 z-20 bg-paper pt-[env(safe-area-inset-top)]">
          {searchBar}
          {mapFailed && <Notice message={t.loadFailed} onRetry={retryMap} className="mx-4 mb-2" />}
        </div>

        <main
          className={`flex flex-1 flex-col gap-8 px-4 pt-2 ${
            canStart ? "pb-[calc(7rem+env(safe-area-inset-bottom))]" : "pb-[calc(5rem+env(safe-area-inset-bottom))]"
          }`}
        >
          {isBuilding && list.isEmpty ? (
            <header className="pt-4">
              <h1 className="text-3xl font-semibold tracking-tight">{t.smartTitle}</h1>
              <p className="mt-1 text-muted">{t.smartSubtitle}</p>
            </header>
          ) : (
            <h1 className="sr-only">{isBuilding ? t.smartTitle : t.routeTitle}</h1>
          )}

          {isBuilding && placedCount > 0 && <ListDraft items={list.items} onRemove={list.removeItem} onClear={clearList} />}

          <UnmatchedItems
            map={map}
            pendingCount={list.pendingItems.length}
            unmatched={list.unmatchedItems}
            resolveFailed={list.resolveFailed}
            onRetry={list.retryResolve}
            onAssign={list.assignCategory}
            onRemove={list.removeItem}
          />

          {isBuilding && <ListEntry onAddText={addText} />}
          {isBuilding && departments}

          {failed && !route && (
            <p className="flex items-center gap-2 text-muted">
              <CircleAlert aria-hidden className="size-5 shrink-0" />
              {t.loadFailed}
            </p>
          )}
        </main>

        {canStart && (
          <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-xl bg-gradient-to-t from-paper via-paper/90 to-transparent px-4 pt-6 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={list.startShopping}
              className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-brand text-xl font-semibold text-white shadow-xl"
            >
              <Navigation aria-hidden className="size-6" />
              {t.calculateRoute(placedCount)}
            </button>
          </div>
        )}

        {overlays}
      </div>
    </ProductDepartmentsProvider>
      </PlacementsProvider>
  );
}

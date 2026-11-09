import { CircleAlert, LoaderCircle, Navigation, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import type { RouteStop, SearchHit } from "../api/types";
import { AddedToast } from "../components/mobile/AddedToast";
import { DictationOverlay } from "../components/mobile/DictationOverlay";
import { FoundBurst } from "../components/mobile/FoundBurst";
import { ListDraft } from "../components/mobile/ListDraft";
import { ListEntry } from "../components/mobile/ListEntry";
import { LiveStoreMap } from "../components/mobile/LiveStoreMap";
import { StoreMapView } from "../components/mobile/StoreMapView";
import { MobileSearchBar } from "../components/mobile/MobileSearchBar";
import { NextTargetCard } from "../components/mobile/NextTargetCard";
import { NotFoundSheet } from "../components/mobile/NotFoundSheet";
import { QuickCategoryChips } from "../components/mobile/QuickCategoryChips";
import { ShoppingList } from "../components/mobile/ShoppingList";
import { StopActions } from "../components/mobile/StopActions";
import { Toast } from "../components/mobile/Toast";
import { UnmatchedItems } from "../components/mobile/UnmatchedItems";
import { Notice } from "../components/Notice";
import { useDictation } from "../hooks/useDictation";
import { useNotFoundReports } from "../hooks/useNotFoundReports";
import { useShoppingList } from "../hooks/useShoppingList";
import { useShoppingRoute } from "../hooks/useShoppingRoute";
import { PlacementsProvider } from "../hooks/usePlace";
import { useShopperStore } from "../hooks/useShopperStore";
import { useLanguage } from "../i18n/LanguageProvider";
import { buzz, FOUND_BUZZ, LIST_DONE_BUZZ } from "../lib/haptics";
import type { ListItem } from "../lib/list/shoppingItems";
import type { Point } from "../lib/mapGeometry";
import { graphWalkingMap, gridWalkingMap } from "../lib/positioning/gridWalking";
import { WalkGraph } from "../lib/positioning/walkGraph";
import { completesList, currentPoint, distanceToNextStop } from "../lib/routeProgress";
import { parseCategoryIds } from "../lib/shareUrl";

const NO_STOPS: readonly string[] = [];
const FINALE_MS = 1600;

export default function MobileView() {
  const { t, language } = useLanguage();
  const [params] = useSearchParams();
  const seedIds = useMemo(() => parseCategoryIds(params.get("categories")), [params]);

  const { map, floor, layout, planRoute, failed: mapFailed, retry: retryMap } = useShopperStore();
  const list = useShoppingList(map, seedIds);
  const { addText, categoryIds, found, groups, markUnplaced, rememberPosition, setMissing } = list;
  const isBuilding = list.phase === "building";

  const livePosition = useRef<Point | null>(null);
  const stickyTop = useRef<HTMLDivElement>(null);
  // Also kept as state: the target card counts down the metres as the dot moves.
  const [livePoint, setLivePoint] = useState<Point | null>(null);
  // What live location walks on: the drawn plan's tiles when there is one, the graph's aisles otherwise.
  const walking = useMemo(
    () => (floor ? gridWalkingMap(floor.grid, floor.frame) : map ? graphWalkingMap(map) : null),
    [floor, map],
  );
  const graph = useMemo(() => (walking ? new WalkGraph(walking.edges) : null), [walking]);
  const liveNodeId = useCallback(
    () => (graph && livePosition.current ? graph.nearestNodeId(livePosition.current) : null),
    [graph],
  );

  // While the list is being built there's nothing to route, whatever is added to it.
  const { route, pending, fix, isUpdating, failed, toggleFound, retry } = useShoppingRoute({
    categoryIds: isBuilding ? NO_STOPS : categoryIds,
    found,
    setFound: list.setFound,
    restoredNodeId: list.restoredNodeId,
    liveNodeId,
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

  // The live dot belongs to the trip that turned it on, not to the next one.
  useEffect(() => {
    if (isBuilding) {
      livePosition.current = null;
      setLivePoint(null);
    }
  }, [isBuilding]);

  // Focus and scrolling into view must stop clear of the sticky map above and the
  // answer bar below, or a focused row sits hidden under one of them.
  useEffect(() => {
    const root = document.documentElement;
    const header = stickyTop.current;
    if (!header) {
      return;
    }
    const observer = new ResizeObserver(() => {
      root.style.scrollPaddingTop = `${header.offsetHeight}px`;
    });
    observer.observe(header);
    return () => {
      observer.disconnect();
      root.style.scrollPaddingTop = "";
    };
  }, []);

  const clearList = () => {
    if (window.confirm(t.clearConfirm)) {
      list.clear();
    }
  };

  const markNotFound = (stop: RouteStop, items: readonly ListItem[]) => {
    // Without live location, the shelf they were sent to is where they are.
    const { x, y } = livePosition.current ?? stop;
    for (const item of items) {
      reportNotFound({ itemQuery: item.query, categoryId: stop.category_id, x, y });
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
  // Live, the distance is walked from the dot, which may have left the planned route.
  // Whole metres: a drawn plan's diagonals come back as 14.73, which nobody paces out.
  const plannedM = hasRoute ? distanceToNextStop(route, found) : null;
  const distanceM =
    livePoint && nextStop && graph
      ? Math.round(graph.pathLength(graph.nearest(livePoint), graph.nearest(nextStop)))
      : plannedM === null
        ? null
        : Math.round(plannedM);
  const placedCount = list.items.filter((item) => item.placement).length;
  const canStart = isBuilding && placedCount > 0;
  const hasBottomBar = canStart || nextStop !== undefined;
  useEffect(() => {
    const root = document.documentElement;
    root.style.scrollPaddingBottom = hasBottomBar ? "calc(7rem + env(safe-area-inset-bottom))" : "";
    return () => {
      root.style.scrollPaddingBottom = "";
    };
  }, [hasBottomBar]);
  const total = categoryIds.length;
  const foundCount = categoryIds.filter((id) => found.has(id)).length;
  const missingCount = list.items.filter((item) => item.missing).length;
  const isDictating =
    dictation.status === "starting" ||
    dictation.status === "listening" ||
    dictation.status === "finishing";

  return (
    <PlacementsProvider placements={floor?.placements ?? null}>
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <div ref={stickyTop} className="sticky top-0 z-20 bg-paper pt-[env(safe-area-inset-top)]">
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

        {hasRoute && (
          <>
            <div
              className="h-1 bg-line"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={foundCount}
            >
              <div
                className="h-full bg-brand transition-[width] duration-500"
                style={{ width: `${(foundCount / total) * 100}%` }}
              />
            </div>
          </>
        )}

        {!isBuilding && categoryIds.length > 0 && hasRoute && (
          <div className="relative z-10 -mb-1 px-3 pt-2">
            <NextTargetCard
              stop={nextStop}
              itemTexts={nextStop ? (groups.get(nextStop.category_id)?.itemTexts ?? []) : []}
              distanceM={distanceM}
              foundCount={foundCount}
              total={total}
              missingCount={missingCount}
            />
          </div>
        )}

        {!isBuilding && categoryIds.length > 0 && (
          <div className="relative">
            {layout && walking && graph && hasRoute ? (
              <LiveStoreMap
                layout={layout}
                walking={walking}
                graph={graph}
                route={route}
                found={found}
                followsRoute={floor !== null}
                fix={fix}
                livePosition={livePosition}
                onLiveMove={setLivePoint}
              />
            ) : layout && hasRoute ? (
              // A drawn plan with no entrance has nowhere to start live location from.
              <StoreMapView layout={layout} route={route} found={found} />
            ) : (
              !failed &&
              !mapFailed && (
                <div className="p-3">
                  <div className="aspect-[34/29.6] max-h-[46dvh] w-full animate-pulse rounded-3xl bg-line/60" />
                </div>
              )
            )}
            {isUpdating && route && (
              <p className="absolute start-3 top-3 flex items-center gap-2 rounded-full bg-ink/85 px-3 py-1.5 text-sm font-medium text-white">
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
                {t.updatingRoute}
              </p>
            )}
          </div>
        )}

        {/* In the sticky area so it stays on screen while the list is scrolled. */}
        {failed && (
          <Notice
            message={route ? t.rerouteFailed : t.loadFailed}
            onRetry={retry}
            className="mx-4 mb-2"
          />
        )}
        {mapFailed && <Notice message={t.loadFailed} onRetry={retryMap} className="mx-4 mb-2" />}
      </div>

      <main
        className={`flex flex-1 flex-col px-4 pt-2 ${isBuilding ? "gap-8" : "gap-4"} ${
          canStart || nextStop
            ? "pb-[calc(7rem+env(safe-area-inset-bottom))]"
            : "pb-[calc(5rem+env(safe-area-inset-bottom))]"
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

        {isBuilding && placedCount > 0 && (
          <ListDraft items={list.items} onRemove={list.removeItem} onClear={clearList} />
        )}

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

        {hasRoute && (
          <>
            <ShoppingList
              pending={pending}
              foundIds={[...found]}
              groups={groups}
              onToggle={handleFound}
              onRemove={list.removeCategory}
              onNotFound={handleNotFound}
              onFoundAfterAll={(itemId) => setMissing([itemId], false)}
            />
          </>
        )}

        {failed && !route && (
          <p className="flex items-center gap-2 text-muted">
            <CircleAlert aria-hidden className="size-5 shrink-0" />
            {t.loadFailed}
          </p>
        )}

        {!isBuilding && (
          <button
            type="button"
            onClick={clearList}
            className="mx-auto flex h-11 items-center gap-2 px-4 text-sm font-medium text-muted"
          >
            <Trash2 aria-hidden className="size-4" />
            {t.clearList}
          </button>
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

      {nextStop && (
        <StopActions stop={nextStop} onFound={handleFound} onNotFound={handleNotFound} />
      )}

      {finale > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 mx-auto h-0 max-w-xl">
          <FoundBurst key={finale} finale />
        </div>
      )}

      {tripMessage ? (
        <Toast
          message={tripMessage}
          onDismiss={dismissTripMessage}
          aboveAction={nextStop !== undefined}
        />
      ) : (
        list.notice && (
          <AddedToast
            notice={list.notice}
            onDismiss={list.dismissNotice}
            aboveAction={canStart || nextStop !== undefined}
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
    </div>
    </PlacementsProvider>
  );
}

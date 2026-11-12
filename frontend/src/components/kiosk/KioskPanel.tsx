import { ArrowDownLeft, Check, Plus, Search, X } from "lucide-react";
import { useMemo, useRef } from "react";

import type { Route, SearchHit, StoreMap } from "../../api/types";
import { usePlace } from "../../hooks/usePlace";
import { useLanguage } from "../../i18n/LanguageProvider";
import { inRouteOrder, MAX_QUICK_ITEMS } from "../../lib/kiosk/quickList";
import { CategoryIcon } from "../CategoryIcon";
import { Notice } from "../Notice";
import { ZoneBadge } from "../ZoneBadge";
import { CategoryGrid } from "./CategoryGrid";
import type { CartItem, NewCartItem } from "./types";

/** A walk this long, in metres, counts as one minute: an unhurried pace with a trolley. */
const METRES_PER_MINUTE = 60;

interface KioskPanelProps {
  map: StoreMap | null;
  items: readonly CartItem[];
  route: Route | null;
  routeFailed: boolean;
  codeOf: (categoryId: string) => string | null;
  term: string;
  onTermChange: (term: string) => void;
  hits: readonly SearchHit[];
  searchFailed: boolean;
  isSearching: boolean;
  onAdd: (item: NewCartItem) => void;
  onRemove: (categoryId: string) => void;
}

function toCartItem(hit: SearchHit): NewCartItem {
  return {
    categoryId: hit.category_id,
    name: hit.category_name,
    nameEn: hit.category_name_en,
    aisleNo: hit.aisle_no,
    side: hit.side,
  };
}

/** Metres said the way a person would: to the nearest 5 up close, the nearest 10 further on. */
function roundMetres(metres: number): number {
  const step = metres < 100 ? 5 : 10;
  return Math.max(step, Math.round(metres / step) * step);
}

/**
 * Everything a shopper does at the screen, in the order they do it: a welcome,
 * one big search field, then departments to tap, results to pick or the stops
 * picked. The search field never moves between those, so a finger that found it
 * once finds it again.
 */
export function KioskPanel({
  map,
  items,
  route,
  routeFailed,
  codeOf,
  term,
  onTermChange,
  hits,
  searchFailed,
  isSearching,
  onAdd,
  onRemove,
}: KioskPanelProps) {
  const { t, pick } = useLanguage();
  const where = usePlace();
  const inputRef = useRef<HTMLInputElement>(null);
  const cartIds = useMemo(() => new Set(items.map((item) => item.categoryId)), [items]);
  const isFull = items.length >= MAX_QUICK_ITEMS;
  const hasItems = items.length > 0;
  const typed = term.trim();

  const addHit = (hit: SearchHit) => {
    onAdd(toCartItem(hit));
    onTermChange("");
    // Closes the tablet's keyboard, which would otherwise cover the list.
    inputRef.current?.blur();
  };

  const summary =
    hasItems && route
      ? t.kioskRouteSummary(
          route.stops.length || items.length,
          roundMetres(route.total_length_m),
          Math.max(1, Math.round(route.total_length_m / METRES_PER_MINUTE)),
        )
      : null;

  return (
    <section aria-labelledby="kiosk-title" className="flex min-h-0 flex-col gap-[1.8vh]">
      <div className="shrink-0">
        <h1
          id="kiosk-title"
          className="text-[clamp(2rem,4.8vh,3.4rem)] leading-[1.1] font-bold tracking-tight text-balance"
        >
          {hasItems ? t.kioskRouteTitle : t.kioskWelcome}
        </h1>
        {/* In portrait the map needs the height more than the welcome needs a second line. */}
        <p
          aria-live="polite"
          className={`mt-[0.8vh] min-h-[1.4em] text-[clamp(1.1rem,2.3vh,1.5rem)] text-muted ${hasItems ? "" : "portrait:hidden"}`}
        >
          {hasItems ? summary : t.kioskWelcomeHint}
        </p>
      </div>

      <label className="relative block shrink-0">
        <span className="sr-only">{t.searchLabel}</span>
        <Search
          aria-hidden
          className="pointer-events-none absolute start-6 top-1/2 size-[clamp(1.75rem,3.6vh,2.5rem)] -translate-y-1/2 text-brand"
        />
        <input
          ref={inputRef}
          value={term}
          onChange={(event) => onTermChange(event.target.value)}
          disabled={isFull}
          placeholder={isFull ? t.quickFull : hasItems ? t.kioskAddMore : t.searchPlaceholder}
          maxLength={80}
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-[clamp(5.5rem,10vh,6.75rem)] w-full rounded-[1.75rem] bg-surface ps-[clamp(4.25rem,8vh,5.5rem)] pe-20 text-[clamp(1.5rem,3.2vh,2.25rem)] shadow-lg shadow-ink/5 ring-2 ring-line transition-shadow outline-none placeholder:text-muted focus:ring-[3px] focus:ring-brand disabled:bg-paper disabled:text-xl disabled:placeholder:text-ink"
        />
        {term && (
          <button
            type="button"
            onClick={() => {
              onTermChange("");
              inputRef.current?.focus();
            }}
            aria-label={t.clearSearch}
            className="absolute end-3 top-1/2 grid size-16 -translate-y-1/2 place-items-center rounded-2xl text-muted hover:bg-paper"
          >
            <X aria-hidden className="size-8" />
          </button>
        )}
      </label>

      {/* The padding keeps the scroll area from cutting off the cards' outlines and shadows. */}
      <div className="-m-1.5 min-h-0 flex-1 overflow-y-auto p-1.5 portrait:max-h-[20vh]">
        {typed ? (
          <SearchResults
            term={typed}
            hits={hits}
            failed={searchFailed}
            isSearching={isSearching}
            cartIds={cartIds}
            onPick={addHit}
          />
        ) : hasItems ? (
          <>
            {routeFailed && <Notice message={t.rerouteFailed} className="mb-3" />}
            {/* In portrait, one row of three: the map below needs the height. */}
            <ol className="flex flex-col gap-[1.2vh] portrait:grid portrait:grid-cols-3 portrait:gap-2">
              {inRouteOrder(items, route).map((item) => {
                const name = pick(item.name, item.nameEn);
                const code = codeOf(item.categoryId);
                // On a drawn plan, the shelf the route chose: a department may have several.
                const shelf = route?.stops.find((stop) => stop.category_id === item.categoryId)?.department;
                return (
                  <li
                    key={item.categoryId}
                    className="card-in relative flex items-center gap-4 rounded-3xl bg-surface p-[clamp(0.6rem,1.3vh,0.9rem)] ps-4 shadow-sm ring-1 ring-line portrait:gap-2.5 portrait:rounded-2xl portrait:p-2.5 portrait:pe-10"
                  >
                    {code ? (
                      <ZoneBadge
                        code={code}
                        tone={item.tone}
                        className="size-[clamp(3rem,6vh,3.75rem)] text-2xl portrait:size-12 portrait:text-lg"
                      />
                    ) : (
                      <span className="grid size-[clamp(3rem,6vh,3.75rem)] shrink-0 place-items-center rounded-full bg-brand-soft text-brand portrait:size-12">
                        <CategoryIcon categoryId={item.categoryId} className="size-7" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[clamp(1.25rem,2.6vh,1.65rem)] leading-tight font-semibold portrait:text-lg">
                        {name}
                      </span>
                      <span className="mt-0.5 block truncate text-[clamp(1rem,2vh,1.2rem)] text-muted portrait:text-sm">
                        {shelf ? t.onShelf(shelf) : where(item.categoryId, item.aisleNo, item.side, true)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemove(item.categoryId)}
                      aria-label={t.removeItem(name)}
                      className="grid size-14 shrink-0 place-items-center rounded-2xl text-muted hover:bg-danger-soft hover:text-danger portrait:absolute portrait:end-0 portrait:top-0 portrait:size-11 portrait:rounded-xl"
                    >
                      <X aria-hidden className="size-7 portrait:size-5" />
                    </button>
                  </li>
                );
              })}
            </ol>
            {isFull ? (
              <p className="mt-[2.4vh] flex items-center gap-4 rounded-3xl bg-next-soft px-5 py-4 text-[clamp(1.1rem,2.3vh,1.45rem)] font-medium ring-1 ring-next portrait:hidden">
                {/* Toward the code, under the map: down and away from this column, whichever side it's on. */}
                <ArrowDownLeft aria-hidden className="size-8 shrink-0 text-next ltr:-scale-x-100" />
                {t.kioskMoreOnPhone}
              </p>
            ) : (
              map && (
                <div className="portrait:hidden">
                  <h2 className="mt-[2.4vh] mb-[1.2vh] text-[clamp(1rem,2.1vh,1.3rem)] font-medium text-muted">
                    {t.browseCategories}
                  </h2>
                  <CategoryGrid map={map} cartIds={cartIds} onAdd={onAdd} />
                </div>
              )
            )}
          </>
        ) : (
          map && (
            <>
              <h2 className="mb-[1.2vh] text-[clamp(1rem,2.1vh,1.3rem)] font-medium text-muted">{t.browseCategories}</h2>
              <CategoryGrid map={map} cartIds={cartIds} onAdd={onAdd} />
            </>
          )
        )}
      </div>
    </section>
  );
}

interface SearchResultsProps {
  term: string;
  hits: readonly SearchHit[];
  failed: boolean;
  isSearching: boolean;
  cartIds: ReadonlySet<string>;
  onPick: (hit: SearchHit) => void;
}

function SearchResults({ term, hits, failed, isSearching, cartIds, onPick }: SearchResultsProps) {
  const { t, pick } = useLanguage();
  const where = usePlace();

  return (
    <>
      {failed && <Notice message={t.searchFailed} />}
      {isSearching && hits.length === 0 && (
        <p role="status" className="px-2 text-xl text-muted">
          {t.searching}
        </p>
      )}
      {!isSearching && !failed && hits.length === 0 && (
        <p role="status" className="px-2 text-xl text-muted">
          {t.noResults(term)}
        </p>
      )}
      <ul className="flex flex-col gap-[1.2vh]">
        {hits.map((hit) => {
          const added = cartIds.has(hit.category_id);
          const name = pick(hit.category_name, hit.category_name_en);
          return (
            <li key={hit.category_id}>
              <button
                type="button"
                data-hit={hit.category_id}
                disabled={added}
                onClick={() => onPick(hit)}
                aria-label={added ? t.alreadyAdded(name) : t.addItem(name)}
                className="flex min-h-[clamp(4.75rem,9vh,5.75rem)] w-full items-center gap-4 rounded-3xl bg-surface px-4 py-2.5 text-start shadow-sm ring-1 ring-line transition hover:ring-2 hover:ring-brand active:scale-[0.99] disabled:opacity-60"
              >
                <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand">
                  <CategoryIcon categoryId={hit.category_id} className="size-8" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[clamp(1.3rem,2.7vh,1.7rem)] font-semibold">{hit.matched_text}</span>
                  <span className="block truncate text-[clamp(1rem,2vh,1.2rem)] text-muted">
                    {name} · {where(hit.category_id, hit.aisle_no, hit.side)}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={`grid size-12 shrink-0 place-items-center rounded-full ${added ? "bg-brand-soft text-brand" : "bg-brand text-white"}`}
                >
                  {added ? <Check className="size-7" /> : <Plus className="size-7" />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

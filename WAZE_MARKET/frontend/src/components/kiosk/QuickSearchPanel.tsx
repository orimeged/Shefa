import { Check, Plus, RotateCcw, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import type { SearchHit, StoreMap } from "../../api/types";
import { useCategorySearch } from "../../hooks/useCategorySearch";
import { useLanguage } from "../../i18n/LanguageProvider";
import { MAX_QUICK_ITEMS } from "../../lib/kiosk/quickList";
import { CategoryIcon } from "../CategoryIcon";
import { LanguageToggle } from "../LanguageToggle";
import { Notice } from "../Notice";
import { CategoryGrid } from "./CategoryGrid";
import { QuickRoute } from "./QuickRoute";
import type { CartItem, NewCartItem } from "./types";

interface QuickSearchPanelProps {
  map: StoreMap | null;
  items: readonly CartItem[];
  sessionId: string;
  onAdd: (item: NewCartItem) => void;
  onRemove: (categoryId: string) => void;
  onClear: () => void;
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

export function QuickSearchPanel({
  map,
  items,
  sessionId,
  onAdd,
  onRemove,
  onClear,
}: QuickSearchPanelProps) {
  const { t, pick } = useLanguage();
  const [term, setTerm] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { hits, failed, isSearching } = useCategorySearch(term, sessionId);
  const cartIds = useMemo(() => new Set(items.map((item) => item.categoryId)), [items]);
  const isFull = items.length >= MAX_QUICK_ITEMS;

  const clear = () => {
    setTerm("");
    inputRef.current?.focus();
  };

  const addHit = (hit: SearchHit) => {
    onAdd(toCartItem(hit));
    setTerm("");
    // Closes the tablet's keyboard, which would otherwise cover the map.
    inputRef.current?.blur();
  };

  return (
    <section dir={t.direction} className="flex min-h-0 flex-col gap-3 overflow-hidden p-[2vh]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="min-w-0 text-[clamp(1.5rem,3.6vh,2.5rem)] leading-tight font-semibold tracking-tight">
          {t.quickSearchTitle}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {/* Up here rather than under the map, which gets the height instead. */}
          {items.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              aria-label={t.quickClear}
              title={t.quickClear}
              className="grid size-14 place-items-center rounded-full text-muted ring-1 ring-line hover:bg-surface"
            >
              <RotateCcw aria-hidden className="size-6" />
            </button>
          )}
          <LanguageToggle className="h-14 shrink-0 text-lg" />
        </div>
      </div>

      <label className="relative block shrink-0">
        <span className="sr-only">{t.searchLabel}</span>
        <Search
          aria-hidden
          className="pointer-events-none absolute start-6 top-1/2 size-9 -translate-y-1/2 text-muted"
        />
        <input
          ref={inputRef}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          disabled={isFull}
          placeholder={isFull ? t.quickFull : t.searchPlaceholder}
          maxLength={80}
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-24 w-full rounded-3xl bg-surface ps-20 pe-20 text-3xl shadow-sm ring-2 ring-line placeholder:text-muted focus:ring-brand disabled:bg-paper disabled:text-xl disabled:placeholder:text-ink"
        />
        {term && (
          <button
            type="button"
            onClick={clear}
            aria-label={t.clearSearch}
            className="absolute end-3 top-1/2 grid size-16 -translate-y-1/2 place-items-center rounded-2xl text-muted hover:bg-paper"
          >
            <X aria-hidden className="size-8" />
          </button>
        )}
      </label>

      {/* The padding keeps the scroll area from cutting off the cards' outlines. */}
      <div className="-m-1 min-h-0 flex-1 overflow-y-auto p-1">
        {term.trim() ? (
          <>
            {failed && <Notice message={t.searchFailed} />}
            {isSearching && hits.length === 0 && (
              <p role="status" className="px-2 text-xl text-muted">
                {t.searching}
              </p>
            )}
            {!isSearching && !failed && hits.length === 0 && (
              <p role="status" className="px-2 text-xl text-muted">
                {t.noResults(term.trim())}
              </p>
            )}
            <ul className="flex flex-col gap-3">
              {hits.map((hit) => {
                const added = cartIds.has(hit.category_id);
                const name = pick(hit.category_name, hit.category_name_en);
                return (
                  <li key={hit.category_id}>
                    <button
                      type="button"
                      disabled={added}
                      onClick={() => addHit(hit)}
                      aria-label={added ? t.alreadyAdded(name) : t.addItem(name)}
                      className="flex min-h-22 w-full items-center gap-4 rounded-3xl bg-surface px-5 py-3 text-start ring-1 ring-line transition-colors hover:bg-brand-soft disabled:opacity-60"
                    >
                      <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand">
                        <CategoryIcon categoryId={hit.category_id} className="size-8" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-2xl font-medium">{hit.matched_text}</span>
                        <span className="block truncate text-lg text-muted">
                          {name} · {t.aisle(hit.aisle_no, hit.side)}
                        </span>
                      </span>
                      {added ? (
                        <Check aria-hidden className="size-8 shrink-0 text-brand" />
                      ) : (
                        <Plus aria-hidden className="size-8 shrink-0 text-brand" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : items.length > 0 ? (
          <QuickRoute map={map} items={items} sessionId={sessionId} onRemove={onRemove} />
        ) : (
          map && (
            <>
              <h3 className="mb-2 text-lg font-medium text-muted">{t.browseCategories}</h3>
              <CategoryGrid map={map} cartIds={cartIds} onAdd={onAdd} />
            </>
          )
        )}
      </div>
    </section>
  );
}

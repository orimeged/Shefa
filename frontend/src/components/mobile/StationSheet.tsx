import { Check, ChevronUp, CircleAlert, PartyPopper, SearchX, ShoppingBasket } from "lucide-react";
import type { ReactNode } from "react";
import { forwardRef, useRef, useState } from "react";

import type { RouteStop } from "../../api/types";
import { usePlace } from "../../hooks/usePlace";
import { useLanguage } from "../../i18n/LanguageProvider";
import { CategoryIcon } from "../CategoryIcon";
import { FoundBurst } from "./FoundBurst";

const DOUBLE_TAP_MS = 500;

interface StationSheetProps {
  /** The station being headed for; none once every one is done. */
  stop: RouteStop | undefined;
  /** Its number in the trip, and how many there are. */
  number: number;
  total: number;
  /** What the shopper wrote for this station: what they're looking at the shelf for. */
  itemTexts: readonly string[];
  /** Metres to it, or to the checkout once all are done. Null when unknown. */
  distanceM: number | null;
  /** The station after this one, named under the button. */
  then: RouteStop | undefined;
  missingCount: number;
  /** What the store couldn't place: named on the sheet, so it isn't lost in the closed list. */
  waiting: readonly string[];
  onArrived: (categoryId: string) => void;
  onNotFound: (stop: RouteStop) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** The whole list, shown when the sheet is pulled up. */
  children: ReactNode;
}

/**
 * The trip, one station at a time, floating over the bottom of the map: where to
 * go, what to take there, and one big button for "I'm here, what's next". Pulled
 * up, it holds the whole list.
 */
export const StationSheet = forwardRef<HTMLElement, StationSheetProps>(function StationSheet(
  {
    stop,
    number,
    total,
    itemTexts,
    distanceM,
    then,
    missingCount,
    waiting,
    onArrived,
    onNotFound,
    expanded,
    onToggleExpanded,
    children,
  },
  ref,
) {
  const { t, pick } = useLanguage();
  const where = usePlace();
  const answeredAt = useRef(-Infinity);
  const [pops, setPops] = useState(0);

  // The next station lands under the same thumb, and a double tap mustn't answer it
  // too: not found would alert a manager about a full shelf.
  const answer = (respond: () => void) => {
    const now = performance.now();
    if (now - answeredAt.current >= DOUBLE_TAP_MS) {
      answeredAt.current = now;
      respond();
    }
  };

  const distance = distanceM === null ? null : distanceM === 0 ? t.rightHere : t.metersAway(distanceM);

  return (
    <section
      ref={ref}
      aria-label={t.stationSheet}
      className="station-sheet overflow-hidden rounded-[28px] bg-surface/95 shadow-[0_18px_50px_-12px_rgb(15_23_42/0.45)] ring-1 ring-black/5 backdrop-blur-xl"
    >
      <div aria-hidden className="flex justify-center pt-2 pb-1">
        <span className="h-1.5 w-10 rounded-full bg-line" />
      </div>

      {stop ? (
        <div key={stop.category_id} aria-live="polite" className="station-in px-4">
          <div className="flex items-center gap-3.5">
            <div className="relative shrink-0">
              <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-[#f6b955] to-next text-ink shadow-lg shadow-next/35">
                <CategoryIcon categoryId={stop.category_id} className="size-8" strokeWidth={2} />
              </span>
              <span className="absolute -end-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-ink text-xs font-bold text-white ring-2 ring-surface">
                {number}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold tracking-wide text-muted">{t.stationOf(number, total)}</p>
              <h2 className="line-clamp-2 text-2xl leading-tight font-bold tracking-tight">
                {pick(stop.category_name, stop.category_name_en)}
              </h2>
              <p className="truncate text-sm font-medium text-muted">
                {/* On a drawn plan, the exact place the route goes: a subcategory's shelf, say. */}
                <span>{stop.department ? t.onShelf(stop.department) : where(stop.category_id, stop.aisle_no, stop.side)}</span>
                {distance && (
                  <>
                    <span aria-hidden className="mx-1.5 text-line">●</span>
                    <span className="font-semibold text-brand-strong">{distance}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          {itemTexts.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {itemTexts.map((text) => (
                <li
                  key={text}
                  className="flex items-center gap-1.5 rounded-full bg-paper px-3 py-1 text-sm font-medium text-ink ring-1 ring-line"
                >
                  <ShoppingBasket aria-hidden className="size-3.5 text-muted" />
                  {text}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div aria-live="polite" className="station-in flex items-center gap-3.5 px-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/30">
            <PartyPopper aria-hidden className="size-8" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl leading-tight font-bold">
              {missingCount > 0 ? t.routeFinished(missingCount) : t.allFound}
            </h2>
            {distanceM !== null && <p className="text-sm font-medium text-muted">{t.allFoundHint(distanceM)}</p>}
          </div>
        </div>
      )}

      {stop && (
        <div className="flex gap-2 px-4 pt-4 pb-3">
          <button
            type="button"
            onClick={() =>
              answer(() => {
                setPops((count) => count + 1);
                onArrived(stop.category_id);
              })
            }
            className="arrive-button relative flex h-16 min-w-0 flex-1 items-center justify-center gap-2.5 overflow-hidden rounded-2xl bg-brand bg-gradient-to-b from-[#0f8f6b] to-brand text-xl font-bold text-white shadow-lg shadow-brand/35 transition active:scale-[0.98]"
          >
            {/* Keys of their own: siblings sharing one made React keep every old check. */}
            <Check key={`check-${pops}`} aria-hidden className={`size-7 ${pops > 0 ? "check-pop" : ""}`} strokeWidth={3} />
            {number >= total ? t.arrivedLast : t.arrivedNext}
            {pops > 0 && <FoundBurst key={`burst-${pops}`} />}
          </button>
          <button
            type="button"
            onClick={() => answer(() => onNotFound(stop))}
            className="flex h-16 w-24 shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl bg-surface text-xs font-semibold text-danger ring-1 ring-danger/35 transition active:scale-[0.98]"
          >
            <SearchX aria-hidden className="size-5" />
            {t.notFoundHere}
          </button>
        </div>
      )}

      {waiting.length > 0 && !expanded && (
        <button
          type="button"
          onClick={onToggleExpanded}
          className="mx-4 mb-3 flex min-h-11 w-[calc(100%-2rem)] items-center gap-2 rounded-xl bg-next-soft px-3 py-2 text-start text-sm font-medium text-ink"
        >
          <CircleAlert aria-hidden className="size-4 shrink-0 text-[#b26a00]" />
          <span className="truncate">
            {t.unmatchedHeading}:{" "}
            {waiting.map((text, index) => (
              <span key={`${text}-${index}`}>
                {index > 0 && ", "}
                <span>{text}</span>
              </span>
            ))}
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        className="flex min-h-12 w-full items-center justify-between gap-2 border-t border-line/70 px-4 py-2 text-sm font-medium text-muted"
      >
        <span className="truncate">{then ? t.thenStation(pick(then.category_name, then.category_name_en)) : null}</span>
        <span className="flex shrink-0 items-center gap-1 font-semibold text-ink">
          {expanded ? t.hideStations : t.showStations(total)}
          <ChevronUp aria-hidden className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </span>
      </button>

      {expanded && <div className="max-h-[48dvh] overflow-y-auto border-t border-line/70 px-4 py-3">{children}</div>}
    </section>
  );
});

import { LoaderCircle, Map as MapIcon, Navigation, Search } from "lucide-react";
import { forwardRef } from "react";

import { useLanguage } from "../../i18n/LanguageProvider";

/** Past this many stations a bar of segments gets too fine to read: one smooth bar instead. */
const MOST_SEGMENTS = 14;

interface TripHeaderProps {
  foundCount: number;
  total: number;
  /** Metres left to walk, to the checkout. */
  remainingM: number | null;
  isUpdating: boolean;
  isOverview: boolean;
  onToggleOverview: () => void;
  onSearch: () => void;
}

/** The trip at a glance over the top of the map: how far along, and the two things to reach for. */
export const TripHeader = forwardRef<HTMLElement, TripHeaderProps>(function TripHeader(
  { foundCount, total, remainingM, isUpdating, isOverview, onToggleOverview, onSearch },
  ref,
) {
  const { t } = useLanguage();
  const round = "pointer-events-auto grid size-12 shrink-0 place-items-center rounded-2xl bg-surface/90 text-ink shadow-lg ring-1 ring-black/5 backdrop-blur-md transition active:scale-95";

  return (
    <header
      ref={ref}
      className="pointer-events-none absolute inset-x-0 top-0 z-20 mx-auto max-w-xl px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]"
    >
      <div className="flex items-stretch gap-2">
        <div className="pointer-events-auto min-w-0 flex-1 rounded-2xl bg-surface/90 px-3.5 py-2.5 shadow-lg ring-1 ring-black/5 backdrop-blur-md">
          <div className="flex items-baseline justify-between gap-2">
            <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-bold">
              {isUpdating && <LoaderCircle aria-label={t.updatingRoute} className="size-3.5 shrink-0 animate-spin text-brand" />}
              {t.routeTitle}
            </p>
            <p className="shrink-0 text-xs font-semibold text-muted">
              {t.progress(foundCount, total)}
              {remainingM !== null && ` · ${t.metersLeft(remainingM)}`}
            </p>
          </div>
          <div
            role="progressbar"
            aria-label={t.routeTitle}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={foundCount}
            className="mt-2 flex h-1.5 gap-1"
          >
            {total <= MOST_SEGMENTS ? (
              Array.from({ length: total }, (_, index) => (
                <span
                  key={index}
                  className={`h-full flex-1 rounded-full transition-colors duration-500 ${
                    index < foundCount ? "bg-brand" : index === foundCount ? "segment-now bg-next" : "bg-line"
                  }`}
                />
              ))
            ) : (
              <span className="h-full flex-1 overflow-hidden rounded-full bg-line">
                <span
                  className="block h-full rounded-full bg-brand transition-[width] duration-500"
                  style={{ width: `${(foundCount / Math.max(1, total)) * 100}%` }}
                />
              </span>
            )}
          </div>
        </div>
        <button type="button" onClick={onSearch} aria-label={t.searchMore} className={round}>
          <Search aria-hidden className="size-5" />
        </button>
        <button
          type="button"
          onClick={onToggleOverview}
          aria-pressed={isOverview}
          aria-label={isOverview ? t.backToRoute : t.wholeStore}
          className={round}
        >
          {isOverview ? <Navigation aria-hidden className="size-5" /> : <MapIcon aria-hidden className="size-5" />}
        </button>
      </div>
    </header>
  );
});

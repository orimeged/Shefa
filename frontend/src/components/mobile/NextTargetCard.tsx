import { PartyPopper } from "lucide-react";

import type { RouteStop } from "../../api/types";
import { usePlace } from "../../hooks/usePlace";
import { useLanguage } from "../../i18n/LanguageProvider";
import { CategoryIcon } from "../CategoryIcon";

interface NextTargetCardProps {
  stop: RouteStop | undefined;
  /** What the shopper wrote for this stop, which is what they're looking at shelves for. */
  itemTexts: readonly string[];
  /** Metres to `stop`, or to the checkout when nothing is left. Null when unknown. */
  distanceM: number | null;
  foundCount: number;
  total: number;
  missingCount: number;
}

/**
 * What to look for and where, floating over the top of the map. Light text on a
 * near-black card stays readable under a store's glare, and the orange matches
 * the next pin on the map.
 */
export function NextTargetCard({
  stop,
  itemTexts,
  distanceM,
  foundCount,
  total,
  missingCount,
}: NextTargetCardProps) {
  const { t, pick } = useLanguage();
  const where = usePlace();
  const progress = t.progress(foundCount, total);

  if (!stop) {
    return (
      <div
        aria-live="polite"
        className="flex items-center gap-3 rounded-2xl bg-brand p-3 text-white shadow-lg"
      >
        <PartyPopper aria-hidden className="size-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xl font-semibold">
            {missingCount > 0 ? t.routeFinished(missingCount) : t.allFound}
          </p>
          {distanceM !== null && <p className="text-white/90">{t.allFoundHint(distanceM)}</p>}
        </div>
        <p className="shrink-0 text-sm font-medium text-white/90">{progress}</p>
      </div>
    );
  }

  const shelf = pick(stop.category_name, stop.category_name_en);
  const title = itemTexts.length > 0 ? itemTexts.join(" · ") : shelf;
  const zone = where(stop.category_id, stop.aisle_no, stop.side);

  return (
    <div
      aria-live="polite"
      className="flex items-center gap-3 rounded-2xl bg-ink p-3 text-white shadow-lg"
    >
      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-next text-ink">
        <CategoryIcon categoryId={stop.category_id} className="size-7" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-white/70">{t.nextStop}</p>
        <p className="truncate text-xl leading-tight font-semibold">{title}</p>
        <p className="truncate text-sm font-semibold text-next">
          {title === shelf ? zone : `${shelf} · ${zone}`}
        </p>
      </div>
      <div className="shrink-0 text-end">
        {distanceM !== null && (
          <p className="text-lg leading-tight font-semibold">
            {distanceM === 0 ? t.rightHere : t.metersAway(distanceM)}
          </p>
        )}
        <p className="text-sm font-medium text-white/70">{progress}</p>
      </div>
    </div>
  );
}

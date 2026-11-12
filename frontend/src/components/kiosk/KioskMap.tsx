import type { Route } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { MapLayout } from "../../lib/mapGeometry";
import type { FoundSet } from "../../lib/routeProgress";
import { StoreMapView } from "../mobile/StoreMapView";

const NOTHING_FOUND: FoundSet = new Set();

interface KioskMapProps {
  layout: MapLayout | null;
  /** The walk through what was picked; null before anything is. */
  route: Route | null;
  /** A drawn shelf to light up, such as where the first search result is. */
  highlight: string | null;
  badges: ReadonlyMap<string, { code: string; tone: number }>;
  /** What the map is showing. In landscape the header carries it, and the map gets the row. */
  caption: string;
}

/**
 * The store, always in view: before anything is picked it shows where every
 * department is, while typing it lights up the shelf the first result is on, and
 * with items picked it draws the whole walk from the entrance to the tills.
 */
export function KioskMap({ layout, route, highlight, badges, caption }: KioskMapProps) {
  const { t } = useLanguage();

  return (
    <section
      aria-labelledby="kiosk-map-title"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2rem] bg-surface shadow-sm ring-1 ring-line"
    >
      <h2 id="kiosk-map-title" className="sr-only">
        {t.mapPanelTitle}
      </h2>
      <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-[clamp(1rem,2.6vh,1.75rem)] pt-[clamp(0.75rem,2vh,1.25rem)] landscape:hidden">
        <p aria-hidden className="text-[clamp(1.35rem,2.6vh,1.75rem)] font-semibold">
          {t.mapPanelTitle}
        </p>
        <p aria-live="polite" className="text-[clamp(1rem,2vh,1.25rem)] font-medium text-muted">
          {caption}
        </p>
      </div>
      <div className="min-h-0 flex-1 p-[clamp(0.5rem,1.4vh,1rem)]">
        {layout ? (
          <StoreMapView
            layout={layout}
            route={route}
            found={NOTHING_FOUND}
            zoneBadges={badges}
            highlight={highlight}
            // A screen at the door: the whole store and the whole walk, markers sized to be read from a step back.
            focus="overview"
            emphasis="all"
            markerScale={1.35}
            footRoom={34}
            interactive={false}
            className="block h-full w-full"
          />
        ) : (
          <div className="h-full animate-pulse rounded-3xl bg-line/60" />
        )}
      </div>
    </section>
  );
}

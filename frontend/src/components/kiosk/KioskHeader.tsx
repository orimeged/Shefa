import { MapPinned, RotateCcw, Route } from "lucide-react";

import { useLanguage } from "../../i18n/LanguageProvider";
import { LanguagePicker } from "../LanguagePicker";

interface KioskHeaderProps {
  storeName: string | null;
  /** What the map is showing, written over it in landscape so the map needn't spend a row on a title. */
  caption: string;
  /** Something is picked or typed, so there's something to start over from. */
  canReset: boolean;
  onReset: () => void;
}

/**
 * The app and the branch, readable from a step away, with the two controls
 * anyone may need first. In landscape it shares the screen's two columns: the
 * name over the search, the map's caption and the controls over the map.
 */
export function KioskHeader({ storeName, caption, canReset, onReset }: KioskHeaderProps) {
  const { t } = useLanguage();

  return (
    <header
      dir={t.direction}
      className="flex shrink-0 items-center gap-4 px-[2.2vh] py-[1.8vh] landscape:grid landscape:grid-cols-[minmax(25rem,5fr)_minmax(0,7fr)] landscape:gap-[2.2vh]"
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <span className="grid size-[clamp(3.25rem,6.4vh,4.25rem)] shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-md shadow-brand/25">
          <MapPinned aria-hidden className="size-[55%]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[clamp(1.4rem,3vh,2rem)] leading-tight font-bold tracking-tight">{t.appName}</p>
          {storeName && <p className="truncate text-[clamp(1rem,2vh,1.25rem)] text-muted">{storeName}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 landscape:min-w-0">
        <p
          aria-live="polite"
          className="hidden min-w-0 flex-1 items-center gap-2 text-[clamp(1rem,2.1vh,1.3rem)] font-medium text-muted landscape:flex"
        >
          <Route aria-hidden className="size-[1.2em] shrink-0 text-brand" />
          <span className="truncate">{caption}</span>
        </p>
        {canReset && (
          <button
            type="button"
            onClick={onReset}
            className="flex h-14 shrink-0 items-center gap-2 rounded-full bg-surface px-5 text-lg font-medium ring-1 ring-line hover:bg-brand-soft"
          >
            <RotateCcw aria-hidden className="size-5" />
            {t.quickClear}
          </button>
        )}
        <LanguagePicker className="h-14 shrink-0 text-lg" />
      </div>
    </header>
  );
}

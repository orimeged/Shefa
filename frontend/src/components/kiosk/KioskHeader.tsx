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
 * The app and the branch on a dark band, as the staff app and the dashboard wear
 * it, readable from a step away, with the two controls anyone may need first. In
 * landscape it shares the screen's two columns: the name over the search, the map's
 * caption and the controls over the map. On a narrower tablet the language button
 * keeps just its icon, so the caption still fits.
 */
export function KioskHeader({ storeName, caption, canReset, onReset }: KioskHeaderProps) {
  const { t } = useLanguage();

  return (
    <header
      dir={t.direction}
      className="flex shrink-0 items-center gap-4 bg-slate-900 px-[2.2vh] py-[1.5vh] text-white landscape:grid landscape:grid-cols-[minmax(25rem,5fr)_minmax(0,7fr)] landscape:gap-[2.2vh]"
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <span className="grid size-[clamp(3rem,5.6vh,3.75rem)] shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-lg shadow-black/30">
          <MapPinned aria-hidden className="size-[55%]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[clamp(1.35rem,2.8vh,1.9rem)] leading-tight font-bold tracking-tight">{t.appName}</p>
          {storeName && <p className="truncate text-[clamp(0.95rem,1.9vh,1.2rem)] text-white/60">{storeName}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 landscape:min-w-0">
        <p
          aria-live="polite"
          className="hidden min-w-0 flex-1 items-center gap-2 text-[clamp(1rem,2vh,1.25rem)] font-medium text-white/75 landscape:flex"
        >
          <Route aria-hidden className="size-[1.2em] shrink-0 text-emerald-300" />
          <span className="truncate">{caption}</span>
        </p>
        {canReset && (
          <button
            type="button"
            onClick={onReset}
            className="flex h-12 shrink-0 items-center gap-2 rounded-full bg-white/10 px-5 text-lg font-medium text-white ring-1 ring-white/20 hover:bg-white/15"
          >
            <RotateCcw aria-hidden className="size-5" />
            {t.quickClear}
          </button>
        )}
        <LanguagePicker tone="dark" nameFrom="xl" className="h-12 min-w-12 shrink-0 text-lg" />
      </div>
    </header>
  );
}

import { SearchX, X } from "lucide-react";

import { useLanguage } from "../../i18n/LanguageProvider";
import type { ListItem } from "../../lib/list/shoppingItems";

interface NotFoundSheetProps {
  items: readonly ListItem[];
  onPick: (items: readonly ListItem[]) => void;
  onClose: () => void;
}

/** A stop can hold several items, and the shelf may be out of only one of them. */
export function NotFoundSheet({ items, onPick, onClose }: NotFoundSheetProps) {
  const { t } = useLanguage();

  return (
    <>
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-ink/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.whichItemMissing}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[80dvh] max-w-xl overflow-y-auto rounded-t-[2rem] bg-paper px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t.whichItemMissing}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.closePanel}
            className="grid size-11 place-items-center rounded-xl text-muted"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onPick([item])}
              className="flex min-h-14 items-center gap-3 rounded-2xl bg-surface px-4 py-2 text-start text-lg font-medium ring-1 ring-line"
            >
              <SearchX aria-hidden className="size-5 shrink-0 text-danger" />
              <span className="min-w-0 truncate">{item.text}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => onPick(items)}
            className="h-14 rounded-2xl bg-danger text-lg font-semibold text-white"
          >
            {t.noneOfThem}
          </button>
        </div>
      </div>
    </>
  );
}

import { Trash2, X } from "lucide-react";

import { usePlace } from "../../hooks/usePlace";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { ListItem } from "../../lib/list/shoppingItems";
import { CategoryIcon } from "../CategoryIcon";

interface ListDraftProps {
  items: readonly ListItem[];
  onRemove: (itemId: string) => void;
  onClear: () => void;
}

/** The list while it's being put together. Nothing here plans a route. */
export function ListDraft({ items, onRemove, onClear }: ListDraftProps) {
  const { t, pick } = useLanguage();
  const where = usePlace();
  const placed = items.filter((item) => item.placement);

  return (
    <section aria-label={t.draftTitle(placed.length)}>
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="font-semibold">{t.draftTitle(placed.length)}</h2>
        <button
          type="button"
          onClick={onClear}
          className="-me-2 flex h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-muted"
        >
          <Trash2 aria-hidden className="size-4" />
          {t.clearList}
        </button>
      </div>

      <ul className="divide-y divide-line">
        {placed.map(({ id, text, placement }) => {
          const { categoryId, name, nameEn, aisleNo, side } = placement!;
          const shelf = pick(name, nameEn);
          return (
            <li key={id} className="flex items-center gap-3 py-2 ps-1">
              <CategoryIcon categoryId={categoryId} className="size-6 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{text}</span>
                <span className="block truncate text-sm text-muted">
                  {/* A catalog item's stop carries its own name, already on the line above. */}
                  {shelf === text ? "" : `${shelf} · `}
                  {where(categoryId, aisleNo, side)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => onRemove(id)}
                aria-label={t.removeItem(text)}
                className="-me-2 grid size-11 shrink-0 place-items-center rounded-xl text-muted"
              >
                <X aria-hidden className="size-5" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

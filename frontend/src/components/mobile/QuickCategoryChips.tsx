import { Check } from "lucide-react";

import type { Category, StoreMap } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import { CategoryIcon } from "../CategoryIcon";

interface QuickCategoryChipsProps {
  map: StoreMap;
  selectedIds?: readonly string[];
  onSelect: (category: Category) => void;
  /** Two columns of big tiles on the page; chips in the trip's search panel and beside a stray item. */
  variant?: "chips" | "tiles";
}

export function QuickCategoryChips({ map, selectedIds = [], onSelect, variant = "chips" }: QuickCategoryChipsProps) {
  const { pick } = useLanguage();

  if (variant === "tiles") {
    return (
      <ul className="grid grid-cols-2 gap-2">
        {map.categories.map((category) => {
          const selected = selectedIds.includes(category.id);
          return (
            <li key={category.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(category)}
                className={`flex h-14 w-full items-center gap-2.5 rounded-2xl px-2.5 text-start font-medium ring-1 transition-colors ${
                  selected ? "bg-brand-soft text-brand-strong ring-brand" : "bg-surface ring-line active:bg-paper"
                }`}
              >
                <span
                  className={`grid size-9 shrink-0 place-items-center rounded-xl ${selected ? "bg-brand text-white" : "bg-brand-soft text-brand"}`}
                >
                  {selected ? (
                    <Check aria-hidden className="size-5" strokeWidth={3} />
                  ) : (
                    <CategoryIcon categoryId={category.id} className="size-5" />
                  )}
                </span>
                <span className="line-clamp-2 min-w-0 flex-1 text-[0.95rem] leading-tight">{pick(category.name, category.name_en)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {map.categories.map((category) => {
        const selected = selectedIds.includes(category.id);
        return (
          <li key={category.id}>
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(category)}
              className={`flex h-11 items-center gap-2 rounded-full px-3.5 font-medium transition-colors ${
                selected ? "bg-brand-soft text-brand-strong" : "bg-surface"
              }`}
            >
              {selected ? (
                <Check aria-hidden className="size-5" strokeWidth={3} />
              ) : (
                <CategoryIcon categoryId={category.id} className="size-5 text-muted" />
              )}
              {pick(category.name, category.name_en)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

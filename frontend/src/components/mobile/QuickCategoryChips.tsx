import { Check } from "lucide-react";

import type { Category, StoreMap } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import { CategoryIcon } from "../CategoryIcon";

interface QuickCategoryChipsProps {
  map: StoreMap;
  selectedIds?: readonly string[];
  onSelect: (category: Category) => void;
}

export function QuickCategoryChips({ map, selectedIds = [], onSelect }: QuickCategoryChipsProps) {
  const { pick } = useLanguage();

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

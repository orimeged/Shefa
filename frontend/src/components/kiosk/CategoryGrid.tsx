import { Check } from "lucide-react";
import { useMemo } from "react";

import type { Category, StoreMap } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import { CategoryIcon } from "../CategoryIcon";
import type { NewCartItem } from "./types";

interface CategoryGridProps {
  map: StoreMap;
  cartIds: ReadonlySet<string>;
  onAdd: (item: NewCartItem) => void;
}

export function CategoryGrid({ map, cartIds, onAdd }: CategoryGridProps) {
  const { t, pick } = useLanguage();
  const sections = useMemo(
    () => new Map(map.sections.map((section) => [section.id, section])),
    [map],
  );

  const addCategory = (category: Category) => {
    const section = sections.get(category.section_id);
    if (section) {
      onAdd({
        categoryId: category.id,
        name: category.name,
        nameEn: category.name_en,
        aisleNo: section.aisle_no,
        side: section.side,
      });
    }
  };

  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
      {map.categories.map((category) => {
        const added = cartIds.has(category.id);
        const name = pick(category.name, category.name_en);
        return (
          <li key={category.id}>
            <button
              type="button"
              disabled={added}
              onClick={() => addCategory(category)}
              aria-label={added ? t.alreadyAdded(name) : t.addItem(name)}
              className="relative flex h-30 w-full flex-col items-center gap-2 rounded-3xl bg-surface px-2 pt-5 text-center ring-1 ring-line transition-colors hover:bg-brand-soft disabled:bg-brand-soft"
            >
              <CategoryIcon categoryId={category.id} className="size-8 text-brand" />
              <span className="text-lg leading-tight font-medium">{name}</span>
              {added && (
                <Check aria-hidden className="absolute end-3 top-3 size-6 text-brand" />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

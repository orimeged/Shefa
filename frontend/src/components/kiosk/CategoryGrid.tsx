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
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-[1.1vh]">
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
              className="flex h-[clamp(4rem,8.2vh,5.5rem)] portrait:h-[clamp(3.5rem,5.4vh,4.5rem)] w-full items-center gap-2.5 rounded-2xl bg-surface ps-2.5 pe-2 text-start shadow-sm ring-1 ring-line transition hover:ring-2 hover:ring-brand active:scale-[0.98] disabled:bg-brand-soft disabled:ring-2 disabled:ring-brand"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                <CategoryIcon categoryId={category.id} className="size-6" />
              </span>
              <span className="line-clamp-2 min-w-0 flex-1 text-[clamp(1rem,2vh,1.2rem)] leading-tight font-medium">
                {name}
              </span>
              {added && <Check aria-hidden className="size-6 shrink-0 text-brand" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

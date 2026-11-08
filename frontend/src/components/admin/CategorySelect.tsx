import type { CatalogCategory } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";

interface CategorySelectProps {
  categories: readonly CatalogCategory[];
  value: number | null;
  onChange: (categoryId: number | null) => void;
  className?: string;
}

export function CategorySelect({ categories, value, onChange, className = "" }: CategorySelectProps) {
  const { t, language } = useLanguage();

  return (
    <select
      aria-label={t.pickCategory}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
      className={`h-11 min-w-0 rounded-xl bg-paper px-3 text-base ring-1 ${
        value === null ? "text-danger ring-danger" : "text-ink ring-line"
      } ${className}`}
    >
      <option value="">{t.pickCategory}</option>
      {categories.map((category) => (
        <option key={category.id} value={category.id}>
          {language === "he" ? category.name : category.name_en}
        </option>
      ))}
    </select>
  );
}

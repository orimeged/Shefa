import { Boxes, Package, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import type { AdminApi } from "../../api/adminClient";
import type { CatalogCategory, CatalogEntry } from "../../api/types";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useLanguage } from "../../i18n/LanguageProvider";
import { CategorySelect } from "./CategorySelect";

interface AddItemFormProps {
  api: AdminApi;
  categories: readonly CatalogCategory[];
  disabled: boolean;
  initialText?: string;
  initialCategoryId?: number | null;
  /** Hides departments, for when one item is moving and a whole department shouldn't. */
  productsOnly?: boolean;
  onAddExisting: (entry: CatalogEntry) => Promise<boolean>;
  onAddNew: (name: string, categoryId: number) => Promise<boolean>;
}

const SEARCH_DELAY_MS = 200;
const MAX_NAME_LENGTH = 120;

/** Offers what the store already knows first, so a typo doesn't become a new product. */
export function AddItemForm({
  api,
  categories,
  disabled,
  initialText = "",
  initialCategoryId = null,
  productsOnly = false,
  onAddExisting,
  onAddNew,
}: AddItemFormProps) {
  const { t } = useLanguage();
  const [text, setText] = useState(initialText.slice(0, MAX_NAME_LENGTH));
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const [found, setFound] = useState<CatalogEntry[]>([]);
  const query = useDebouncedValue(text.trim(), SEARCH_DELAY_MS);
  const matches = productsOnly
    ? found.filter((entry) => entry.entity_type === "product")
    : found;

  useEffect(() => {
    if (!query) {
      setFound([]);
      return;
    }
    const controller = new AbortController();
    api
      .searchCatalog(query, controller.signal)
      .then(setFound)
      .catch(() => {
        // Only a suggestion: typing a new product still works without it.
        if (!controller.signal.aborted) {
          setFound([]);
        }
      });
    return () => controller.abort();
  }, [api, query]);

  const reset = () => {
    setText("");
    setCategoryId(null);
    setFound([]);
  };

  const name = text.trim();
  const isExactMatch = matches.some((entry) => entry.name === name);

  return (
    <section className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 font-semibold">
        {t.addByText}
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t.addPlaceholder}
          maxLength={MAX_NAME_LENGTH}
          className="h-12 rounded-xl bg-surface px-3 text-base font-normal ring-1 ring-line"
        />
      </label>

      {matches.length > 0 && (
        <ul className="flex flex-col gap-1">
          {matches.map((entry) => {
            const Icon = entry.entity_type === "category" ? Boxes : Package;
            return (
              <li key={`${entry.entity_type}-${entry.entity_id}`}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={t.addExisting(entry.name)}
                  onClick={() => {
                    void onAddExisting(entry).then((saved) => saved && reset());
                  }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-surface px-3 py-1 text-start ring-1 ring-line hover:bg-brand-soft disabled:opacity-40"
                >
                  <Icon aria-hidden className="size-5 shrink-0 text-brand" />
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  <span className="shrink-0 text-sm text-muted">{entry.category_name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {name && !isExactMatch && (
        <div className="flex flex-wrap gap-2">
          <CategorySelect
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
            className="flex-1"
          />
          <button
            type="button"
            disabled={disabled || categoryId === null}
            onClick={() => {
              void onAddNew(name, categoryId!).then((saved) => saved && reset());
            }}
            className="flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white disabled:opacity-40"
          >
            <Plus aria-hidden className="size-5 shrink-0" />
            <span className="min-w-0 truncate">{t.addNewProduct(name)}</span>
          </button>
        </div>
      )}
    </section>
  );
}

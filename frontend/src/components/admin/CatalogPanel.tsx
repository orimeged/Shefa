import { CircleAlert, FileUp, LoaderCircle, MapPin, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import type { CatalogCategory, CatalogProduct } from "../../api/types";
import type { Catalog } from "../../hooks/useCatalog";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { ShelfOption } from "../../lib/admin/catalog";
import { draftOf, filterCatalog } from "../../lib/admin/catalog";
import { formatShekels } from "../../lib/admin/money";
import { Notice } from "../Notice";
import { ProductForm } from "./ProductForm";

/** Rows drawn at once; a search narrows a long catalog faster than scrolling it. */
const SHOWN_AT_ONCE = 300;

interface CatalogPanelProps {
  catalog: Catalog;
  categories: readonly CatalogCategory[];
  /** The drawn plan's shelves; null when the store has no plan that routes. */
  shelves: readonly ShelfOption[] | null;
}

/**
 * The whole catalog: every product, the department it's in and the shelf on the
 * map a shopper is sent to for it. A manager adds, edits and removes products
 * here, and sees at a glance what isn't on the map.
 */
export function CatalogPanel({ catalog, categories, shelves }: CatalogPanelProps) {
  const { t, pick, language } = useLanguage();
  const [query, setQuery] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const priceFile = useRef<HTMLInputElement>(null);
  const [department, setDepartment] = useState("");
  const [offMapOnly, setOffMapOnly] = useState(false);
  const [editing, setEditing] = useState<CatalogProduct | "new" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const departmentName = useMemo(() => {
    const names = new Map(categories.map((category) => [category.slug, pick(category.name, category.name_en)]));
    return (slug: string) => names.get(slug) ?? slug;
  }, [categories, pick]);

  const products = catalog.products;
  const shown = useMemo(
    () => (products ? filterCatalog(products, { query, department, offMapOnly }) : []),
    [products, query, department, offMapOnly],
  );
  const hasPlan = shelves !== null;
  const offMap = hasPlan && products ? products.filter((product) => product.shelf === null).length : 0;

  const importPrices = async (file: File) => {
    setIsImporting(true);
    setMessage(null);
    const result = await catalog.importPrices(file);
    setIsImporting(false);
    setMessage(
      result
        ? { ok: true, text: t.pricesImported(result.updated, result.matched, result.lines, result.products_without_price) }
        : { ok: false, text: t.pricesImportFailed },
    );
  };

  const remove = async (product: CatalogProduct) => {
    if (!window.confirm(t.catalogDeleteConfirm(product.name))) {
      return;
    }
    const result = await catalog.remove(product.id);
    setMessage(result.ok ? { ok: true, text: t.productDeleted(product.name) } : { ok: false, text: t.saveFailed });
  };

  return (
    <section aria-labelledby="catalog-title" className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="catalog-title" className="text-lg font-semibold">
            {t.adminTabCatalog}
          </h2>
          {products && (
            <p className="text-sm text-slate-500" aria-live="polite">
              {t.catalogSummary(products.length, offMap)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={priceFile}
            type="file"
            accept=".xml,.gz,application/xml,text/xml,application/gzip"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            data-price-file
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importPrices(file);
            }}
          />
          <button
            type="button"
            disabled={isImporting}
            title={t.pricesImportHint}
            onClick={() => priceFile.current?.click()}
            className="flex h-11 items-center gap-2 rounded-full bg-white px-4 font-medium text-slate-700 ring-1 ring-slate-300 disabled:opacity-60"
          >
            {isImporting ? (
              <LoaderCircle aria-hidden className="size-5 animate-spin" />
            ) : (
              <FileUp aria-hidden className="size-5" />
            )}
            {isImporting ? t.pricesImporting : t.pricesImport}
          </button>
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="flex h-11 items-center gap-2 rounded-full bg-brand px-5 font-semibold text-white shadow-sm"
          >
            <Plus aria-hidden className="size-5" />
            {t.catalogAdd}
          </button>
        </div>
      </div>

      {!hasPlan && (
        <p className="flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-2.5 text-sm text-slate-600 ring-1 ring-slate-200">
          <MapPin aria-hidden className="size-4 shrink-0" />
          {t.catalogNoPlan}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <span className="sr-only">{t.catalogSearch}</span>
          <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.catalogSearch}
            className="h-11 w-full rounded-xl bg-white ps-9 pe-3 ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-brand"
          />
        </label>
        <select
          aria-label={t.catalogColumns.department}
          value={department}
          onChange={(event) => setDepartment(event.target.value)}
          className="h-11 rounded-xl bg-white px-3 ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-brand"
        >
          <option value="">{t.catalogAllDepartments}</option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {pick(category.name, category.name_en)}
            </option>
          ))}
        </select>
        {hasPlan && (
          <button
            type="button"
            aria-pressed={offMapOnly}
            onClick={() => setOffMapOnly((on) => !on)}
            className={`flex h-11 items-center gap-1.5 rounded-xl px-3.5 text-sm font-medium ring-1 ${
              offMapOnly ? "bg-next-soft text-slate-900 ring-next" : "bg-white text-slate-600 ring-slate-300"
            }`}
          >
            <CircleAlert aria-hidden className="size-4" />
            {t.catalogOffMapOnly}
          </button>
        )}
      </div>

      {message && (
        <p role="status" className={`rounded-xl px-4 py-2.5 text-sm font-medium ${message.ok ? "bg-brand-soft text-brand-strong" : "bg-danger-soft text-danger"}`}>
          {message.text}
        </p>
      )}
      {catalog.failed && <Notice message={t.loadFailed} onRetry={catalog.reload} />}
      {!products && !catalog.failed && <div className="h-64 animate-pulse rounded-xl bg-slate-100" />}

      {products && (
        <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
          <table className="w-full min-w-[46rem] text-start text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-2.5 text-start font-medium">{t.catalogColumns.name}</th>
                <th scope="col" className="px-3 py-2.5 text-start font-medium">{t.catalogColumns.barcode}</th>
                <th scope="col" className="px-3 py-2.5 text-start font-medium">{t.catalogColumns.department}</th>
                <th scope="col" className="px-3 py-2.5 text-end font-medium">{t.catalogPrice}</th>
                <th scope="col" className="px-3 py-2.5 text-start font-medium">{t.catalogColumns.shelf}</th>
                <th scope="col" className="px-3 py-2.5 text-end font-medium">
                  <span className="sr-only">{t.catalogColumns.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.slice(0, SHOWN_AT_ONCE).map((product) => (
                <tr key={product.id} data-product={product.name} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <span className="font-medium text-slate-900">{product.name}</span>
                    {product.source === "pos" && (
                      <span className="ms-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{t.catalogImported}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-600">
                    <span dir="ltr">{product.barcode ?? "—"}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{departmentName(product.department)}</td>
                  <td data-price className="px-3 py-2 text-end whitespace-nowrap tabular-nums">
                    {product.price_agorot === null ? (
                      <span className="text-slate-400">{t.catalogNoPrice}</span>
                    ) : (
                      <span className="text-slate-900">{formatShekels(product.price_agorot, language)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {product.shelf ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-0.5 font-medium text-brand-strong">
                        <MapPin aria-hidden className="size-3.5" />
                        {product.shelf}
                      </span>
                    ) : hasPlan ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-next-soft px-2.5 py-0.5 font-medium text-slate-800">
                        <CircleAlert aria-hidden className="size-3.5" />
                        {t.catalogNotOnMap}
                      </span>
                    ) : (
                      <span className="text-slate-500">{product.subcategory ?? "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(product)}
                        aria-label={t.catalogEdit(product.name)}
                        className="grid size-10 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                      >
                        <Pencil aria-hidden className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(product)}
                        aria-label={t.catalogDelete(product.name)}
                        className="grid size-10 place-items-center rounded-lg text-slate-500 hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="px-4 py-8 text-center text-slate-500">{t.catalogEmpty}</p>}
        </div>
      )}

      {editing && (
        <ProductForm
          title={editing === "new" ? t.productNew : t.productEdit}
          initial={
            editing === "new"
              ? { department: department || undefined }
              : draftOf(editing)
          }
          categories={categories}
          shelves={shelves}
          onClose={() => setEditing(null)}
          onSubmit={async (draft) => {
            const result = editing === "new" ? await catalog.create(draft) : await catalog.update(editing.id, draft);
            if (!result.ok) {
              return result.problem;
            }
            setMessage({ ok: true, text: t.productSaved(draft.name) });
            return null;
          }}
        />
      )}
    </section>
  );
}

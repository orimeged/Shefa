import { CircleAlert, FileUp, LoaderCircle, MapPin, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import type { CatalogCategory, CatalogProduct } from "../../api/types";
import type { Catalog } from "../../hooks/useCatalog";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { ShelfOption } from "../../lib/admin/catalog";
import { draftOf, filterCatalog } from "../../lib/admin/catalog";
import { formatShekels } from "../../lib/money";
import type { FloorMap } from "../../lib/floorPlanMap";
import { BLOCK_LIFT, MapEndpoint, MapFloor } from "../MapFloor";
import { Notice } from "../Notice";
import { CARD, CARD_TITLE, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./cards";
import { ProductForm } from "./ProductForm";

/** Rows drawn at once; a search narrows a long catalog faster than scrolling it. */
const SHOWN_AT_ONCE = 120;

interface ProductsPanelProps {
  catalog: Catalog;
  categories: readonly CatalogCategory[];
  /** The drawn plan's shelves; null when the store has no plan that routes. */
  shelves: readonly ShelfOption[] | null;
  /** The drawn plan, to show where a product stands; null without one. */
  floor: FloorMap | null;
}

/**
 * Every product, and where it is: a search by name or barcode, each product with
 * its price and shelf, and the shelf lit up on the map once it's picked. Adding,
 * editing and removing a product all start here.
 */
export function ProductsPanel({ catalog, categories, shelves, floor }: ProductsPanelProps) {
  const { t, pick, language } = useLanguage();
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [offMapOnly, setOffMapOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [editing, setEditing] = useState<CatalogProduct | "new" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const priceFile = useRef<HTMLInputElement>(null);

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
  const selected = products?.find((product) => product.id === selectedId) ?? null;
  const lit = products?.find((product) => product.id === (previewId ?? selectedId)) ?? null;

  const importPrices = async (file: File) => {
    setIsImporting(true);
    setMessage(null);
    const result = await catalog.importPrices(file);
    setIsImporting(false);
    setMessage(
      result
        ? {
            ok: true,
            text: t.pricesImported(result.updated, result.matched, result.lines, result.products_without_price),
          }
        : { ok: false, text: t.pricesImportFailed },
    );
  };

  const remove = async (product: CatalogProduct) => {
    if (!window.confirm(t.catalogDeleteConfirm(product.name))) {
      return;
    }
    const result = await catalog.remove(product.id);
    if (result.ok && selectedId === product.id) setSelectedId(null);
    setMessage(result.ok ? { ok: true, text: t.productDeleted(product.name) } : { ok: false, text: t.saveFailed });
  };

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <section aria-labelledby="products-title" className={`${CARD} gap-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="products-title" className="text-2xl font-semibold text-ink">
              {t.adminNav.products}
            </h2>
            {products && (
              <p className="text-sm text-muted" aria-live="polite">
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
              className={SECONDARY_BUTTON}
            >
              {isImporting ? (
                <LoaderCircle aria-hidden className="size-5 animate-spin" />
              ) : (
                <FileUp aria-hidden className="size-5" />
              )}
              {isImporting ? t.pricesImporting : t.pricesImport}
            </button>
            <button type="button" onClick={() => setEditing("new")} className={PRIMARY_BUTTON}>
              <Plus aria-hidden className="size-5" />
              {t.catalogAdd}
            </button>
          </div>
        </div>

        <label className="relative">
          <span className="sr-only">{t.catalogSearch}</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.productsSearch}
            className="h-14 w-full rounded-2xl bg-paper ps-12 pe-4 text-lg text-ink ring-1 ring-line outline-none placeholder:text-muted focus:bg-surface focus:ring-2 focus:ring-brand"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t.catalogColumns.department}
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            className="h-11 min-w-44 rounded-2xl bg-surface px-3 text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-brand"
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
              className={`flex h-11 items-center gap-1.5 rounded-2xl px-4 text-sm font-semibold ring-1 ${
                offMapOnly ? "bg-next-soft text-ink ring-next" : "bg-surface text-muted ring-line"
              }`}
            >
              <CircleAlert aria-hidden className="size-4" />
              {t.catalogOffMapOnly}
            </button>
          )}
        </div>

        {!hasPlan && (
          <p className="flex items-center gap-2 rounded-2xl bg-paper px-4 py-3 text-sm text-muted ring-1 ring-line">
            <MapPin aria-hidden className="size-4 shrink-0" />
            {t.catalogNoPlan}
          </p>
        )}
        {message && (
          <p
            role="status"
            className={`rounded-2xl px-4 py-3 text-sm font-medium ${message.ok ? "bg-brand-soft text-brand-strong" : "bg-danger-soft text-danger"}`}
          >
            {message.text}
          </p>
        )}
        {catalog.failed && <Notice message={t.loadFailed} onRetry={catalog.reload} />}
        {!products && !catalog.failed && <div className="h-96 animate-pulse rounded-2xl bg-line/60" />}

        {products && (
          <div className="overflow-hidden rounded-2xl ring-1 ring-line">
            <ul className="divide-y divide-line" onPointerLeave={() => setPreviewId(null)}>
              {shown.slice(0, SHOWN_AT_ONCE).map((product) => {
                const isSelected = product.id === selectedId;
                return (
                  <li
                    key={product.id}
                    data-product={product.name}
                    data-selected={isSelected || undefined}
                    onPointerEnter={() => setPreviewId(product.id)}
                    className={`flex items-center gap-2 px-3 py-2 sm:gap-3 ${isSelected ? "bg-brand-soft" : "bg-surface hover:bg-paper"}`}
                  >
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      aria-label={t.productsShow(product.name)}
                      onClick={() => setSelectedId(isSelected ? null : product.id)}
                      className="min-w-0 flex-1 py-1 text-start"
                    >
                      <span className="block truncate font-semibold text-ink">{product.name}</span>
                      <span className="block truncate text-sm text-muted">
                        {departmentName(product.department)}
                        {product.barcode && (
                          <>
                            {" · "}
                            <span dir="ltr" className="font-mono text-xs">
                              {product.barcode}
                            </span>
                          </>
                        )}
                      </span>
                    </button>
                    <span
                      data-price
                      className="hidden w-20 shrink-0 text-end font-semibold whitespace-nowrap tabular-nums sm:block"
                    >
                      {product.price_agorot === null ? (
                        <span className="text-sm font-normal text-muted">{t.catalogNoPrice}</span>
                      ) : (
                        formatShekels(product.price_agorot, language)
                      )}
                    </span>
                    <span className="hidden w-40 shrink-0 md:block">
                      <ShelfChip product={product} hasPlan={hasPlan} />
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditing(product)}
                      aria-label={t.catalogEdit(product.name)}
                      className="grid size-10 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface hover:text-ink"
                    >
                      <Pencil aria-hidden className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(product)}
                      aria-label={t.catalogDelete(product.name)}
                      className="grid size-10 shrink-0 place-items-center rounded-xl text-muted hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {shown.length === 0 && <p className="px-4 py-10 text-center text-muted">{t.catalogEmpty}</p>}
            {shown.length > SHOWN_AT_ONCE && (
              <p className="border-t border-line bg-paper px-4 py-3 text-center text-sm text-muted">
                {t.productsMore(SHOWN_AT_ONCE, shown.length)}
              </p>
            )}
          </div>
        )}
      </section>

      <aside
        aria-labelledby="where-title"
        data-where={lit?.name}
        // On a phone the map card comes first, and only once there's a product to show on it.
        className={`order-first flex-col gap-3 rounded-3xl bg-surface p-5 shadow-sm ring-1 ring-line lg:sticky lg:top-24 lg:order-none ${
          lit ? "flex" : "hidden lg:flex"
        }`}
      >
        <div>
          <h2 id="where-title" className={CARD_TITLE}>
            {lit ? lit.name : t.productsWhereTitle}
          </h2>
          <p
            className={`flex items-center gap-1.5 ${lit?.shelf ? "font-semibold text-brand-strong" : "text-muted"}`}
            aria-live="polite"
          >
            {lit?.shelf && <MapPin aria-hidden className="size-4 shrink-0" />}
            {lit
              ? lit.shelf
                ? t.productsOnShelf(lit.shelf)
                : hasPlan
                  ? t.productsOffMap
                  : (lit.subcategory ?? "—")
              : t.productsPickHint}
          </p>
        </div>
        {floor && (
          <div className="overflow-hidden rounded-2xl bg-paper ring-1 ring-line">
            <svg
              viewBox={floor.layout.viewBox}
              role="img"
              aria-label={t.mapPanelTitle}
              data-map="where"
              className="block h-auto w-full"
            >
              <MapFloor layout={floor.layout} highlight={lit?.shelf ?? null} />
              <MapEndpoint point={floor.layout.entrance} label={t.entrance} />
              <MapEndpoint point={floor.layout.checkout} label={t.checkout} />
              {lit?.shelf && <ShelfMarker key={lit.shelf} floor={floor} shelf={lit.shelf} />}
            </svg>
          </div>
        )}
        {selected && (
          <button type="button" onClick={() => setEditing(selected)} className={SECONDARY_BUTTON}>
            <Pencil aria-hidden className="size-4" />
            {t.catalogEdit(selected.name)}
          </button>
        )}
      </aside>

      {editing && (
        <ProductForm
          title={editing === "new" ? t.productNew : t.productEdit}
          initial={
            editing === "new"
              ? {
                  department: department || undefined,
                  // A search that found nothing is usually the product to add: its name, or its barcode.
                  name: query.trim() && !/^\d+$/.test(query.trim()) ? query.trim() : undefined,
                  barcode: /^\d{8,14}$/.test(query.trim()) ? query.trim() : undefined,
                }
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
            if (result.product) setSelectedId(result.product.id);
            // A new product may sort far down a long list: show it, lit on the map, rather than make them look for it.
            if (editing === "new") {
              setQuery(draft.name);
              setDepartment("");
              setOffMapOnly(false);
            }
            setMessage({ ok: true, text: t.productSaved(draft.name) });
            return null;
          }}
        />
      )}
    </div>
  );
}

/** The product's shelf, filled in green, with a pin on it that pulses: findable at a glance on a whole-store map. */
function ShelfMarker({ floor, shelf }: { floor: FloorMap; shelf: string }) {
  const rects = floor.layout.shelves.filter((rect) => rect.label === shelf);
  if (rects.length === 0) return null;
  // The pin stands on the shelf's middle block: the one nearest the centre of them all.
  const middle = {
    x: rects.reduce((sum, rect) => sum + rect.x + rect.width / 2, 0) / rects.length,
    y: rects.reduce((sum, rect) => sum + rect.y + rect.height / 2, 0) / rects.length,
  };
  return (
    <g data-where-shelf={shelf} className="pointer-events-none">
      {rects.map((rect) => (
        <rect
          key={`${rect.x},${rect.y}`}
          x={rect.x - 0.25}
          y={rect.y - BLOCK_LIFT.shelf - 0.25}
          width={rect.width + 0.5}
          height={rect.height + BLOCK_LIFT.shelf + 0.5}
          rx={0.4}
          fill="var(--color-brand)"
          fillOpacity={0.55}
          stroke="var(--color-brand-strong)"
          strokeWidth={0.3}
        />
      ))}
      <circle cx={middle.x} cy={middle.y} r={2.2} fill="var(--color-brand)" opacity={0.35} className="pulse-ring" />
      <circle cx={middle.x} cy={middle.y} r={1.1} fill="var(--color-brand-strong)" stroke="white" strokeWidth={0.35} />
    </g>
  );
}

function ShelfChip({ product, hasPlan }: { product: CatalogProduct; hasPlan: boolean }) {
  const { t } = useLanguage();
  if (product.shelf) {
    return (
      <span
        data-shelf-of={product.name}
        className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-sm font-semibold text-brand-strong"
      >
        <MapPin aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{product.shelf}</span>
      </span>
    );
  }
  return hasPlan ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-next-soft px-2.5 py-1 text-sm font-semibold text-ink">
      <CircleAlert aria-hidden className="size-3.5" />
      {t.catalogNotOnMap}
    </span>
  ) : (
    <span className="text-sm text-muted">{product.subcategory ?? "—"}</span>
  );
}

import { ArrowDownToLine, MapPin, Pencil, Plus, X } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { CatalogCategory, CatalogProduct, NotFoundReportRow, ProductDraft } from "../../api/types";
import type { Catalog } from "../../hooks/useCatalog";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { ShelfOption } from "../../lib/admin/catalog";
import { filterCatalog } from "../../lib/admin/catalog";
import type { FloorMap } from "../../lib/floorPlanMap";
import { BLOCK_LIFT, MapEndpoint, MapFloor } from "../MapFloor";
import { ProductForm } from "./ProductForm";

/** How far a shelf's click target reaches past its block, in tiles: a thin gondola is still easy to hit. */
const HIT_MARGIN = 0.2;
/** Catalog products offered for a shopper's missing item, closest names first. */
const MATCHES_SHOWN = 8;

interface ShelvesMapProps {
  floor: FloorMap;
  /** The plan's shelves that stand for a department or one of its subcategories. */
  shelves: readonly ShelfOption[];
  catalog: Catalog;
  categories: readonly CatalogCategory[];
  /** The alert whose item is getting a shelf; a shelf picked then takes it. */
  placing: NotFoundReportRow | null;
  /** Drawn over the floor and under the shelves' click targets, such as the heat. */
  layers?: ReactNode;
  legend?: ReactNode;
  onPlaced: (row: NotFoundReportRow, shelf: string) => void;
}

/**
 * The shelf zones of the plan shoppers walk today: every named shelf on the
 * drawn map, what's on it, and a way to put a product on it. It reads the
 * current plan, so a shelf renamed or added in the editor is here at once.
 */
export function ShelvesMap({ floor, shelves, catalog, categories, placing, layers, legend, onPlaced }: ShelvesMapProps) {
  const { t, pick } = useLanguage();
  const { layout } = floor;
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState<ShelfOption | null>(null);

  const counts = useMemo(() => {
    const byShelf = new Map<string, number>();
    for (const product of catalog.products ?? []) {
      if (product.shelf) byShelf.set(product.shelf, (byShelf.get(product.shelf) ?? 0) + 1);
    }
    return byShelf;
  }, [catalog.products]);

  const targets = useMemo(
    () =>
      shelves.map((shelf) => ({
        shelf,
        rects: layout.shelves.filter((rect) => rect.label === shelf.label),
      })),
    [shelves, layout],
  );

  // Departments in the catalog's order, each with its shelves on the plan.
  const groups = useMemo(
    () =>
      categories.flatMap((category) => {
        const own = shelves.filter((shelf) => shelf.department === category.slug);
        return own.length > 0 ? [{ name: pick(category.name, category.name_en), slug: category.slug, shelves: own }] : [];
      }),
    [categories, shelves, pick],
  );

  const choose = (shelf: ShelfOption) => setOpen(shelf);
  const onKey = (shelf: ShelfOption) => (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(shelf);
    }
  };

  if (shelves.length === 0) {
    return <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-slate-600 ring-1 ring-slate-200">{t.shelfNone}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200">
        <svg viewBox={layout.viewBox} data-map="shelves" aria-label={t.floorViewZones} role="group" className="block h-auto max-h-[70vh] w-full">
          <MapFloor layout={layout} highlight={active ?? open?.label ?? null} />
          <MapEndpoint point={layout.entrance} label={t.entrance} />
          <MapEndpoint point={layout.checkout} label={t.checkout} />
          {layers}
          {targets.map(({ shelf, rects }) => {
            const count = counts.get(shelf.label) ?? 0;
            return (
              <g
                key={shelf.label}
                role="button"
                tabIndex={0}
                data-shelf={shelf.label}
                aria-label={t.shelfOpen(shelf.label, count)}
                onClick={() => choose(shelf)}
                onKeyDown={onKey(shelf)}
                onPointerEnter={() => setActive(shelf.label)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(shelf.label)}
                onBlur={() => setActive(null)}
                className="cursor-pointer outline-none"
              >
                <title>{t.shelfOpen(shelf.label, count)}</title>
                {rects.map((rect) => (
                  <rect
                    key={`${rect.x},${rect.y}`}
                    x={rect.x - HIT_MARGIN}
                    y={rect.y - BLOCK_LIFT.shelf - HIT_MARGIN}
                    width={rect.width + 2 * HIT_MARGIN}
                    height={rect.height + BLOCK_LIFT.shelf + 2 * HIT_MARGIN}
                    fill="transparent"
                  />
                ))}
              </g>
            );
          })}
        </svg>
        {legend}
      </div>

      <section aria-labelledby="shelves-list-title" className="flex flex-col gap-3">
        <h3 id="shelves-list-title" className="font-semibold text-slate-900">
          {t.shelvesListTitle}
        </h3>
        <ul className="flex flex-col gap-3">
          {groups.map((group) => (
            <li key={group.slug} className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-500">{group.name}</span>
              <div className="flex flex-wrap gap-1.5">
                {group.shelves.map((shelf) => {
                  const count = counts.get(shelf.label) ?? 0;
                  return (
                    <button
                      key={shelf.label}
                      type="button"
                      data-shelf-chip={shelf.label}
                      aria-label={t.shelfOpen(shelf.label, count)}
                      onClick={() => choose(shelf)}
                      onPointerEnter={() => setActive(shelf.label)}
                      onPointerLeave={() => setActive(null)}
                      className="flex min-h-10 items-center gap-2 rounded-full bg-white px-3 text-sm font-medium text-slate-800 ring-1 ring-slate-300 hover:ring-brand"
                    >
                      {shelf.label}
                      <span
                        className={`grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-xs font-semibold ${
                          count > 0 ? "bg-brand-soft text-brand-strong" : "bg-slate-100 text-slate-400"
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {open && (
        <ShelfDialog
          key={open.label}
          shelf={open}
          departmentName={groups.find((group) => group.slug === open.department)?.name ?? open.department}
          catalog={catalog}
          categories={categories}
          shelves={shelves}
          placing={placing}
          onPlaced={(row, where) => {
            setOpen(null);
            onPlaced(row, where);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

interface ShelfDialogProps {
  shelf: ShelfOption;
  departmentName: string;
  catalog: Catalog;
  categories: readonly CatalogCategory[];
  shelves: readonly ShelfOption[];
  placing: NotFoundReportRow | null;
  /** The shelf the product reached, which the form may have changed from this one. */
  onPlaced: (row: NotFoundReportRow, shelf: string) => void;
  onClose: () => void;
}

/** One shelf: the products shoppers are sent to it for, and adding or moving one onto it. */
function ShelfDialog({ shelf, departmentName, catalog, categories, shelves, placing, onPlaced, onClose }: ShelfDialogProps) {
  const { t } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const [form, setForm] = useState<{ title: string; initial: Partial<ProductDraft>; product: CatalogProduct | null } | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [moving, setMoving] = useState<number | null>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  const here = { department: shelf.department, subcategory: shelf.subcategory };
  const onShelf = useMemo(
    () => (catalog.products ?? []).filter((product) => product.shelf === shelf.label),
    [catalog.products, shelf.label],
  );
  // For a shopper's missing item: what the catalog already has by that name, the exact name first.
  const matches = useMemo(() => {
    if (!placing || !catalog.products) return [];
    const wanted = placing.item_query.trim();
    const found = filterCatalog(catalog.products, { query: wanted, department: "", offMapOnly: false });
    return found.sort((a, b) => Number(b.name === wanted) - Number(a.name === wanted)).slice(0, MATCHES_SHOWN);
  }, [placing, catalog.products]);

  const moveHere = async (product: CatalogProduct) => {
    setMoving(product.id);
    setFailed(false);
    const result = await catalog.update(product.id, here);
    setMoving(null);
    if (!result.ok) {
      setFailed(true);
    } else if (placing) {
      onPlaced(placing, result.product?.shelf ?? shelf.label);
    }
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${ids}-title`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 text-slate-900 shadow-2xl backdrop:bg-slate-900/40"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id={`${ids}-title`} className="flex items-center gap-2 text-lg font-semibold">
              <MapPin aria-hidden className="size-5 shrink-0 text-brand" />
              {shelf.label}
            </h2>
            <p className="text-sm text-slate-500">{t.shelfOf(departmentName)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.closePanel}
            className="grid size-11 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>

        {failed && (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-2.5 text-sm font-medium text-danger">
            {t.saveFailed}
          </p>
        )}

        {placing ? (
          <section aria-labelledby={`${ids}-matches`} className="flex flex-col gap-2">
            <p role="status" className="rounded-xl bg-next-soft px-4 py-2.5 font-medium ring-1 ring-next">
              {t.shelfPlaceHere(placing.item_query)}
            </p>
            <h3 id={`${ids}-matches`} className="font-semibold">
              {t.shelfMatches}
            </h3>
            {matches.length === 0 && <p className="text-sm text-slate-500">{t.shelfNoMatches}</p>}
            <ul className="flex flex-col divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
              {matches.map((product) => (
                <li key={product.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{product.name}</p>
                    <p className="text-sm text-slate-500">
                      {product.shelf ? t.shelfCurrently(product.shelf) : t.catalogNotOnMap}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={moving !== null}
                    onClick={() => void moveHere(product)}
                    aria-label={t.shelfMove(product.name)}
                    className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-brand px-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    <ArrowDownToLine aria-hidden className="size-4" />
                    {t.shelfMoveHere}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() =>
                setForm({ title: t.productNew, initial: { name: placing.item_query, ...here }, product: null })
              }
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 font-semibold text-brand-strong ring-1 ring-brand"
            >
              <Plus aria-hidden className="size-5" />
              {t.shelfAddAsNew(placing.item_query)}
            </button>
          </section>
        ) : (
          <section aria-labelledby={`${ids}-products`} className="flex flex-col gap-2">
            <h3 id={`${ids}-products`} className="font-semibold">
              {t.shelfProducts(onShelf.length)}
            </h3>
            {onShelf.length === 0 ? (
              <p className="text-sm text-slate-500">{t.shelfEmpty}</p>
            ) : (
              <ul className="flex max-h-80 flex-col divide-y divide-slate-100 overflow-y-auto rounded-xl ring-1 ring-slate-200">
                {onShelf.map((product) => (
                  <li key={product.id} className="flex items-center gap-2 px-3 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{product.name}</p>
                      {product.barcode && (
                        <p className="font-mono text-xs text-slate-500">
                          <span dir="ltr">{product.barcode}</span>
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          title: t.productEdit,
                          initial: {
                            name: product.name,
                            barcode: product.barcode,
                            brand: product.brand,
                            size: product.size,
                            department: product.department,
                            subcategory: product.subcategory,
                          },
                          product,
                        })
                      }
                      aria-label={t.catalogEdit(product.name)}
                      className="grid size-10 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    >
                      <Pencil aria-hidden className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => setForm({ title: t.productNew, initial: here, product: null })}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white"
            >
              <Plus aria-hidden className="size-5" />
              {t.shelfAddHere}
            </button>
          </section>
        )}
      </div>

      {form && (
        <ProductForm
          title={form.title}
          initial={form.initial}
          categories={categories}
          shelves={shelves}
          note={placing && !form.product ? t.shelfPlaceHere(placing.item_query) : undefined}
          onClose={() => setForm(null)}
          onSubmit={async (draft) => {
            const result = form.product ? await catalog.update(form.product.id, draft) : await catalog.create(draft);
            if (!result.ok) {
              return result.problem;
            }
            if (placing && !form.product) {
              onPlaced(placing, result.product?.shelf ?? shelf.label);
            }
            return null;
          }}
        />
      )}
    </dialog>
  );
}

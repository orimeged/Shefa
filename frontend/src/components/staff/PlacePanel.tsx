import {
  ArrowLeftRight,
  Camera,
  Check,
  ChevronLeft,
  LoaderCircle,
  MapPin,
  PackagePlus,
  ScanLine,
  Search,
  X,
} from "lucide-react";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";

import type { StaffApi } from "../../api/staffClient";
import type {
  CatalogCategory,
  CatalogProduct,
  NotFoundReportRow,
} from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { ShelfOption } from "../../lib/admin/catalog";
import { shelvesOf } from "../../lib/admin/catalog";
import { isProductCode } from "../../lib/staff/barcode";
import { Notice } from "../Notice";
import { BarcodeScanner } from "./BarcodeScanner";

interface PlacePanelProps {
  api: StaffApi;
  /** The drawn plan's shelves; null when the store has no plan that routes. */
  shelves: readonly ShelfOption[] | null;
  categories: readonly CatalogCategory[];
  /** The alert this placing answers, when it came from "somewhere else". */
  relocating: NotFoundReportRow | null;
  onCancelRelocating: () => void;
  /** Resolves to whether the alert it answered closed too. */
  onPlaced: (
    product: CatalogProduct,
    answered: NotFoundReportRow | null,
  ) => Promise<boolean>;
}

type Step =
  | { kind: "start" }
  | { kind: "scanning" }
  | { kind: "looking"; barcode: string }
  | { kind: "found"; product: CatalogProduct }
  | { kind: "unknown"; barcode: string }
  | { kind: "saved"; message: string; closedAlert: boolean };

/**
 * A product's place, said the way the store is laid out: a department, and the area
 * within it, where "חטיפים מלוחים" and "עוגות ועוגיות" are areas of the sweets and
 * snacks row. Scan it, see both, and either confirm or move it to another area. A map
 * nobody keeps up goes stale in a month; this is how it stays right.
 */
export function PlacePanel({
  api,
  shelves,
  categories,
  relocating,
  onCancelRelocating,
  onPlaced,
}: PlacePanelProps) {
  const { t, pick } = useLanguage();
  const [step, setStep] = useState<Step>({ kind: "start" });
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // The departments that have areas on the plan, in the catalog's order.
  const departments = useMemo(() => {
    const withAreas = new Set((shelves ?? []).map((shelf) => shelf.department));
    const ordered = categories
      .filter((category) => withAreas.has(category.slug))
      .map((category) => category.slug);
    return [
      ...ordered,
      ...[...withAreas].filter((slug) => !ordered.includes(slug)),
    ];
  }, [shelves, categories]);

  const nameOf = (slug: string) => {
    const category = categories.find((candidate) => candidate.slug === slug);
    return category ? pick(category.name, category.name_en) : slug;
  };

  const lookUp = async (barcode: string) => {
    setProblem(null);
    setStep({ kind: "looking", barcode });
    try {
      const [found] = await api.findProduct(barcode);
      setStep(
        found
          ? { kind: "found", product: found }
          : { kind: "unknown", barcode },
      );
    } catch {
      setProblem(t.placeLookupFailed);
      setStep({ kind: "start" });
    }
  };

  const finish = async (saved: CatalogProduct, area: ShelfOption) => {
    const closedAlert = await onPlaced(saved, relocating);
    setStep({
      kind: "saved",
      message: t.placeSaved(
        saved.name,
        nameOf(saved.department),
        saved.shelf ?? area.label,
      ),
      closedAlert,
    });
    setTyped("");
  };

  const place = async (product: CatalogProduct, area: ShelfOption) => {
    setIsSaving(true);
    setProblem(null);
    try {
      await finish(
        await api.placeProduct(product.id, {
          department: area.department,
          subcategory: area.subcategory,
        }),
        area,
      );
    } catch {
      setProblem(t.saveFailed);
    } finally {
      setIsSaving(false);
    }
  };

  // Where the map sends shoppers is right: nothing changes, and an alert that sent the worker here closes.
  const keep = async (product: CatalogProduct) => {
    setIsSaving(true);
    setProblem(null);
    try {
      const closedAlert = await onPlaced(product, relocating);
      setStep({
        kind: "saved",
        message: t.placeKept(product.name, product.shelf ?? ""),
        closedAlert,
      });
      setTyped("");
    } catch {
      setProblem(t.saveFailed);
    } finally {
      setIsSaving(false);
    }
  };

  const create = async (barcode: string, name: string, area: ShelfOption) => {
    setIsSaving(true);
    setProblem(null);
    try {
      await finish(
        await api.addProduct({
          name,
          barcode,
          department: area.department,
          subcategory: area.subcategory,
        }),
        area,
      );
    } catch {
      setProblem(t.productInvalid);
    } finally {
      setIsSaving(false);
    }
  };

  if (shelves === null || shelves.length === 0) {
    return (
      <p className="rounded-3xl bg-surface px-4 py-6 text-center text-muted ring-1 ring-line">
        {t.placeNoPlan}
      </p>
    );
  }

  const submitTyped = (event: FormEvent) => {
    event.preventDefault();
    const barcode = typed.replace(/\s+/g, "");
    if (isProductCode(barcode)) void lookUp(barcode);
  };

  return (
    <section aria-labelledby="place-title" className="flex flex-col gap-3">
      <h2 id="place-title" className="text-xl font-semibold">
        {t.staffNav.place}
      </h2>

      {relocating && step.kind !== "saved" && (
        <div className="flex items-start gap-2 rounded-2xl bg-next-soft px-4 py-3 ring-1 ring-next/40">
          <p className="flex-1 text-sm font-medium">
            {t.placeRelocating(relocating.item_query)}
          </p>
          <button
            type="button"
            onClick={onCancelRelocating}
            aria-label={t.placingCancel}
            className="grid size-8 shrink-0 place-items-center rounded-full"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}
      {problem && <Notice message={problem} />}

      {(step.kind === "start" || step.kind === "looking") && (
        <>
          <button
            type="button"
            disabled={step.kind === "looking"}
            onClick={() => setStep({ kind: "scanning" })}
            className="flex h-28 flex-col items-center justify-center gap-2 rounded-3xl bg-brand text-lg font-semibold text-white shadow-sm disabled:opacity-60"
          >
            {step.kind === "looking" ? (
              <LoaderCircle aria-hidden className="size-8 animate-spin" />
            ) : (
              <ScanLine aria-hidden className="size-8" />
            )}
            {step.kind === "looking" ? t.placeLooking : t.placeScan}
          </button>
          <form onSubmit={submitTyped} className="flex gap-2">
            <label className="flex-1">
              <span className="sr-only">{t.placeTypeBarcode}</span>
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                inputMode="numeric"
                maxLength={16}
                placeholder={t.placeTypeBarcode}
                dir="ltr"
                className="h-12 w-full rounded-2xl bg-surface px-4 text-center text-lg tracking-wider ring-1 ring-line outline-none focus:ring-2 focus:ring-brand"
              />
            </label>
            <button
              type="submit"
              disabled={
                !isProductCode(typed.replace(/\s+/g, "")) ||
                step.kind === "looking"
              }
              aria-label={t.placeFind}
              className="grid size-12 place-items-center rounded-2xl bg-surface ring-1 ring-line disabled:opacity-40"
            >
              <Search aria-hidden className="size-5" />
            </button>
          </form>
        </>
      )}

      {step.kind === "scanning" && (
        <BarcodeScanner
          onDetected={(barcode) => void lookUp(barcode)}
          onClose={() => setStep({ kind: "start" })}
        />
      )}

      {step.kind === "found" && (
        <ProductPlace
          key={step.product.id}
          product={step.product}
          shelves={shelves}
          departments={departments}
          nameOf={nameOf}
          isSaving={isSaving}
          onKeep={() => void keep(step.product)}
          onMove={(area) => void place(step.product, area)}
          onCancel={() => setStep({ kind: "start" })}
        />
      )}

      {step.kind === "unknown" && (
        <NewProduct
          barcode={step.barcode}
          shelves={shelves}
          departments={departments}
          nameOf={nameOf}
          suggestedName={relocating?.item_query ?? ""}
          isSaving={isSaving}
          onCreate={(name, area) => void create(step.barcode, name, area)}
          onCancel={() => setStep({ kind: "start" })}
        />
      )}

      {step.kind === "saved" && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-3xl bg-brand-soft p-4 ring-1 ring-brand/30"
        >
          <p className="flex items-start gap-2 font-semibold text-brand-strong">
            <Check aria-hidden className="mt-0.5 size-5 shrink-0" />
            {step.message}
            {step.closedAlert ? ` ${t.placeAlertClosed}` : ""}
          </p>
          <button
            type="button"
            onClick={() => setStep({ kind: "scanning" })}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-brand font-semibold text-white"
          >
            <Camera aria-hidden className="size-5" />
            {t.placeScanAnother}
          </button>
        </div>
      )}
    </section>
  );
}

interface ProductPlaceProps {
  product: CatalogProduct;
  shelves: readonly ShelfOption[];
  departments: readonly string[];
  nameOf: (slug: string) => string;
  isSaving: boolean;
  onKeep: () => void;
  onMove: (area: ShelfOption) => void;
  onCancel: () => void;
}

/** A scanned product: its department and area at a glance, its department drawn as a row of areas, then keep or move. */
function ProductPlace({
  product,
  shelves,
  departments,
  nameOf,
  isSaving,
  onKeep,
  onMove,
  onCancel,
}: ProductPlaceProps) {
  const { t } = useLanguage();
  // Off the map, there's nothing to confirm: straight to choosing where it goes.
  const [moving, setMoving] = useState<{ target: ShelfOption | null } | null>(
    product.shelf ? null : { target: null },
  );
  const department = nameOf(product.department);
  const own = shelvesOf(shelves, product.department);

  return (
    <div
      data-place-product
      className="flex flex-col gap-4 rounded-3xl bg-surface p-4 shadow-sm ring-1 ring-line"
    >
      <div>
        <p className="text-lg font-semibold">{product.name}</p>
        <p className="text-sm text-muted" dir="ltr">
          {product.barcode}
        </p>
      </div>

      <PlaceNow department={department} area={product.shelf} />

      {moving === null ? (
        <>
          {own.length > 1 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold">
                {t.placeAreasIn(department)}
              </p>
              <AreaStrip
                areas={own}
                current={product.shelf}
                selected={product.shelf}
                disabled={isSaving}
                onPick={(area) =>
                  area.label !== product.shelf && setMoving({ target: area })
                }
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={isSaving}
              onClick={onKeep}
              className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand px-3 text-center leading-tight font-semibold text-white shadow-sm disabled:opacity-60"
            >
              {isSaving ? (
                <LoaderCircle
                  aria-hidden
                  className="size-5 shrink-0 animate-spin"
                />
              ) : (
                <Check aria-hidden className="size-5 shrink-0" />
              )}
              {t.placeConfirm}
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => setMoving({ target: null })}
              className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-surface px-3 text-center leading-tight font-semibold text-ink ring-1 ring-line disabled:opacity-60"
            >
              <ArrowLeftRight aria-hidden className="size-5 shrink-0" />
              {t.placeMove}
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <p className="text-lg font-semibold">{t.placeWhere}</p>
          <ChooseArea
            shelves={shelves}
            departments={departments}
            nameOf={nameOf}
            initialDepartment={moving.target?.department ?? product.department}
            initialTarget={moving.target}
            current={product.shelf}
            isSaving={isSaving}
            saveLabel={t.placeMoveTo}
            onSave={onMove}
          />
        </div>
      )}

      <button
        type="button"
        onClick={
          moving !== null && product.shelf ? () => setMoving(null) : onCancel
        }
        className="h-11 rounded-2xl font-medium text-muted ring-1 ring-line"
      >
        {t.productCancel}
      </button>
    </div>
  );
}

/** Department, then area: the same two words everywhere a place is shown. */
function PlaceNow({
  department,
  area,
}: {
  department: string;
  area: string | null;
}) {
  const { t } = useLanguage();
  return (
    <div data-place-now className="flex items-stretch gap-1.5">
      <div className="min-w-0 flex-1 rounded-2xl bg-paper px-3 py-2 ring-1 ring-line">
        <p className="text-xs font-medium text-muted">{t.placeDepartment}</p>
        <p className="leading-tight font-semibold">{department}</p>
      </div>
      <ChevronLeft
        aria-hidden
        className="size-5 shrink-0 self-center text-muted ltr:rotate-180"
      />
      <div className="min-w-0 flex-1 rounded-2xl bg-brand-soft px-3 py-2 ring-1 ring-brand/30">
        <p className="text-xs font-medium text-brand-strong/80">
          {t.placeArea}
        </p>
        <p className="leading-tight font-semibold text-brand-strong">
          {area ?? t.placeNotOnMap}
        </p>
      </div>
    </div>
  );
}

interface ChooseAreaProps {
  shelves: readonly ShelfOption[];
  departments: readonly string[];
  nameOf: (slug: string) => string;
  initialDepartment: string;
  initialTarget?: ShelfOption | null;
  /** Where the map sends shoppers now, marked on the row; null for a product it doesn't know yet. */
  current: string | null;
  isSaving: boolean;
  /** Something before the area is still missing, such as a new product's name. */
  isBlocked?: boolean;
  saveLabel: (area: string) => string;
  onSave: (area: ShelfOption) => void;
}

/** Pick a department, tap an area of it, save: nothing is written until the button says where. */
function ChooseArea({
  shelves,
  departments,
  nameOf,
  initialDepartment,
  initialTarget = null,
  current,
  isSaving,
  isBlocked = false,
  saveLabel,
  onSave,
}: ChooseAreaProps) {
  const { t } = useLanguage();
  const [department, setDepartment] = useState(
    departments.includes(initialDepartment)
      ? initialDepartment
      : (departments[0] ?? ""),
  );
  const [target, setTarget] = useState<ShelfOption | null>(initialTarget);
  // Fixed once: the department it starts in leads, and tapping another never reorders the row.
  const [ordered] = useState(() => [
    ...departments.filter((slug) => slug === department),
    ...departments.filter((slug) => slug !== department),
  ]);
  const areas = shelvesOf(shelves, department);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">{t.placeWhichDepartment}</p>
        <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          <div className="flex w-max gap-2">
            {ordered.map((slug) => (
              <button
                key={slug}
                type="button"
                data-department-choice={slug}
                aria-pressed={slug === department}
                onClick={() => {
                  setDepartment(slug);
                  setTarget(null);
                }}
                className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-medium whitespace-nowrap ring-1 transition ${
                  slug === department
                    ? "bg-slate-900 text-white ring-slate-900"
                    : "bg-surface text-ink ring-line"
                }`}
              >
                {nameOf(slug)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">{t.placeWhichArea}</p>
        {areas.length > 0 ? (
          <AreaStrip
            areas={areas}
            current={current}
            selected={target?.label ?? null}
            disabled={isSaving}
            onPick={setTarget}
          />
        ) : (
          <p className="text-sm text-muted">{t.placeNoAreas}</p>
        )}
      </div>

      <button
        type="button"
        disabled={!target || isSaving || isBlocked}
        onClick={() => target && onSave(target)}
        className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand px-4 text-center leading-tight font-semibold text-white shadow-sm disabled:opacity-50"
      >
        {isSaving ? (
          <LoaderCircle aria-hidden className="size-5 shrink-0 animate-spin" />
        ) : (
          <Check aria-hidden className="size-5 shrink-0" />
        )}
        {target ? saveLabel(target.label) : t.placePickArea}
      </button>
    </div>
  );
}

const COLUMNS = ["grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4"];

interface AreaStripProps {
  areas: readonly ShelfOption[];
  current: string | null;
  selected: string | null;
  disabled: boolean;
  onPick: (area: ShelfOption) => void;
}

/** A department drawn as the row it is in the store, cut into its areas: where a product stands, and where it can go. */
function AreaStrip({
  areas,
  current,
  selected,
  disabled,
  onPick,
}: AreaStripProps) {
  const { t } = useLanguage();
  const columns =
    areas.length <= COLUMNS.length ? COLUMNS[areas.length - 1] : "grid-cols-3";

  return (
    <div
      data-area-strip
      className={`grid gap-1.5 rounded-2xl bg-slate-100 p-1.5 ring-1 ring-line ${columns}`}
    >
      {areas.map((area) => {
        const isSelected = area.label === selected;
        return (
          <button
            key={area.label}
            type="button"
            disabled={disabled}
            data-shelf-choice={area.label}
            aria-pressed={isSelected}
            onClick={() => onPick(area)}
            className={`flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center text-sm leading-tight font-semibold break-words transition disabled:opacity-60 ${
              isSelected
                ? "bg-brand-soft text-brand-strong ring-2 ring-brand"
                : "bg-surface text-ink ring-1 ring-line"
            }`}
          >
            {area.label}
            {area.label === current && (
              <span className="flex items-center gap-0.5 text-[0.7rem] font-medium text-muted">
                <MapPin aria-hidden className="size-3" />
                {t.placeHereNow}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface NewProductProps {
  barcode: string;
  shelves: readonly ShelfOption[];
  departments: readonly string[];
  nameOf: (slug: string) => string;
  suggestedName: string;
  isSaving: boolean;
  onCreate: (name: string, area: ShelfOption) => void;
  onCancel: () => void;
}

/** A barcode the catalog lacks: its name, then its department and area, as for any product. The price is the office's. */
function NewProduct({
  barcode,
  shelves,
  departments,
  nameOf,
  suggestedName,
  isSaving,
  onCreate,
  onCancel,
}: NewProductProps) {
  const { t } = useLanguage();
  const [name, setName] = useState(suggestedName);
  const hasName = name.trim() !== "";

  return (
    <div
      data-place-new
      className="flex flex-col gap-4 rounded-3xl bg-surface p-4 shadow-sm ring-1 ring-line"
    >
      <p className="flex items-center gap-2 font-semibold">
        <PackagePlus aria-hidden className="size-5" />
        {t.placeUnknown(barcode)}
      </p>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {t.productFields.name}
        <input
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          className="h-12 rounded-2xl bg-paper px-4 text-base font-normal ring-1 ring-line outline-none focus:ring-2 focus:ring-brand"
        />
      </label>
      <ChooseArea
        shelves={shelves}
        departments={departments}
        nameOf={nameOf}
        initialDepartment={departments[0] ?? ""}
        current={null}
        isSaving={isSaving}
        isBlocked={!hasName}
        saveLabel={t.placeSaveIn}
        onSave={(area) => onCreate(name.trim(), area)}
      />
      {!hasName && (
        <p className="-mt-2 text-sm text-muted">{t.placeNameFirst}</p>
      )}
      <button
        type="button"
        onClick={onCancel}
        className="h-11 rounded-2xl font-medium text-muted ring-1 ring-line"
      >
        {t.productCancel}
      </button>
    </div>
  );
}

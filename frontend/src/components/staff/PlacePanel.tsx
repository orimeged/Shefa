import { Camera, Check, ChevronDown, LoaderCircle, MapPin, PackagePlus, ScanLine, Search, X } from "lucide-react";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";

import type { StaffApi } from "../../api/staffClient";
import type { CatalogCategory, CatalogProduct, NotFoundReportRow } from "../../api/types";
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
  onPlaced: (product: CatalogProduct, answered: NotFoundReportRow | null) => Promise<boolean>;
}

type Step =
  | { kind: "start" }
  | { kind: "scanning" }
  | { kind: "looking"; barcode: string }
  | { kind: "found"; product: CatalogProduct }
  | { kind: "unknown"; barcode: string }
  | { kind: "saved"; product: CatalogProduct; shelf: string; closedAlert: boolean };

/**
 * A product's place, fixed at the shelf in three taps: scan it, see where the map
 * sends shoppers, tap the shelf it really stands on. A map nobody keeps up goes
 * stale in a month; this is how it stays right.
 */
export function PlacePanel({ api, shelves, categories, relocating, onCancelRelocating, onPlaced }: PlacePanelProps) {
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>({ kind: "start" });
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const lookUp = async (barcode: string) => {
    setProblem(null);
    setStep({ kind: "looking", barcode });
    try {
      const [found] = await api.findProduct(barcode);
      setStep(found ? { kind: "found", product: found } : { kind: "unknown", barcode });
    } catch {
      setProblem(t.placeLookupFailed);
      setStep({ kind: "start" });
    }
  };

  const finish = async (saved: CatalogProduct, shelf: ShelfOption) => {
    const closedAlert = await onPlaced(saved, relocating);
    setStep({ kind: "saved", product: saved, shelf: saved.shelf ?? shelf.label, closedAlert });
    setTyped("");
  };

  const place = async (product: CatalogProduct, shelf: ShelfOption) => {
    setIsSaving(true);
    setProblem(null);
    try {
      await finish(await api.placeProduct(product.id, { department: shelf.department, subcategory: shelf.subcategory }), shelf);
    } catch {
      setProblem(t.saveFailed);
    } finally {
      setIsSaving(false);
    }
  };

  const create = async (barcode: string, name: string, shelf: ShelfOption) => {
    setIsSaving(true);
    setProblem(null);
    try {
      await finish(await api.addProduct({ name, barcode, department: shelf.department, subcategory: shelf.subcategory }), shelf);
    } catch {
      setProblem(t.productInvalid);
    } finally {
      setIsSaving(false);
    }
  };

  if (shelves === null || shelves.length === 0) {
    return <p className="rounded-3xl bg-surface px-4 py-6 text-center text-muted ring-1 ring-line">{t.placeNoPlan}</p>;
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
          <p className="flex-1 text-sm font-medium">{t.placeRelocating(relocating.item_query)}</p>
          <button type="button" onClick={onCancelRelocating} aria-label={t.placingCancel} className="grid size-8 shrink-0 place-items-center rounded-full">
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
            {step.kind === "looking" ? <LoaderCircle aria-hidden className="size-8 animate-spin" /> : <ScanLine aria-hidden className="size-8" />}
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
              disabled={!isProductCode(typed.replace(/\s+/g, "")) || step.kind === "looking"}
              aria-label={t.placeFind}
              className="grid size-12 place-items-center rounded-2xl bg-surface ring-1 ring-line disabled:opacity-40"
            >
              <Search aria-hidden className="size-5" />
            </button>
          </form>
        </>
      )}

      {step.kind === "scanning" && (
        <BarcodeScanner onDetected={(barcode) => void lookUp(barcode)} onClose={() => setStep({ kind: "start" })} />
      )}

      {step.kind === "found" && (
        <div data-place-product className="flex flex-col gap-3 rounded-3xl bg-surface p-4 ring-1 ring-line">
          <div>
            <p className="text-lg font-semibold">{step.product.name}</p>
            <p className="text-sm text-muted" dir="ltr">
              {step.product.barcode}
            </p>
            <p className="mt-1 flex items-center gap-1 text-muted">
              <MapPin aria-hidden className="size-4" />
              {step.product.shelf ? t.placeNow(step.product.shelf) : t.catalogNotOnMap}
            </p>
          </div>
          <ShelfPicker
            shelves={shelves}
            department={step.product.department}
            current={step.product.shelf}
            isSaving={isSaving}
            onPick={(shelf) => void place(step.product, shelf)}
          />
          <button type="button" onClick={() => setStep({ kind: "start" })} className="h-11 rounded-2xl font-medium text-muted ring-1 ring-line">
            {t.productCancel}
          </button>
        </div>
      )}

      {step.kind === "unknown" && (
        <NewProduct
          barcode={step.barcode}
          shelves={shelves}
          categories={categories}
          suggestedName={relocating?.item_query ?? ""}
          isSaving={isSaving}
          onCreate={(name, shelf) => void create(step.barcode, name, shelf)}
          onCancel={() => setStep({ kind: "start" })}
        />
      )}

      {step.kind === "saved" && (
        <div role="status" className="flex flex-col gap-3 rounded-3xl bg-brand-soft p-4 ring-1 ring-brand/30">
          <p className="flex items-start gap-2 font-semibold text-brand-strong">
            <Check aria-hidden className="mt-0.5 size-5 shrink-0" />
            {t.placeSaved(step.product.name, step.shelf)}
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

interface ShelfPickerProps {
  shelves: readonly ShelfOption[];
  department: string;
  current: string | null;
  isSaving: boolean;
  onPick: (shelf: ShelfOption) => void;
}

/** Its department's shelves first, as big buttons; any other shelf a tap further. */
function ShelfPicker({ shelves, department, current, isSaving, onPick }: ShelfPickerProps) {
  const { t } = useLanguage();
  const [showOthers, setShowOthers] = useState(false);
  const [filter, setFilter] = useState("");
  const own = shelvesOf(shelves, department);
  const others = useMemo(() => {
    const words = filter.trim().split(/\s+/).filter(Boolean);
    return shelves.filter((shelf) => shelf.department !== department && words.every((word) => shelf.label.includes(word)));
  }, [shelves, department, filter]);

  const button = (shelf: ShelfOption) => (
    <button
      key={shelf.label}
      type="button"
      disabled={isSaving}
      data-shelf-choice={shelf.label}
      onClick={() => onPick(shelf)}
      className={`flex min-h-12 items-center justify-between gap-2 rounded-2xl px-4 py-2 text-start font-medium ring-1 disabled:opacity-60 ${
        shelf.label === current ? "bg-brand-soft text-brand-strong ring-brand/40" : "bg-paper ring-line"
      }`}
    >
      {shelf.label}
      {shelf.label === current && <span className="text-xs">{t.placeHereNow}</span>}
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">{t.placeWhichShelf}</p>
      <div className="grid gap-2">{own.map(button)}</div>
      <button
        type="button"
        aria-expanded={showOthers}
        onClick={() => setShowOthers((open) => !open)}
        className="flex h-11 items-center justify-center gap-1 text-sm font-medium text-muted"
      >
        {t.placeOtherShelves}
        <ChevronDown aria-hidden className={`size-4 transition ${showOthers ? "rotate-180" : ""}`} />
      </button>
      {showOthers && (
        <>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t.placeFilterShelves}
            aria-label={t.placeFilterShelves}
            className="h-11 rounded-2xl bg-paper px-4 ring-1 ring-line outline-none focus:ring-2 focus:ring-brand"
          />
          <div className="grid max-h-72 gap-2 overflow-y-auto">{others.map(button)}</div>
        </>
      )}
    </div>
  );
}

interface NewProductProps {
  barcode: string;
  shelves: readonly ShelfOption[];
  categories: readonly CatalogCategory[];
  suggestedName: string;
  isSaving: boolean;
  onCreate: (name: string, shelf: ShelfOption) => void;
  onCancel: () => void;
}

/** A barcode the catalog lacks: its name, its department, and the shelf it's on. The price is the office's. */
function NewProduct({ barcode, shelves, categories, suggestedName, isSaving, onCreate, onCancel }: NewProductProps) {
  const { t, pick } = useLanguage();
  const [name, setName] = useState(suggestedName);
  const [department, setDepartment] = useState(categories[0]?.slug ?? "");

  return (
    <div data-place-new className="flex flex-col gap-3 rounded-3xl bg-surface p-4 ring-1 ring-line">
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
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {t.productFields.department}
        <select
          value={department}
          onChange={(event) => setDepartment(event.target.value)}
          className="h-12 rounded-2xl bg-paper px-4 text-base font-normal ring-1 ring-line"
        >
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {pick(category.name, category.name_en)}
            </option>
          ))}
        </select>
      </label>
      {name.trim() ? (
        <ShelfPicker shelves={shelves} department={department} current={null} isSaving={isSaving} onPick={(shelf) => onCreate(name.trim(), shelf)} />
      ) : (
        <p className="text-sm text-muted">{t.placeNameFirst}</p>
      )}
      <button type="button" onClick={onCancel} className="h-11 rounded-2xl font-medium text-muted ring-1 ring-line">
        {t.productCancel}
      </button>
    </div>
  );
}

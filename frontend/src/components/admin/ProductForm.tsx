import { X } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { CatalogCategory, ProductDraft } from "../../api/types";
import type { CatalogProblem } from "../../hooks/useCatalog";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { ShelfOption } from "../../lib/admin/catalog";
import { barcodeProblem, shelvesOf } from "../../lib/admin/catalog";

interface ProductFormProps {
  title: string;
  /** What the form opens with: an existing product's details, or a shelf's department and subcategory. */
  initial: Partial<ProductDraft>;
  categories: readonly CatalogCategory[];
  /** The drawn plan's shelves; null when the store has no plan, and the subcategory is typed instead. */
  shelves: readonly ShelfOption[] | null;
  /** A line over the fields, such as which alert the product answers. */
  note?: string;
  onSubmit: (draft: ProductDraft) => Promise<CatalogProblem | null>;
  onClose: () => void;
}

/** One product's details: its Hebrew name, barcode, department and the shelf shoppers are sent to. */
export function ProductForm({ title, initial, categories, shelves, note, onSubmit, onClose }: ProductFormProps) {
  const { t, pick } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const [name, setName] = useState(initial.name ?? "");
  const [barcode, setBarcode] = useState(initial.barcode ?? "");
  const [brand, setBrand] = useState(initial.brand ?? "");
  const [size, setSize] = useState(initial.size ?? "");
  const [department, setDepartment] = useState(initial.department ?? categories[0]?.slug ?? "");
  const [subcategory, setSubcategory] = useState<string>(initial.subcategory ?? "");
  const [problem, setProblem] = useState<CatalogProblem | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // The native modal keeps focus inside and shuts the page behind it to screen readers.
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  const options = useMemo(() => (shelves ? shelvesOf(shelves, department) : []), [shelves, department]);
  const known = categories.find((category) => category.slug === department)?.subcategories ?? [];
  // A subcategory no shelf on the plan carries stays choosable, saying so, rather than vanishing.
  const isUndrawn = shelves !== null && subcategory !== "" && !options.some((shelf) => shelf.subcategory === subcategory);
  const badBarcode = barcodeProblem(barcode);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (badBarcode || !name.trim() || !department) {
      return;
    }
    setIsSaving(true);
    setProblem(null);
    const outcome = await onSubmit({
      name: name.trim(),
      barcode: barcode.replace(/\s+/g, "") || null,
      brand: brand.trim() || null,
      size: size.trim() || null,
      department,
      subcategory: subcategory || null,
    });
    setIsSaving(false);
    if (outcome) {
      setProblem(outcome);
    } else {
      onClose();
    }
  };

  const field = "h-11 w-full rounded-xl bg-white px-3 text-slate-900 ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-brand";

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
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <h2 id={`${ids}-title`} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.closePanel}
            className="grid size-11 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>

        {note && <p className="rounded-xl bg-next-soft px-4 py-2.5 text-sm font-medium ring-1 ring-next">{note}</p>}

        <Field id={`${ids}-name`} label={t.productFields.name}>
          <input
            id={`${ids}-name`}
            required
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            className={field}
            autoFocus
          />
        </Field>

        <Field id={`${ids}-barcode-field`} label={t.productFields.barcode}>
          <input
            id={`${ids}-barcode-field`}
            value={barcode}
            inputMode="numeric"
            maxLength={16}
            aria-invalid={badBarcode}
            aria-describedby={badBarcode ? `${ids}-barcode` : undefined}
            onChange={(event) => setBarcode(event.target.value)}
            className={`${field} ${badBarcode ? "ring-2 ring-danger" : ""}`}
            dir="ltr"
          />
          {badBarcode && (
            <span id={`${ids}-barcode`} className="text-sm font-medium text-danger">
              {t.productBarcodeInvalid}
            </span>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field id={`${ids}-brand`} label={t.productFields.brand}>
            <input id={`${ids}-brand`} value={brand} maxLength={120} onChange={(event) => setBrand(event.target.value)} className={field} />
          </Field>
          <Field id={`${ids}-size`} label={t.productFields.size}>
            <input id={`${ids}-size`} value={size} maxLength={120} onChange={(event) => setSize(event.target.value)} className={field} />
          </Field>
        </div>

        <Field id={`${ids}-department`} label={t.productFields.department}>
          <select
            id={`${ids}-department`}
            value={department}
            onChange={(event) => {
              setDepartment(event.target.value);
              // Another department's shelves are another list.
              setSubcategory("");
            }}
            className={field}
          >
            {categories.map((category) => (
              <option key={category.slug} value={category.slug}>
                {pick(category.name, category.name_en)}
              </option>
            ))}
          </select>
        </Field>

        {shelves ? (
          <Field id={`${ids}-shelf`} label={t.productFields.shelf}>
            <select
              id={`${ids}-shelf`}
              value={subcategory}
              aria-describedby={`${ids}-shelf-hint`}
              onChange={(event) => setSubcategory(event.target.value)}
              className={field}
            >
              <option value="">{t.productWholeDepartment}</option>
              {options
                .filter((shelf) => shelf.subcategory !== null)
                .map((shelf) => (
                  <option key={shelf.label} value={shelf.subcategory!}>
                    {shelf.label}
                  </option>
                ))}
              {isUndrawn && <option value={subcategory}>{t.productShelfNotDrawn(subcategory)}</option>}
            </select>
            <span id={`${ids}-shelf-hint`} className="text-sm text-slate-500">
              {t.productShelfHint}
            </span>
          </Field>
        ) : (
          <Field id={`${ids}-subcategory`} label={t.productFields.subcategory}>
            <input
              id={`${ids}-subcategory`}
              value={subcategory}
              list={`${ids}-subcategories`}
              maxLength={120}
              onChange={(event) => setSubcategory(event.target.value)}
              className={field}
            />
            <datalist id={`${ids}-subcategories`}>
              {known.map((known_name) => (
                <option key={known_name} value={known_name} />
              ))}
            </datalist>
          </Field>
        )}

        {problem && (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-2.5 text-sm font-medium text-danger">
            {problem === "duplicate" ? t.productDuplicate : problem === "invalid" ? t.productInvalid : t.saveFailed}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isSaving || badBarcode || !name.trim()}
            className="h-12 flex-1 rounded-xl bg-brand font-semibold text-white shadow-sm disabled:opacity-50"
          >
            {t.productSave}
          </button>
          <button type="button" onClick={onClose} className="h-12 rounded-xl px-5 font-medium text-slate-600 ring-1 ring-slate-300">
            {t.productCancel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** A label over its control, tied by id so the control's name is the label alone, not its options too. */
function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-slate-700">
        {label}
      </label>
      {children}
    </div>
  );
}

import { Check, X } from "lucide-react";

import type { CatalogCategory } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { StagedRow } from "../../lib/admin/staging";
import { isReadyToSave } from "../../lib/admin/staging";
import { CategorySelect } from "./CategorySelect";

interface StagingAreaProps {
  rows: readonly StagedRow[];
  transcript: string;
  fromDictionary: boolean;
  categories: readonly CatalogCategory[];
  disabled: boolean;
  onChange: (rows: StagedRow[]) => void;
  onApprove: () => void;
}

/** Nothing heard reaches the store until a manager has seen it here. */
export function StagingArea({
  rows,
  transcript,
  fromDictionary,
  categories,
  disabled,
  onChange,
  onApprove,
}: StagingAreaProps) {
  const { t } = useLanguage();

  const update = (key: string, change: Partial<StagedRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));

  return (
    <section
      aria-label={t.stagingTitle}
      className="flex flex-col gap-2 rounded-2xl bg-next-soft p-3 ring-1 ring-next"
    >
      <div>
        <h3 className="font-semibold">{t.stagingTitle}</h3>
        <p className="text-sm text-muted">{t.stagingHint}</p>
      </div>
      {transcript && <p className="text-sm text-muted">{t.heardTranscript(transcript)}</p>}
      {fromDictionary && <p className="text-sm font-medium text-ink">{t.dictionaryOnly}</p>}

      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface p-2">
            <input
              aria-label={t.itemName}
              value={row.name}
              maxLength={120}
              onChange={(event) => update(row.key, { name: event.target.value })}
              className="h-11 min-w-32 flex-1 rounded-xl bg-paper px-3 text-base ring-1 ring-line"
            />
            <CategorySelect
              categories={categories}
              value={row.categoryId}
              onChange={(categoryId) => update(row.key, { categoryId })}
              className="min-w-32 flex-1"
            />
            <button
              type="button"
              aria-label={t.removeStaged(row.name)}
              onClick={() => onChange(rows.filter((other) => other.key !== row.key))}
              className="grid size-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-danger-soft hover:text-danger"
            >
              <X aria-hidden className="size-5" />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || !isReadyToSave(rows)}
          onClick={onApprove}
          className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white disabled:opacity-40"
        >
          <Check aria-hidden className="size-5 shrink-0" />
          {t.approveItems(rows.length)}
        </button>
        <button
          type="button"
          onClick={() => onChange([])}
          className="min-h-12 rounded-xl px-4 font-medium text-muted"
        >
          {t.discardStaged}
        </button>
      </div>
    </section>
  );
}

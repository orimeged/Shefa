import { LoaderCircle, X } from "lucide-react";
import { useState } from "react";

import type { Category, StoreMap } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { ListItem } from "../../lib/list/shoppingItems";
import { Notice } from "../Notice";
import { QuickCategoryChips } from "./QuickCategoryChips";

interface UnmatchedItemsProps {
  map: StoreMap | null;
  pendingCount: number;
  unmatched: readonly ListItem[];
  resolveFailed: boolean;
  onRetry: () => void;
  onAssign: (itemId: string, category: Category) => void;
  onRemove: (itemId: string) => void;
}

/** Items the store couldn't place stay on the list, because the shopper still wants them. */
export function UnmatchedItems({
  map,
  pendingCount,
  unmatched,
  resolveFailed,
  onRetry,
  onAssign,
  onRemove,
}: UnmatchedItemsProps) {
  const { t } = useLanguage();
  const [assigningId, setAssigningId] = useState<string | null>(null);

  return (
    <>
      {resolveFailed ? (
        <Notice message={t.resolveFailed} onRetry={onRetry} />
      ) : (
        pendingCount > 0 && (
          <p role="status" className="flex items-center gap-2 px-1 font-medium text-muted">
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            {t.matchingItems(pendingCount)}
          </p>
        )
      )}

      {unmatched.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-sm font-medium text-muted">{t.unmatchedHeading}</h2>
          <ul className="flex flex-col gap-2">
            {unmatched.map((item) => (
              <li key={item.id} className="rounded-2xl bg-next-soft px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-lg font-medium">{item.text}</span>
                  <button
                    type="button"
                    onClick={() => setAssigningId(assigningId === item.id ? null : item.id)}
                    aria-expanded={assigningId === item.id}
                    className="h-11 shrink-0 rounded-xl bg-surface px-3 text-sm font-semibold"
                  >
                    {t.pickDepartment}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(item.id)}
                    aria-label={t.removeItemShort(item.text)}
                    className="grid size-11 shrink-0 place-items-center rounded-xl text-muted"
                  >
                    <X aria-hidden className="size-5" />
                  </button>
                </div>
                {assigningId === item.id && map && (
                  <div className="mt-2">
                    <QuickCategoryChips
                      map={map}
                      onSelect={(category) => {
                        onAssign(item.id, category);
                        setAssigningId(null);
                      }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

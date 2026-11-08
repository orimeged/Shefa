import { ArrowLeftRight, Boxes, Package, Trash2 } from "lucide-react";
import { useState } from "react";

import type { Zone, ZoneItem } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";

interface ZoneInventoryListProps {
  items: readonly ZoneItem[];
  /** Every other zone, as places an item can move to. */
  otherZones: readonly Zone[];
  disabled: boolean;
  onMove: (item: ZoneItem, toNodeId: number) => void;
  onRemove: (item: ZoneItem) => void;
}

function itemKey(item: ZoneItem): string {
  return `${item.entity_type}-${item.entity_id}`;
}

export function ZoneInventoryList({
  items,
  otherZones,
  disabled,
  onMove,
  onRemove,
}: ZoneInventoryListProps) {
  const { t } = useLanguage();
  const [moving, setMoving] = useState<string | null>(null);

  if (items.length === 0) {
    return <p className="rounded-2xl bg-surface px-4 py-3 text-muted ring-1 ring-line">{t.zoneIsEmpty}</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => {
        const key = itemKey(item);
        const isCategory = item.entity_type === "category";
        const Icon = isCategory ? Boxes : Package;

        return (
          <li key={key} className="rounded-2xl bg-surface px-3 py-2 ring-1 ring-line">
            <div className="flex items-center gap-2">
              <Icon aria-hidden className="size-5 shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.name}</p>
                <p className="truncate text-sm text-muted">
                  {isCategory
                    ? t.wholeCategory(item.product_count ?? 0)
                    : (item.subcategory ?? item.category_name)}
                  {item.barcode && (
                    <>
                      {" · "}
                      <span dir="ltr" className="tabular-nums">
                        {item.barcode}
                      </span>
                    </>
                  )}
                </p>
              </div>
              <button
                type="button"
                aria-label={t.moveItem(item.name)}
                aria-expanded={moving === key}
                disabled={disabled}
                onClick={() => setMoving((current) => (current === key ? null : key))}
                className="grid size-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-brand-soft disabled:opacity-40"
              >
                <ArrowLeftRight aria-hidden className="size-5" />
              </button>
              <button
                type="button"
                aria-label={t.deleteFromZone(item.name)}
                disabled={disabled}
                onClick={() => {
                  if (window.confirm(t.deleteConfirm(item.name))) {
                    onRemove(item);
                  }
                }}
                className="grid size-11 shrink-0 place-items-center rounded-xl text-danger hover:bg-danger-soft disabled:opacity-40"
              >
                <Trash2 aria-hidden className="size-5" />
              </button>
            </div>

            {moving === key && (
              <label className="mt-2 flex flex-col gap-1 text-sm font-medium text-muted">
                {t.moveTo}
                <select
                  defaultValue=""
                  disabled={disabled}
                  onChange={(event) => {
                    setMoving(null);
                    onMove(item, Number(event.target.value));
                  }}
                  className="h-11 rounded-xl bg-paper px-3 text-base text-ink ring-1 ring-line"
                >
                  <option value="" disabled>
                    {t.moveTo}…
                  </option>
                  {otherZones.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.zone_name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </li>
        );
      })}
    </ul>
  );
}

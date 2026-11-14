import { Trash2, X } from "lucide-react";

import { usePlace } from "../../hooks/usePlace";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { ListItem } from "../../lib/list/shoppingItems";
import { estimateBasket, priceOfItem } from "../../lib/list/shoppingItems";
import { formatShekels } from "../../lib/money";
import { CategoryIcon } from "../CategoryIcon";

interface ListDraftProps {
  items: readonly ListItem[];
  /** Placed products' shelf prices, by stop. */
  prices: ReadonlyMap<string, number>;
  onRemove: (itemId: string) => void;
  onClear: () => void;
}

/** The list while it's being put together, priced where the store knows the price. Nothing here plans a route. */
export function ListDraft({ items, prices, onRemove, onClear }: ListDraftProps) {
  const { t, pick, language } = useLanguage();
  const where = usePlace();
  const placed = items.filter((item) => item.placement);
  const basket = estimateBasket(items, prices);

  return (
    <section aria-label={t.draftTitle(placed.length)}>
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="font-semibold">{t.draftTitle(placed.length)}</h2>
        <button
          type="button"
          onClick={onClear}
          className="-me-2 flex h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-muted"
        >
          <Trash2 aria-hidden className="size-4" />
          {t.clearList}
        </button>
      </div>

      <ul className="divide-y divide-line">
        {placed.map((item) => {
          const { id, text, placement } = item;
          const { categoryId, name, nameEn, aisleNo, side } = placement!;
          const shelf = pick(name, nameEn);
          const price = priceOfItem(item, prices);
          return (
            <li key={id} data-list-item={text} className="flex items-center gap-3 py-2 ps-1">
              <CategoryIcon categoryId={categoryId} className="size-6 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 leading-snug font-medium">{text}</span>
                <span className="block truncate text-sm text-muted">
                  {/* A catalog item's stop carries its own name, already on the line above. */}
                  {shelf === text ? "" : `${shelf} · `}
                  {where(categoryId, aisleNo, side)}
                </span>
              </span>
              {price !== null && (
                <span data-price className="shrink-0 font-semibold text-ink tabular-nums">
                  {formatShekels(price, language)}
                </span>
              )}
              <button
                type="button"
                onClick={() => onRemove(id)}
                aria-label={t.removeItem(text)}
                className="-me-2 grid size-11 shrink-0 place-items-center rounded-xl text-muted"
              >
                <X aria-hidden className="size-5" />
              </button>
            </li>
          );
        })}
      </ul>

      {basket.priced > 0 && (
        // Like the bottom of a receipt: what the shopper can expect to pay.
        <div data-basket className="mt-1 flex items-center justify-between gap-3 rounded-2xl bg-brand-soft px-4 py-3">
          <span className="min-w-0">
            <span className="block font-semibold text-brand-strong">{t.basketLabel}</span>
            {basket.priced < basket.items && (
              <span className="block text-sm text-muted">{t.basketPartial(basket.priced, basket.items)}</span>
            )}
          </span>
          <span data-basket-total className="shrink-0 text-xl font-bold text-brand-strong tabular-nums">
            {formatShekels(basket.agorot, language)}
          </span>
        </div>
      )}
    </section>
  );
}

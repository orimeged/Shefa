import { Check, SearchX, X } from "lucide-react";

import type { RouteStop } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { ListGroup } from "../../lib/list/shoppingItems";
import { CategoryIcon } from "../CategoryIcon";

interface ShoppingListProps {
  pending: readonly RouteStop[];
  foundIds: readonly string[];
  groups: ReadonlyMap<string, ListGroup>;
  onToggle: (categoryId: string) => void;
  onRemove: (categoryId: string) => void;
  onNotFound: (stop: RouteStop) => void;
  onFoundAfterAll: (itemId: string) => void;
}

export function ShoppingList({
  pending,
  foundIds,
  groups,
  onToggle,
  onRemove,
  onNotFound,
  onFoundAfterAll,
}: ShoppingListProps) {
  const { t } = useLanguage();
  const foundGroups = foundIds.flatMap((id) => {
    const group = groups.get(id);
    return group && group.items.length > 0 ? [group] : [];
  });
  const missing = [...groups.values()].flatMap((group) =>
    group.missing.map((item) => ({ item, group })),
  );

  return (
    <div className="flex flex-col gap-5">
      {pending.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-sm font-medium text-muted">{t.toFindHeading}</h2>
          <ol className="flex flex-col gap-2">
            {pending.map((stop, index) => {
              const group = groups.get(stop.category_id);
              return (
                group && (
                  <ListRow
                    key={stop.category_id}
                    group={group}
                    order={index + 1}
                    checked={false}
                    onToggle={onToggle}
                    onRemove={onRemove}
                    onNotFound={() => onNotFound(stop)}
                  />
                )
              );
            })}
          </ol>
        </section>
      )}

      {missing.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-sm font-medium text-muted">{t.missingHeading}</h2>
          <ul className="flex flex-col gap-2">
            {missing.map(({ item, group }) => (
              <li
                key={item.id}
                className="flex min-h-16 items-center gap-3 rounded-2xl bg-danger-soft px-3 py-2"
              >
                <SearchX aria-hidden className="size-5 shrink-0 text-danger" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-medium">{item.text}</span>
                  <span className="block truncate text-sm text-muted">
                    {t.aisle(group.aisleNo, group.side)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onFoundAfterAll(item.id)}
                  className="h-11 shrink-0 rounded-xl bg-surface px-3 text-sm font-semibold text-brand-strong ring-1 ring-line"
                >
                  {t.foundAfterAll}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {foundGroups.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-sm font-medium text-muted">{t.foundHeading}</h2>
          <ul className="flex flex-col gap-2">
            {foundGroups.map((group) => (
              <ListRow
                key={group.categoryId}
                group={group}
                checked
                onToggle={onToggle}
                onRemove={onRemove}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

interface ListRowProps {
  group: ListGroup;
  order?: number;
  checked: boolean;
  onToggle: (categoryId: string) => void;
  onRemove: (categoryId: string) => void;
  onNotFound?: () => void;
}

function ListRow({ group, order, checked, onToggle, onRemove, onNotFound }: ListRowProps) {
  const { t, pick } = useLanguage();
  const name = pick(group.name, group.nameEn);

  return (
    <li
      className={`flex items-stretch rounded-2xl ring-1 ring-line transition-colors ${
        checked ? "bg-transparent" : "bg-surface"
      }`}
    >
      <label className="flex min-h-18 min-w-0 flex-1 items-center gap-3 py-2 ps-3">
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-full ${
            checked ? "text-muted" : "bg-brand-soft text-brand-strong"
          }`}
        >
          {order === undefined ? (
            <CategoryIcon categoryId={group.categoryId} className="size-5" />
          ) : (
            <span className="font-semibold">{order}</span>
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span
            className={`line-clamp-2 text-lg leading-snug font-medium ${
              checked ? "text-muted line-through" : ""
            }`}
          >
            {name}
          </span>
          <span className="block truncate text-sm text-muted">
            {t.aisle(group.aisleNo, group.side)}
          </span>
          {group.itemTexts.length > 0 && (
            <span className="block truncate text-sm font-medium text-brand-strong">
              {group.itemTexts.join(" · ")}
            </span>
          )}
        </span>

        <span className="flex w-13 shrink-0 flex-col items-center gap-1 text-xs font-medium text-muted">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggle(group.categoryId)}
            aria-label={`${t.foundIt}: ${name}`}
            className="peer sr-only"
          />
          <span className="grid size-8 place-items-center rounded-lg bg-surface ring-2 ring-shelf transition-colors peer-checked:bg-line peer-checked:ring-line peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand">
            {checked && <Check aria-hidden className="size-5 text-muted" strokeWidth={3} />}
          </span>
          {t.foundIt}
        </span>
      </label>

      {onNotFound && (
        <button
          type="button"
          onClick={onNotFound}
          aria-label={t.notFoundItem(name)}
          className="flex w-13 shrink-0 flex-col items-center justify-center gap-1 text-xs font-medium text-muted"
        >
          <SearchX aria-hidden className="size-5" />
          {t.notFoundShort}
        </button>
      )}

      <button
        type="button"
        onClick={() => onRemove(group.categoryId)}
        aria-label={t.removeItemShort(name)}
        className="grid w-11 shrink-0 place-items-center text-muted"
      >
        <X aria-hidden className="size-4" />
      </button>
    </li>
  );
}

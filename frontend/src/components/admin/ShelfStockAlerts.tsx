import { Eye, LoaderCircle, MapPin, PackageCheck, TriangleAlert } from "lucide-react";
import { Fragment } from "react";

import type { NotFoundReportRow } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import {
  countAlerts,
  formatReportTime,
  needsAttention,
  reportRowKey,
} from "../../lib/admin/stockAlerts";
import { formatShekels } from "../../lib/admin/money";
import { Notice } from "../Notice";

export interface AlertOutcome {
  ok: boolean;
  text: string;
}

interface ShelfStockAlertsProps {
  rows: readonly NotFoundReportRow[] | null;
  failed: boolean;
  resolvingKey: string | null;
  outcome: AlertOutcome | null;
  onRetry: () => void;
  onRestocked: (row: NotFoundReportRow) => void;
  /** The item was on its shelf all along: closed as misplaced, not as an empty shelf. */
  onOnShelf: (row: NotFoundReportRow) => void;
  onUpdateLocation: (row: NotFoundReportRow) => void;
}

export function ShelfStockAlerts({
  rows,
  failed,
  resolvingKey,
  outcome,
  onRetry,
  onRestocked,
  onOnShelf,
  onUpdateLocation,
}: ShelfStockAlertsProps) {
  const { t, pick, language } = useLanguage();
  const alerts = rows ? countAlerts(rows) : 0;

  return (
    <section aria-labelledby="alerts-title" className="flex flex-col gap-3">
      <div>
        <h2 id="alerts-title" className="text-xl font-semibold">
          {t.adminTabAlerts}
        </h2>
        <p className="text-sm text-muted">{t.alertsHint}</p>
        {alerts > 0 && <p className="font-medium text-danger">{t.alertsSummary(alerts)}</p>}
      </div>

      {failed && <Notice message={t.loadFailed} onRetry={onRetry} />}
      {outcome &&
        (outcome.ok ? (
          <p role="status" className="rounded-2xl bg-brand-soft px-4 py-3 font-medium text-brand-strong">
            {outcome.text}
          </p>
        ) : (
          <Notice message={outcome.text} />
        ))}
      {rows === null && !failed && <div className="h-64 animate-pulse rounded-3xl bg-line/60" />}
      {rows?.length === 0 && (
        <p className="rounded-3xl bg-surface px-4 py-6 text-center text-muted ring-1 ring-line">
          {t.alertsEmpty}
        </p>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-hidden rounded-3xl bg-surface ring-1 ring-line">
          <table className="w-full border-collapse text-start">
            <caption className="sr-only">{t.adminTabAlerts}</caption>
            <thead>
              <tr className="border-b border-line text-sm text-muted">
                <th scope="col" className="px-4 py-3 text-start font-medium">
                  {t.alertItem}
                </th>
                <th scope="col" className="hidden px-4 py-3 text-start font-medium sm:table-cell">
                  {t.alertCategory}
                </th>
                <th scope="col" className="px-2 py-3 text-center font-medium sm:px-4">
                  {t.alertTimes}
                </th>
                <th scope="col" className="hidden px-4 py-3 text-end font-medium md:table-cell">
                  {t.alertValue}
                </th>
                <th scope="col" className="px-4 py-3 text-start font-medium">
                  {t.alertLastReported}
                </th>
                <th scope="col" className="hidden px-4 py-3 text-start font-medium lg:table-cell">
                  {t.alertActions}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const key = reportRowKey(row);
                const isAlert = needsAttention(row);
                const background = isAlert ? "bg-danger-soft" : "";
                const category = row.category_name
                  ? pick(row.category_name, row.category_name_en ?? row.category_name)
                  : t.alertNoCategory;
                const actions = (
                  <RowActions
                    row={row}
                    isResolving={resolvingKey === key}
                    onRestocked={onRestocked}
                    onOnShelf={onOnShelf}
                    onUpdateLocation={onUpdateLocation}
                  />
                );
                const estimated = row.price_basis !== null && row.price_basis !== "product";

                return (
                  <Fragment key={key}>
                    <tr
                      data-row
                      data-alert={isAlert || undefined}
                      className={`border-line lg:border-b ${background}`}
                    >
                      <td className="px-4 pt-3 pb-1 lg:py-3">
                        <span className="block font-medium">{row.item_query}</span>
                        <span className="block text-sm text-muted sm:hidden">{category}</span>
                      </td>
                      <td className="hidden px-4 pt-3 pb-1 text-muted sm:table-cell lg:py-3">
                        {category}
                      </td>
                      <td className="px-2 pt-3 pb-1 text-center sm:px-4 lg:py-3">
                        {isAlert ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-danger px-3 py-1 font-semibold text-white">
                            <TriangleAlert aria-hidden className="size-4" />
                            {row.times_reported}
                            <span className="sr-only">{t.alertNeedsAction}</span>
                          </span>
                        ) : (
                          <span className="inline-flex min-w-8 justify-center rounded-full bg-next-soft px-3 py-1 font-semibold text-ink ring-1 ring-next/40">
                            {row.times_reported}
                          </span>
                        )}
                      </td>
                      <td
                        data-value
                        title={row.price_basis ? t.lostSalesBasis[row.price_basis] : t.lostSalesNoPrice}
                        className="hidden px-4 pt-3 pb-1 text-end font-semibold whitespace-nowrap tabular-nums md:table-cell lg:py-3"
                      >
                        {row.unit_price_agorot === null ? (
                          <span className="font-normal text-muted">—</span>
                        ) : (
                          <>
                            {estimated && <span aria-hidden>≈ </span>}
                            {formatShekels(row.value_agorot, language)}
                          </>
                        )}
                      </td>
                      <td className="px-4 pt-3 pb-1 text-sm whitespace-nowrap text-muted lg:py-3">
                        {formatReportTime(row.last_reported_at, language)}
                      </td>
                      <td className="hidden px-4 py-3 lg:table-cell">{actions}</td>
                    </tr>
                    {/* Too wide for a column on a phone, so it takes a line of its own. */}
                    <tr className={`border-b border-line last:border-b-0 lg:hidden ${background}`}>
                      <td colSpan={6} className="px-4 pb-3">
                        {actions}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface RowActionsProps {
  row: NotFoundReportRow;
  isResolving: boolean;
  onRestocked: (row: NotFoundReportRow) => void;
  onOnShelf: (row: NotFoundReportRow) => void;
  onUpdateLocation: (row: NotFoundReportRow) => void;
}

function RowActions({ row, isResolving, onRestocked, onOnShelf, onUpdateLocation }: RowActionsProps) {
  const { t } = useLanguage();

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={isResolving}
        aria-label={`${t.alertRestocked}: ${row.item_query}`}
        onClick={() => onRestocked(row)}
        className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand px-3 text-sm font-semibold whitespace-nowrap text-white disabled:opacity-60 lg:flex-none"
      >
        {isResolving ? (
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
        ) : (
          <PackageCheck aria-hidden className="size-4" />
        )}
        {t.alertRestocked}
      </button>
      <button
        type="button"
        disabled={isResolving}
        aria-label={`${t.alertUpdateLocation}: ${row.item_query}`}
        onClick={() => onUpdateLocation(row)}
        className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-surface px-3 text-sm font-semibold whitespace-nowrap text-ink ring-1 ring-line hover:bg-brand-soft disabled:opacity-60 lg:flex-none"
      >
        <MapPin aria-hidden className="size-4" />
        {t.alertUpdateLocation}
      </button>
      <button
        type="button"
        disabled={isResolving}
        aria-label={`${t.alertOnShelf}: ${row.item_query}`}
        onClick={() => onOnShelf(row)}
        className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-surface px-3 text-sm font-semibold whitespace-nowrap text-ink ring-1 ring-line hover:bg-brand-soft disabled:opacity-60 lg:flex-none"
      >
        <Eye aria-hidden className="size-4" />
        {t.alertOnShelf}
      </button>
    </div>
  );
}

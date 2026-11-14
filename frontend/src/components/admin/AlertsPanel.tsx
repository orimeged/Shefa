import type { NotFoundReportRow } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import { countAlerts, reportRowKey } from "../../lib/admin/stockAlerts";
import { Notice } from "../Notice";
import { StaffAlertCard } from "../staff/StaffAlertCard";

interface AlertsPanelProps {
  rows: readonly NotFoundReportRow[] | null;
  failed: boolean;
  resolvingKey: string | null;
  onRetry: () => void;
  onRestocked: (row: NotFoundReportRow) => void;
  /** The item was on its shelf all along: closed as misplaced, not as an empty shelf. */
  onOnShelf: (row: NotFoundReportRow) => void;
  /** It stands on another shelf: pick that shelf on the map. */
  onElsewhere: (row: NotFoundReportRow) => void;
}

/** The open alerts as the shift manager's phone shows them, side by side on a wider screen. */
export function AlertsPanel({
  rows,
  failed,
  resolvingKey,
  onRetry,
  onRestocked,
  onOnShelf,
  onElsewhere,
}: AlertsPanelProps) {
  const { t } = useLanguage();
  const urgent = rows ? countAlerts(rows) : 0;

  return (
    <section aria-labelledby="alerts-title" className="flex flex-col gap-4">
      <div>
        <h2 id="alerts-title" className="text-2xl font-semibold" aria-live="polite">
          {rows ? (rows.length ? t.staffOpenAlerts(rows.length) : t.staffEmpty) : t.adminNav.alerts}
        </h2>
        <p className="text-muted">{t.alertsHint}</p>
        {urgent > 0 && <p className="font-semibold text-danger">{t.alertsSummary(urgent)}</p>}
      </div>

      {failed && <Notice message={t.loadFailed} onRetry={onRetry} />}
      {rows === null && !failed && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((slot) => (
            <div key={slot} className="h-56 animate-pulse rounded-3xl bg-line/60" />
          ))}
        </div>
      )}
      {rows?.length === 0 && (
        <p className="rounded-3xl bg-surface px-4 py-10 text-center text-muted ring-1 ring-line">{t.staffEmptyHint}</p>
      )}
      {rows && rows.length > 0 && (
        <ul className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <StaffAlertCard
              key={reportRowKey(row)}
              row={row}
              isResolving={resolvingKey === reportRowKey(row)}
              onRestocked={onRestocked}
              onOnShelf={onOnShelf}
              onElsewhere={onElsewhere}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

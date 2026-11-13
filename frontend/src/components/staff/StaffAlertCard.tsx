import { Eye, LoaderCircle, MapPin, MapPinned, PackageCheck, TriangleAlert } from "lucide-react";

import type { NotFoundReportRow } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import { formatShekels } from "../../lib/admin/money";
import { needsAttention } from "../../lib/admin/stockAlerts";
import { formatAgo } from "../../lib/staff/time";

interface StaffAlertCardProps {
  row: NotFoundReportRow;
  isResolving: boolean;
  onRestocked: (row: NotFoundReportRow) => void;
  onOnShelf: (row: NotFoundReportRow) => void;
  /** It stood somewhere else: scan it where it is. Absent where placing isn't offered. */
  onElsewhere?: (row: NotFoundReportRow) => void;
}

/** One alert on a shift manager's phone: what, where, how urgent, and one tap to close it. */
export function StaffAlertCard({ row, isResolving, onRestocked, onOnShelf, onElsewhere }: StaffAlertCardProps) {
  const { t, pick, language } = useLanguage();
  const urgent = needsAttention(row);
  const department = row.category_name ? pick(row.category_name, row.category_name_en ?? row.category_name) : null;
  const where = row.shelf ? t.staffShelf(row.shelf) : department;

  return (
    <li
      data-staff-alert={row.item_query}
      data-urgent={urgent || undefined}
      className={`flex flex-col gap-3 rounded-3xl bg-surface p-4 shadow-sm ring-1 ${urgent ? "ring-2 ring-danger" : "ring-line"}`}
    >
      <div className="flex items-center gap-2 text-sm">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold ${
            urgent ? "bg-danger text-white" : "bg-next-soft text-ink ring-1 ring-next/40"
          }`}
        >
          {urgent && <TriangleAlert aria-hidden className="size-3.5" />}
          {t.lostSalesReportCount(row.times_reported)}
        </span>
        <span className="text-muted">{formatAgo(row.last_reported_at, t)}</span>
        {row.unit_price_agorot !== null && (
          <span className="ms-auto font-semibold text-ink tabular-nums">
            {t.staffAtRisk(formatShekels(row.value_agorot, language))}
          </span>
        )}
      </div>

      <div>
        <p className="text-lg leading-snug font-semibold">{row.item_query}</p>
        {where && (
          <p className="mt-0.5 flex items-center gap-1 text-muted">
            <MapPin aria-hidden className="size-4 shrink-0" />
            {where}
            {row.shelf && department && <span className="text-sm"> · {department}</span>}
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={isResolving}
        aria-label={`${t.alertRestocked}: ${row.item_query}`}
        onClick={() => onRestocked(row)}
        className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-brand text-lg font-semibold text-white shadow-sm disabled:opacity-60"
      >
        {isResolving ? <LoaderCircle aria-hidden className="size-5 animate-spin" /> : <PackageCheck aria-hidden className="size-5" />}
        {t.alertRestocked}
      </button>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isResolving}
          aria-label={`${t.alertOnShelf}: ${row.item_query}`}
          onClick={() => onOnShelf(row)}
          className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-surface font-medium text-ink ring-1 ring-line disabled:opacity-60"
        >
          <Eye aria-hidden className="size-4" />
          {t.alertOnShelf}
        </button>
        {onElsewhere && (
          <button
            type="button"
            disabled={isResolving}
            aria-label={`${t.staffElsewhere}: ${row.item_query}`}
            onClick={() => onElsewhere(row)}
            className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-surface font-medium text-ink ring-1 ring-line disabled:opacity-60"
          >
            <MapPinned aria-hidden className="size-4" />
            {t.staffElsewhere}
          </button>
        )}
      </div>
    </li>
  );
}

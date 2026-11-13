import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import type { DashboardCounts, LostSalesReport } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { Trend } from "../../lib/admin/analytics";
import { trendOf } from "../../lib/admin/analytics";
import { formatShekels } from "../../lib/admin/money";
import { Notice } from "../Notice";

interface KpiRowProps {
  counts: DashboardCounts | null;
  lostSales: LostSalesReport | null;
  failed: boolean;
  onRetry: () => void;
  onOpenAlerts: () => void;
}

const TONE_CLASSES = {
  good: "text-[#006300]",
  bad: "text-danger",
  neutral: "text-slate-500",
} as const;

const CARD =
  "rounded-2xl bg-white p-5 text-start shadow-sm ring-1 ring-slate-200 transition duration-200 hover:-translate-y-0.5 hover:shadow-md";

/**
 * The money first: what went missing this week at shelf prices, and how fast the
 * shelves came back. Then the alerts still open, and how many shoppers used it.
 */
export function KpiRow({ counts, lostSales, failed, onRetry, onOpenAlerts }: KpiRowProps) {
  const { t, language } = useLanguage();

  if (!counts || !lostSales) {
    return failed ? (
      <Notice message={t.loadFailed} onRetry={onRetry} />
    ) : (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((slot) => (
          <div key={slot} className="h-36 animate-pulse rounded-2xl bg-slate-200/70" />
        ))}
      </div>
    );
  }

  const restock = lostSales.restock_median_minutes;
  const previousRestock = lostSales.previous_restock_median_minutes;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        id="lost-value"
        label={t.kpiLostValue}
        value={formatShekels(lostSales.value_agorot, language, true)}
        trend={trendOf({ current: lostSales.value_agorot, previous: lostSales.previous_value_agorot }, false)}
        comparison={t.kpiVsPreviousWeek}
        detail={t.kpiLostValueDetail(lostSales.reports)}
      />
      <KpiCard
        id="restock-time"
        label={t.kpiRestockTime}
        value={restock === null ? "—" : t.durationMinutes(restock)}
        trend={restock !== null && previousRestock !== null ? trendOf({ current: restock, previous: previousRestock }, false) : null}
        comparison={t.kpiVsPreviousWeek}
        detail={restock === null ? t.kpiRestockNone : t.kpiRestockDetail(lostSales.restocked_alerts)}
      />
      <KpiCard
        id="open-alerts"
        label={t.kpiMissingAlerts}
        value={counts.missing_alerts.current.toLocaleString()}
        trend={trendOf(counts.missing_alerts, false)}
        comparison={t.kpiVsLastWeek}
        detail={
          lostSales.open_value_agorot > 0
            ? t.kpiOpenValue(formatShekels(lostSales.open_value_agorot, language, true))
            : undefined
        }
        onClick={onOpenAlerts}
      />
      <KpiCard
        id="routes-today"
        label={t.kpiRoutesToday}
        value={counts.routes_today.current.toLocaleString()}
        trend={trendOf(counts.routes_today, true)}
        comparison={t.kpiVsSameHours}
      />
    </div>
  );
}

interface KpiCardProps {
  id: string;
  label: string;
  value: string;
  /** Null when there is nothing to compare with. */
  trend: Trend | null;
  comparison: string;
  detail?: string;
  onClick?: () => void;
}

function KpiCard({ id, label, value, trend, comparison, detail, onClick }: KpiCardProps) {
  const body = (
    <>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p data-kpi-value className="mt-1 text-4xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {value}
      </p>
      {trend && <TrendLine trend={trend} comparison={comparison} />}
      {detail && <p className="mt-1 text-sm text-slate-500">{detail}</p>}
    </>
  );

  return onClick ? (
    <button type="button" data-kpi={id} onClick={onClick} className={`${CARD} block w-full`}>
      {body}
    </button>
  ) : (
    <div data-kpi={id} className={CARD}>
      {body}
    </div>
  );
}

function TrendLine({ trend, comparison }: { trend: Trend; comparison: string }) {
  const { t } = useLanguage();
  const Arrow =
    trend.direction === "up" ? ArrowUp : trend.direction === "down" ? ArrowDown : Minus;
  const change =
    trend.direction === "flat"
      ? t.kpiFlat
      : trend.percent === null
        ? t.kpiNew
        : `${trend.direction === "up" ? "+" : "-"}${trend.percent}%`;

  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-sm">
      <span className={`inline-flex items-center gap-0.5 font-semibold ${TONE_CLASSES[trend.tone]}`}>
        <Arrow aria-hidden className="size-4" />
        <span dir="ltr">{change}</span>
      </span>
      <span className="text-slate-500">{comparison}</span>
    </p>
  );
}

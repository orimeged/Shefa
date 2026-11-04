import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import type { CountPair, DashboardCounts } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { Trend } from "../../lib/admin/analytics";
import { trendOf } from "../../lib/admin/analytics";
import { Notice } from "../Notice";

interface KpiRowProps {
  counts: DashboardCounts | null;
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

export function KpiRow({ counts, failed, onRetry, onOpenAlerts }: KpiRowProps) {
  const { t } = useLanguage();

  if (!counts) {
    return failed ? (
      <Notice message={t.loadFailed} onRetry={onRetry} />
    ) : (
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((slot) => (
          <div key={slot} className="h-32 animate-pulse rounded-2xl bg-slate-200/70" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <KpiCard
        label={t.kpiRoutesToday}
        pair={counts.routes_today}
        upIsGood
        comparison={t.kpiVsSameHours}
      />
      <KpiCard
        label={t.kpiMissingAlerts}
        pair={counts.missing_alerts}
        upIsGood={false}
        comparison={t.kpiVsLastWeek}
        onClick={onOpenAlerts}
      />
      <KpiCard
        label={t.kpiUnfulfilled}
        pair={counts.unfulfilled_searches}
        upIsGood={false}
        comparison={t.kpiVsPreviousWeek}
      />
    </div>
  );
}

interface KpiCardProps {
  label: string;
  pair: CountPair;
  upIsGood: boolean;
  comparison: string;
  onClick?: () => void;
}

function KpiCard({ label, pair, upIsGood, comparison, onClick }: KpiCardProps) {
  const body = (
    <>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-4xl font-semibold tracking-tight text-slate-900">
        {pair.current.toLocaleString()}
      </p>
      <TrendLine trend={trendOf(pair, upIsGood)} comparison={comparison} />
    </>
  );

  return onClick ? (
    <button type="button" onClick={onClick} className={`${CARD} block w-full`}>
      {body}
    </button>
  ) : (
    <div className={CARD}>{body}</div>
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

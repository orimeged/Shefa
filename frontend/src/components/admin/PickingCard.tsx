import { ClipboardList } from "lucide-react";

import type { PickingReport } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";

/** Orders picked with the sorted list this week: shown once there are any. */
export function PickingCard({ report }: { report: PickingReport | null }) {
  const { t } = useLanguage();
  if (!report || (report.current.orders === 0 && report.previous.orders === 0)) {
    return null;
  }
  const { current, previous } = report;
  return (
    <section aria-labelledby="picking-title" data-panel="picking" className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center gap-2">
        <ClipboardList aria-hidden className="size-5 text-slate-500" />
        <h2 id="picking-title" className="text-lg font-semibold text-slate-900">
          {t.pickingTitle}
        </h2>
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <Figure label={t.pickingMedian} value={current.median_minutes === null ? "—" : t.durationMinutes(current.median_minutes)} />
        <Figure label={t.pickingOrders} value={String(current.orders)} />
        <Figure label={t.pickingMissing} value={String(current.missing)} />
      </div>
      <p className="text-sm text-slate-500">
        {previous.median_minutes === null ? t.pickingNoBaseline : t.pickingVsBefore(t.durationMinutes(previous.median_minutes))}
      </p>
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <p data-picking-value className="text-2xl font-semibold text-slate-900 tabular-nums">
        {value}
      </p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

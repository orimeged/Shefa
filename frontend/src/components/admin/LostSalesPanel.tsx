import { ArrowDown, ArrowUp, MapPinOff, Minus, PackageX, SearchX } from "lucide-react";
import type { ReactNode } from "react";

import type { LostSalesItem, LostSalesReport } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import { trendOf } from "../../lib/admin/analytics";
import { formatShekels } from "../../lib/admin/money";
import { Notice } from "../Notice";

interface LostSalesPanelProps {
  report: LostSalesReport | null;
  failed: boolean;
  onRetry: () => void;
}

// One series, one colour: the same blue as the dashboard's other ranked bars.
const BAR_COLOR = "#2a78d6";
const TOP_ROWS = 6;

const STATE_CLASSES: Record<LostSalesItem["state"], string> = {
  open: "bg-danger-soft text-danger",
  restocked: "bg-brand-soft text-brand-strong",
  misplaced: "bg-amber-50 text-amber-800",
};

/**
 * What went missing this week, in shekels, by what the manager found: an empty
 * shelf, an item that was there and not found, or one the store doesn't carry.
 */
export function LostSalesPanel({ report, failed, onRetry }: LostSalesPanelProps) {
  const { t, language } = useLanguage();
  const money = (agorot: number) => formatShekels(agorot, language, true);

  return (
    <section
      aria-labelledby="lost-sales-title"
      data-panel="lost-sales"
      className="flex flex-col gap-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
    >
      <div>
        <h2 id="lost-sales-title" className="text-lg font-semibold text-slate-900">
          {t.lostSalesTitle}
        </h2>
        <p className="text-sm text-slate-500">{t.lostSalesHint}</p>
      </div>

      {failed && <Notice message={t.loadFailed} onRetry={onRetry} />}
      {!report && !failed && <div className="h-96 animate-pulse rounded-xl bg-slate-100" />}

      {report && (
        <>
          <div>
            <p data-lost-total className="text-5xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {money(report.value_agorot)}
            </p>
            <Trend current={report.value_agorot} previous={report.previous_value_agorot} />
            <p className="mt-1 text-sm text-slate-500">
              {report.reports === 0 ? t.lostSalesEmpty : t.lostSalesReports(report.reports, report.exact_reports)}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <BucketTile
              kind="empty-shelf"
              icon={<PackageX aria-hidden className="size-5" />}
              label={t.lostSalesEmptyShelf}
              value={money(report.empty_shelf.value_agorot)}
              detail={t.lostSalesReportCount(report.empty_shelf.reports)}
              hint={t.lostSalesEmptyShelfHint(report.open_alerts, money(report.open_value_agorot))}
            />
            <BucketTile
              kind="misplaced"
              icon={<MapPinOff aria-hidden className="size-5" />}
              label={t.lostSalesMisplaced}
              value={money(report.misplaced.value_agorot)}
              detail={t.lostSalesReportCount(report.misplaced.reports)}
              hint={t.lostSalesMisplacedHint}
            />
            <BucketTile
              kind="not-carried"
              icon={<SearchX aria-hidden className="size-5" />}
              label={t.lostSalesNotCarried}
              value={t.lostSalesSearchCount(report.not_carried.searches)}
              detail={report.not_carried.items
                .slice(0, 2)
                .map((item) => item.item)
                .join(" · ")}
              hint={t.lostSalesNotCarriedHint}
            />
          </div>

          {report.items.length > 0 && <TopItems items={report.items.slice(0, TOP_ROWS)} />}

          <p className="text-xs leading-relaxed text-slate-500">{t.lostSalesFootnote}</p>
        </>
      )}
    </section>
  );
}

function Trend({ current, previous }: { current: number; previous: number }) {
  const { t } = useLanguage();
  const trend = trendOf({ current, previous }, false);
  const Arrow = trend.direction === "up" ? ArrowUp : trend.direction === "down" ? ArrowDown : Minus;
  const tone = trend.tone === "good" ? "text-[#006300]" : trend.tone === "bad" ? "text-danger" : "text-slate-500";
  const change =
    trend.direction === "flat"
      ? t.kpiFlat
      : trend.percent === null
        ? t.kpiNew
        : `${trend.direction === "up" ? "+" : "-"}${trend.percent}%`;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm">
      <span className={`inline-flex items-center gap-0.5 font-semibold ${tone}`}>
        <Arrow aria-hidden className="size-4" />
        <span dir="ltr">{change}</span>
      </span>
      <span className="text-slate-500">{t.kpiVsPreviousWeek}</span>
    </p>
  );
}

interface BucketTileProps {
  kind: string;
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  hint: string;
}

function BucketTile({ kind, icon, label, value, detail, hint }: BucketTileProps) {
  return (
    <div data-bucket={kind} className="flex flex-col gap-1 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <p className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        <span className="text-slate-500">{icon}</span>
        {label}
      </p>
      <p data-bucket-value className="text-2xl font-semibold text-slate-900 tabular-nums">
        {value}
      </p>
      {detail && <p className="truncate text-sm text-slate-600">{detail}</p>}
      <p className="text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function TopItems({ items }: { items: readonly LostSalesItem[] }) {
  const { t, pick, language } = useLanguage();
  const biggest = Math.max(1, ...items.map((item) => item.value_agorot));

  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-slate-500">{t.lostSalesTopItems}</h3>
      <ol className="flex flex-col gap-3">
        {items.map((item) => {
          const department = item.category_name
            ? pick(item.category_name, item.category_name_en ?? item.category_name)
            : null;
          const basis = item.price_basis ? t.lostSalesBasis[item.price_basis] : t.lostSalesNoPrice;
          const estimated = item.price_basis !== null && item.price_basis !== "product";
          return (
            <li key={`${item.category_id}|${item.item}`} data-lost-item className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{item.item}</span>
                <span
                  title={item.unit_price_agorot !== null ? `${basis}: ${formatShekels(item.unit_price_agorot, language)}` : basis}
                  className="shrink-0 font-semibold text-slate-900 tabular-nums"
                >
                  {estimated && <span aria-hidden>≈ </span>}
                  {item.unit_price_agorot === null ? "—" : formatShekels(item.value_agorot, language, true)}
                  <span className="sr-only"> · {basis}</span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                <span className={`rounded-full px-2 py-0.5 font-medium ${STATE_CLASSES[item.state]}`}>
                  {t.lostSalesState[item.state]}
                </span>
                {department && <span>{department}</span>}
                <span>{t.lostSalesReportCount(item.reports)}</span>
                {item.picker_reports > 0 && <span>{t.lostSalesPickers(item.picker_reports)}</span>}
              </div>
              <div aria-hidden className="h-1.5 rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(item.value_agorot / biggest) * 100}%`, backgroundColor: BAR_COLOR }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

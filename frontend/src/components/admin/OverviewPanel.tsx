import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bell,
  ClipboardList,
  Clock,
  MapPinOff,
  Minus,
  PackageX,
  Route,
  SearchX,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo } from "react";

import type {
  DashboardCounts,
  HeatPoint,
  LostDemandReport,
  LostSalesItem,
  LostSalesReport,
  PickingReport,
  StoreMap,
  Zone,
} from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { Trend } from "../../lib/admin/analytics";
import { trendOf } from "../../lib/admin/analytics";
import { formatShekels } from "../../lib/admin/money";
import type { FloorMap } from "../../lib/floorPlanMap";
import { buildMapLayout } from "../../lib/mapGeometry";
import { Notice } from "../Notice";
import { AdminMapEditor } from "./AdminMapEditor";
import { CARD, CARD_TITLE } from "./cards";
import { FloorAnalyticsMap } from "./FloorAnalyticsMap";
import { HeatLayer, HeatLegend } from "./MapOverlays";

interface Report<T> {
  data: T | null;
  failed: boolean;
  retry: () => void;
}

interface OverviewPanelProps {
  counts: Report<DashboardCounts>;
  lostSales: Report<LostSalesReport>;
  picking: Report<PickingReport>;
  lostDemand: Report<LostDemandReport>;
  heat: Report<{ points: HeatPoint[] }>;
  /** The drawn plan, for the heat; null without one. */
  floor: FloorMap | null;
  /** A store with no drawn plan yet shows its heat on the aisle map, whose shelves open as they do on the map tab. */
  map: StoreMap | null;
  zones: readonly Zone[] | null;
  selectedNodeId: number | null;
  onSelectZone: (nodeId: number) => void;
  /** Alerts open now, null while they load; and those reported three times or more. */
  openAlerts: number | null;
  urgentAlerts: number;
  onOpenAlerts: () => void;
  onOpenMap: () => void;
}

const TOP_ITEMS = 6;
const TOP_SEARCHES = 8;
const GOOD_TONE = "text-[#006300]";

/**
 * The week on one screen, money first: what stood on empty shelves, how fast they
 * came back, what's open now, where in the store it happened, and what shoppers
 * asked for that the store doesn't carry.
 */
export function OverviewPanel({
  counts,
  lostSales,
  picking,
  lostDemand,
  heat,
  floor,
  map,
  zones,
  selectedNodeId,
  onSelectZone,
  openAlerts,
  urgentAlerts,
  onOpenAlerts,
  onOpenMap,
}: OverviewPanelProps) {
  const { t } = useLanguage();
  const report = lostSales.data;
  const graph = useMemo(() => (map ? buildMapLayout(map) : null), [map]);
  const heatPoints = heat.data ? heat.data.points : null;
  const legend = <HeatLegend className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2" />;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <LostSalesHero
          report={report}
          failed={lostSales.failed}
          onRetry={lostSales.retry}
          onOpenAlerts={onOpenAlerts}
        />
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <StatTile
            id="open-alerts"
            icon={<Bell aria-hidden className="size-5" />}
            label={t.overviewUrgentTitle}
            value={openAlerts === null ? null : urgentAlerts.toLocaleString()}
            detail={openAlerts === null ? undefined : t.overviewUrgent(openAlerts)}
            isUrgent={urgentAlerts > 0}
            onClick={onOpenAlerts}
          />
          <StatTile
            id="restock-time"
            icon={<Clock aria-hidden className="size-5" />}
            label={t.kpiRestockTime}
            value={
              report
                ? report.restock_median_minutes === null
                  ? "—"
                  : t.durationMinutes(report.restock_median_minutes)
                : null
            }
            trend={
              report && report.restock_median_minutes !== null && report.previous_restock_median_minutes !== null
                ? trendOf(
                    { current: report.restock_median_minutes, previous: report.previous_restock_median_minutes },
                    false,
                  )
                : null
            }
            comparison={t.kpiVsPreviousWeek}
            detail={
              report
                ? report.restock_median_minutes === null
                  ? t.kpiRestockNone
                  : t.kpiRestockDetail(report.restocked_alerts)
                : undefined
            }
          />
          <StatTile
            id="routes-today"
            icon={<Route aria-hidden className="size-5" />}
            label={t.kpiRoutesToday}
            value={counts.data ? counts.data.routes_today.current.toLocaleString() : null}
            trend={counts.data ? trendOf(counts.data.routes_today, true) : null}
            comparison={t.kpiVsSameHours}
          />
        </div>
      </div>
      {counts.failed && <Notice message={t.loadFailed} onRetry={counts.retry} />}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {floor || (graph && zones) ? (
          <section aria-labelledby="heat-title" data-panel="heat" className={`${CARD} gap-3`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 id="heat-title" className={CARD_TITLE}>
                  {t.overviewHeatTitle}
                </h2>
                <p className="text-sm text-muted">{t.overviewHeatHint}</p>
              </div>
              <button
                type="button"
                onClick={onOpenMap}
                className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-paper px-4 text-sm font-semibold text-ink ring-1 ring-line hover:bg-brand-soft"
              >
                {t.overviewToMap}
                <ArrowLeft aria-hidden className="size-4 ltr:-scale-x-100" />
              </button>
            </div>
            {heat.failed && <Notice message={t.loadFailed} onRetry={heat.retry} />}
            {floor ? (
              <FloorAnalyticsMap floor={floor} heat={heatPoints} legend={legend} />
            ) : (
              graph &&
              zones && (
                <AdminMapEditor
                  layout={graph}
                  zones={zones}
                  selectedNodeId={selectedNodeId}
                  onSelectZone={onSelectZone}
                  overZones={heatPoints ? <HeatLayer points={heatPoints} layout={graph} /> : null}
                  legend={<HeatLegend className="absolute bottom-16 left-1/2 z-10 flex -translate-x-1/2" />}
                />
              )
            )}
          </section>
        ) : null}
        <TopItemsCard report={report} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <NotCarriedCard report={lostDemand.data} failed={lostDemand.failed} onRetry={lostDemand.retry} />
        <PickingSummaryCard report={picking.data} />
      </div>
    </div>
  );
}

function LostSalesHero({
  report,
  failed,
  onRetry,
  onOpenAlerts,
}: {
  report: LostSalesReport | null;
  failed: boolean;
  onRetry: () => void;
  onOpenAlerts: () => void;
}) {
  const { t, language } = useLanguage();
  const money = (agorot: number) => formatShekels(agorot, language, true);

  return (
    <section aria-labelledby="lost-sales-title" data-panel="lost-sales" className={`${CARD} gap-5`}>
      <h2 id="lost-sales-title" className="text-base font-semibold text-muted">
        {t.overviewLostTitle}
      </h2>
      {failed && <Notice message={t.loadFailed} onRetry={onRetry} />}
      {!report && !failed && <div className="h-64 animate-pulse rounded-2xl bg-line/60" />}
      {report && (
        <>
          <div className="-mt-3">
            <p
              data-lost-total
              data-kpi="lost-value"
              className="text-6xl font-semibold tracking-tight text-ink tabular-nums"
            >
              {money(report.value_agorot)}
            </p>
            <TrendLine
              trend={trendOf({ current: report.value_agorot, previous: report.previous_value_agorot }, false)}
              comparison={t.kpiVsPreviousWeek}
            />
            <p className="mt-1 text-sm text-muted">
              {report.reports === 0 ? t.lostSalesEmpty : t.lostSalesReports(report.reports, report.exact_reports)}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <BucketTile
              kind="empty-shelf"
              tone="bg-danger-soft ring-danger/20"
              icon={<PackageX aria-hidden className="size-5 text-danger" />}
              label={t.lostSalesEmptyShelf}
              value={money(report.empty_shelf.value_agorot)}
              detail={t.lostSalesReportCount(report.empty_shelf.reports)}
              hint={t.lostSalesEmptyShelfHint(report.open_alerts, money(report.open_value_agorot))}
            />
            <BucketTile
              kind="misplaced"
              tone="bg-next-soft ring-next/30"
              icon={<MapPinOff aria-hidden className="size-5 text-[#9a5b06]" />}
              label={t.lostSalesMisplaced}
              value={money(report.misplaced.value_agorot)}
              detail={t.lostSalesReportCount(report.misplaced.reports)}
              hint={t.lostSalesMisplacedHint}
            />
            <BucketTile
              kind="not-carried"
              tone="bg-paper ring-line"
              icon={<SearchX aria-hidden className="size-5 text-muted" />}
              label={t.lostSalesNotCarried}
              value={t.lostSalesSearchCount(report.not_carried.searches)}
              detail={report.not_carried.items
                .slice(0, 2)
                .map((item) => item.item)
                .join(" · ")}
              hint={t.lostSalesNotCarriedHint}
            />
          </div>
          {report.open_alerts > 0 && (
            <div data-open-now className="mt-auto flex items-center gap-3 rounded-2xl bg-slate-900 p-3 ps-4 text-white">
              <PackageX aria-hidden className="size-5 shrink-0 text-white/80" />
              <p className="min-w-0 flex-1 font-semibold">
                {t.overviewNow(report.open_alerts, money(report.open_value_agorot))}
              </p>
              <button
                type="button"
                onClick={onOpenAlerts}
                className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-ink"
              >
                {t.overviewHandle}
                <ArrowLeft aria-hidden className="size-4 ltr:-scale-x-100" />
              </button>
            </div>
          )}
          <p className={`${report.open_alerts > 0 ? "" : "mt-auto "}text-xs leading-relaxed text-muted`}>
            {t.lostSalesFootnote}
          </p>
        </>
      )}
    </section>
  );
}

interface BucketTileProps {
  kind: string;
  tone: string;
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  hint: string;
}

function BucketTile({ kind, tone, icon, label, value, detail, hint }: BucketTileProps) {
  return (
    <div data-bucket={kind} className={`flex flex-col gap-1 rounded-2xl p-4 ring-1 ${tone}`}>
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        {icon}
        {label}
      </p>
      <p data-bucket-value className="text-2xl font-semibold text-ink tabular-nums">
        {value}
      </p>
      {detail && <p className="truncate text-sm text-ink/80">{detail}</p>}
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
}

interface StatTileProps {
  id: string;
  icon: ReactNode;
  label: string;
  /** Null while loading. */
  value: string | null;
  trend?: Trend | null;
  comparison?: string;
  detail?: string;
  isUrgent?: boolean;
  onClick?: () => void;
}

function StatTile({
  id,
  icon,
  label,
  value,
  trend = null,
  comparison = "",
  detail,
  isUrgent = false,
  onClick,
}: StatTileProps) {
  const body = (
    <>
      <p className="flex items-center gap-2 text-sm font-semibold text-muted">
        <span
          className={`grid size-8 place-items-center rounded-full ${isUrgent ? "bg-danger text-white" : "bg-paper text-ink ring-1 ring-line"}`}
        >
          {icon}
        </span>
        {label}
      </p>
      {value === null ? (
        <div className="mt-2 h-10 w-24 animate-pulse rounded-xl bg-line/60" />
      ) : (
        <p data-kpi-value className="mt-2 text-4xl font-semibold tracking-tight text-ink tabular-nums">
          {value}
        </p>
      )}
      {trend && <TrendLine trend={trend} comparison={comparison} />}
      {detail && <p className={`mt-1 text-sm ${isUrgent ? "font-medium text-danger" : "text-muted"}`}>{detail}</p>}
    </>
  );
  const classes = `${CARD} justify-center text-start ${isUrgent ? "ring-2 ring-danger" : ""}`;
  return onClick ? (
    <button
      type="button"
      data-kpi={id}
      onClick={onClick}
      className={`${classes} w-full transition hover:-translate-y-0.5 hover:shadow-md`}
    >
      {body}
    </button>
  ) : (
    <div data-kpi={id} className={classes}>
      {body}
    </div>
  );
}

function TrendLine({ trend, comparison }: { trend: Trend; comparison: string }) {
  const { t } = useLanguage();
  const Arrow = trend.direction === "up" ? ArrowUp : trend.direction === "down" ? ArrowDown : Minus;
  const tone = trend.tone === "good" ? GOOD_TONE : trend.tone === "bad" ? "text-danger" : "text-muted";
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
      <span className="text-muted">{comparison}</span>
    </p>
  );
}

const STATE_CLASSES: Record<LostSalesItem["state"], string> = {
  open: "bg-danger-soft text-danger",
  restocked: "bg-brand-soft text-brand-strong",
  misplaced: "bg-next-soft text-[#7a4805]",
};

function TopItemsCard({ report }: { report: LostSalesReport | null }) {
  const { t, pick, language } = useLanguage();
  const items = report?.items.slice(0, TOP_ITEMS) ?? [];
  const biggest = Math.max(1, ...items.map((item) => item.value_agorot));

  return (
    <section aria-labelledby="top-items-title" className={`${CARD} gap-4`}>
      <h2 id="top-items-title" className={CARD_TITLE}>
        {t.lostSalesTopItems}
      </h2>
      {!report && <div className="h-72 animate-pulse rounded-2xl bg-line/60" />}
      {report && items.length === 0 && <p className="py-6 text-center text-muted">{t.lostSalesEmpty}</p>}
      <ol className="flex flex-col gap-3.5">
        {items.map((item) => {
          const department = item.category_name
            ? pick(item.category_name, item.category_name_en ?? item.category_name)
            : null;
          const basis = item.price_basis ? t.lostSalesBasis[item.price_basis] : t.lostSalesNoPrice;
          const estimated = item.price_basis !== null && item.price_basis !== "product";
          return (
            <li key={`${item.category_id}|${item.item}`} data-lost-item className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate font-semibold text-ink">{item.item}</span>
                <span
                  title={
                    item.unit_price_agorot !== null
                      ? `${basis}: ${formatShekels(item.unit_price_agorot, language)}`
                      : basis
                  }
                  className="shrink-0 font-semibold text-ink tabular-nums"
                >
                  {estimated && <span aria-hidden>≈ </span>}
                  {item.unit_price_agorot === null ? "—" : formatShekels(item.value_agorot, language, true)}
                  <span className="sr-only"> · {basis}</span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${STATE_CLASSES[item.state]}`}>
                  {t.lostSalesState[item.state]}
                </span>
                {department && <span>{department}</span>}
                <span>{t.lostSalesReportCount(item.reports)}</span>
                {item.picker_reports > 0 && <span>{t.lostSalesPickers(item.picker_reports)}</span>}
              </div>
              <div aria-hidden className="h-1.5 rounded-full bg-paper">
                <div
                  className="h-full rounded-full bg-danger/70"
                  style={{ width: `${(item.value_agorot / biggest) * 100}%` }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function NotCarriedCard({
  report,
  failed,
  onRetry,
}: {
  report: LostDemandReport | null;
  failed: boolean;
  onRetry: () => void;
}) {
  const { t, pick } = useLanguage();
  const items = report?.items.slice(0, TOP_SEARCHES) ?? [];
  const most = Math.max(1, ...items.map((item) => item.times));

  return (
    <section aria-labelledby="lost-demand-title" data-panel="not-carried" className={`${CARD} gap-4`}>
      <div>
        <h2 id="lost-demand-title" className={CARD_TITLE}>
          {t.lostDemandTitle}
        </h2>
        {report && report.total > 0 && <p className="text-sm text-muted">{t.lostDemandHint(report.total)}</p>}
      </div>
      {failed && <Notice message={t.loadFailed} onRetry={onRetry} />}
      {!report && !failed && <div className="h-64 animate-pulse rounded-2xl bg-line/60" />}
      {report?.total === 0 && <p className="py-6 text-center text-muted">{t.lostDemandEmpty}</p>}
      <ol className="flex flex-col gap-2.5">
        {items.map((item) => (
          <li key={`${item.category_id}|${item.item}`} data-not-carried={item.item} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{item.item}</span>
              <span className="shrink-0 text-sm text-muted">
                {item.category_name
                  ? pick(item.category_name, item.category_name_en ?? item.category_name)
                  : t.lostDemandNoCategory}
              </span>
              <span className="shrink-0 text-end font-semibold whitespace-nowrap text-ink tabular-nums">
                {t.lostDemandTimes(item.times)}
              </span>
            </div>
            <div aria-hidden className="h-1.5 rounded-full bg-paper">
              <div className="h-full rounded-full bg-you/70" style={{ width: `${(item.times / most) * 100}%` }} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Orders picked with the sorted list this week: shown once there are any. */
function PickingSummaryCard({ report }: { report: PickingReport | null }) {
  const { t } = useLanguage();
  if (!report || (report.current.orders === 0 && report.previous.orders === 0)) {
    return null;
  }
  const { current, previous } = report;
  return (
    <section aria-labelledby="picking-title" data-panel="picking" className={`${CARD} gap-4`}>
      <h2 id="picking-title" className={`${CARD_TITLE} flex items-center gap-2`}>
        <ClipboardList aria-hidden className="size-5 text-muted" />
        {t.pickingTitle}
      </h2>
      <div className="grid grid-cols-3 gap-3 text-center">
        <Figure
          label={t.pickingMedian}
          value={current.median_minutes === null ? "—" : t.durationMinutes(current.median_minutes)}
        />
        <Figure label={t.pickingOrders} value={String(current.orders)} />
        <Figure label={t.pickingMissing} value={String(current.missing)} />
      </div>
      <p className="text-sm text-muted">
        {previous.median_minutes === null
          ? t.pickingNoBaseline
          : t.pickingVsBefore(t.durationMinutes(previous.median_minutes))}
      </p>
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-paper p-3 ring-1 ring-line">
      <p data-picking-value className="text-2xl font-semibold text-ink tabular-nums">
        {value}
      </p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { LostDemandReport, LostItem } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { DepartmentSlice } from "../../lib/admin/analytics";
import { departmentSlices } from "../../lib/admin/analytics";
import { Notice } from "../Notice";

interface LostDemandWidgetProps {
  report: LostDemandReport | null;
  failed: boolean;
  onRetry: () => void;
}

const BAR_COLOR = "#2a78d6";
const BAR_THICKNESS = 18;
const ROW_HEIGHT = 34;
const LABEL_WIDTH = 164;
// How far the chart starts a tick from its axis: 6 for the tick mark and 2 of margin.
const TICK_OFFSET = 8;
const MAX_LABEL_LETTERS = 24;

function shortLabel(text: string): string {
  return text.length > MAX_LABEL_LETTERS ? `${text.slice(0, MAX_LABEL_LETTERS - 1)}…` : text;
}

export function LostDemandWidget({ report, failed, onRetry }: LostDemandWidgetProps) {
  const { t } = useLanguage();

  return (
    <section
      aria-labelledby="lost-demand-title"
      className="flex flex-col gap-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
    >
      <div>
        <h2 id="lost-demand-title" className="text-lg font-semibold text-slate-900">
          {t.lostDemandTitle}
        </h2>
        {report && report.total > 0 && (
          <p className="text-sm text-slate-500">{t.lostDemandHint(report.total)}</p>
        )}
      </div>

      {failed && <Notice message={t.loadFailed} onRetry={onRetry} />}
      {!report && !failed && <div className="h-80 animate-pulse rounded-xl bg-slate-100" />}
      {report?.total === 0 && <p className="py-8 text-center text-slate-500">{t.lostDemandEmpty}</p>}
      {report && report.total > 0 && (
        <>
          <TopItemsChart items={report.items} />
          <DepartmentsChart report={report} />
        </>
      )}
    </section>
  );
}

function TopItemsChart({ items }: { items: readonly LostItem[] }) {
  const { t, pick } = useLanguage();
  const isRtl = t.direction === "rtl";

  return (
    <div>
      <h3 className="mb-1 text-sm font-medium text-slate-500">{t.lostDemandItems}</h3>
      {/* The chart lays itself out left to right. Its axes mirror for Hebrew instead. */}
      <div dir="ltr">
        <ResponsiveContainer width="100%" height={items.length * ROW_HEIGHT + 8}>
          <BarChart
            accessibilityLayer
            layout="vertical"
            data={[...items]}
            margin={{ top: 4, bottom: 4, left: isRtl ? 28 : 0, right: isRtl ? 0 : 28 }}
          >
            <XAxis type="number" hide reversed={isRtl} domain={[0, "dataMax"]} />
            <YAxis
              type="category"
              dataKey="item"
              orientation={isRtl ? "right" : "left"}
              width={LABEL_WIDTH}
              axisLine={false}
              tickLine={false}
              interval={0}
              tick={(props) => <ItemTick {...props} isRtl={isRtl} />}
            />
            <Tooltip
              cursor={{ fill: "#f1f5f9" }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const item = payload?.[0]?.payload as LostItem | undefined;
                if (!active || !item) {
                  return null;
                }
                const category = item.category_name
                  ? pick(item.category_name, item.category_name_en ?? item.category_name)
                  : t.lostDemandNoCategory;
                return (
                  <ChartTooltip
                    value={t.lostDemandTimes(item.times)}
                    title={item.item}
                    detail={category}
                  />
                );
              }}
            />
            <Bar
              dataKey="times"
              fill={BAR_COLOR}
              barSize={BAR_THICKNESS}
              radius={isRtl ? [4, 0, 0, 4] : [0, 4, 4, 0]}
              animationDuration={500}
            >
              <LabelList
                dataKey="times"
                position={isRtl ? "left" : "right"}
                fill="#334155"
                fontSize={13}
                fontWeight={600}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface ItemTickProps {
  x?: number | string;
  y?: number | string;
  payload?: { value: string };
  isRtl: boolean;
}

/** Hebrew labels line up on the right edge, the way a Hebrew list does. */
function ItemTick({ x = 0, y = 0, payload, isRtl }: ItemTickProps) {
  return (
    <text
      x={Number(x) + (isRtl ? LABEL_WIDTH - TICK_OFFSET : -TICK_OFFSET)}
      y={Number(y)}
      textAnchor="end"
      dominantBaseline="central"
      fontSize={13}
      fill="#334155"
    >
      {shortLabel(payload?.value ?? "")}
    </text>
  );
}

function DepartmentsChart({ report }: { report: LostDemandReport }) {
  const { t } = useLanguage();
  const slices = useMemo(() => departmentSlices(report.categories), [report.categories]);

  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-slate-500">{t.lostDemandCategories}</h3>
      <div className="grid items-center gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
        <div dir="ltr" className="relative mx-auto h-44 w-44">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="times"
                nameKey="key"
                innerRadius="66%"
                outerRadius="100%"
                startAngle={90}
                endAngle={-270}
                stroke="#ffffff"
                strokeWidth={2}
                animationDuration={500}
              >
                {slices.map((slice) => (
                  <Cell key={slice.key} fill={slice.color} />
                ))}
              </Pie>
              <Tooltip
                isAnimationActive={false}
                content={({ active, payload }) => {
                  const slice = payload?.[0]?.payload as DepartmentSlice | undefined;
                  return active && slice ? <SliceTooltip slice={slice} /> : null;
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
            <span className="text-2xl font-semibold text-slate-900">{report.total}</span>
            <span className="text-xs text-slate-500">{t.lostDemandCenter}</span>
          </div>
        </div>

        <ul className="flex min-w-0 flex-col gap-1.5">
          {slices.map((slice) => (
            <li key={slice.key} className="flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-sm"
                style={{ backgroundColor: slice.color }}
              />
              <SliceName slice={slice} />
              <span className="ms-auto font-semibold text-slate-900 tabular-nums">
                {Math.round(slice.share * 100)}%
              </span>
              <span className="w-8 text-end text-slate-500 tabular-nums">{slice.times}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function useSliceName(slice: DepartmentSlice): string {
  const { t, pick } = useLanguage();
  const { category } = slice;
  return category?.category_name
    ? pick(category.category_name, category.category_name_en ?? category.category_name)
    : t.lostDemandOther;
}

function SliceName({ slice }: { slice: DepartmentSlice }) {
  return <span className="min-w-0 truncate text-slate-700">{useSliceName(slice)}</span>;
}

function SliceTooltip({ slice }: { slice: DepartmentSlice }) {
  const { t } = useLanguage();
  return (
    <ChartTooltip
      value={`${Math.round(slice.share * 100)}%`}
      title={useSliceName(slice)}
      detail={t.lostDemandTimes(slice.times)}
    />
  );
}

function ChartTooltip({ value, title, detail }: { value: string; title: string; detail: string }) {
  const { t } = useLanguage();
  return (
    <div
      dir={t.direction}
      className="rounded-lg bg-white px-3 py-2 text-sm shadow-lg ring-1 ring-slate-200"
    >
      <p className="font-semibold text-slate-900">{value}</p>
      <p className="text-slate-700">{title}</p>
      <p className="text-slate-500">{detail}</p>
    </div>
  );
}

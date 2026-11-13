import { Check, ClipboardList, LoaderCircle, PackageX, Timer } from "lucide-react";
import { useEffect, useState } from "react";

import { STORE_ID } from "../../api/client";
import type { StaffApi } from "../../api/staffClient";
import { useLanguage } from "../../i18n/LanguageProvider";
import { newUuid } from "../../lib/events/notFoundQueue";
import type { FloorMap } from "../../lib/floorPlanMap";
import { routeFromGrid } from "../../lib/floorPlanMap";
import { parseShoppingText } from "../../lib/list/parseList";
import type { PickLine, PickStop, PickWalk } from "../../lib/staff/picking";
import { pickLines, pickProgress, pickWalk, withLineState } from "../../lib/staff/picking";
import { Notice } from "../Notice";

interface PickPanelProps {
  api: StaffApi;
  /** The drawn plan; null when the store has none that routes. */
  floor: FloorMap | null;
}

interface Pick {
  sessionId: string;
  startedAt: string;
  walk: PickWalk;
}

interface Finished {
  minutes: number;
  lines: number;
  missing: number;
}

// A picker's phone locks and the browser may reload the tab: the order survives that.
const STORAGE_KEY = "staff-pick";

function loadPick(): Pick | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Pick) : null;
  } catch {
    return null;
  }
}

function elapsed(since: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * An online order picked in walking order: paste it, walk the shelves as listed,
 * tick each line or mark it missing. A missing line alerts the floor staff at once,
 * and the minutes the order took are kept: the picking pilot's one figure.
 */
export function PickPanel({ api, floor }: PickPanelProps) {
  const { t } = useLanguage();
  const [text, setText] = useState("");
  const [pick, setPick] = useState<Pick | null>(loadPick);
  const [isSorting, setIsSorting] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (pick) localStorage.setItem(STORAGE_KEY, JSON.stringify(pick));
    else localStorage.removeItem(STORAGE_KEY);
  }, [pick]);

  useEffect(() => {
    if (!pick) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pick]);

  if (!floor) {
    return <p className="rounded-3xl bg-surface px-4 py-6 text-center text-muted ring-1 ring-line">{t.pickNoPlan}</p>;
  }

  const sort = async () => {
    const parsed = parseShoppingText(text);
    if (parsed.length === 0) return;
    setIsSorting(true);
    setProblem(null);
    setFinished(null);
    try {
      const lines = pickLines(parsed, await api.resolveOrder(parsed.map((item) => item.query)));
      const ids = [...new Set(lines.flatMap((line) => line.categoryId ?? []))];
      const route = ids.length > 0 ? routeFromGrid(await api.pickRoute(ids), floor.frame) : null;
      const walk = route ? pickWalk(lines, route) : { stops: [], elsewhere: lines };
      setPick({ sessionId: newUuid(), startedAt: new Date().toISOString(), walk });
      setText("");
    } catch {
      setProblem(t.pickSortFailed);
    } finally {
      setIsSorting(false);
    }
  };

  const mark = (line: PickLine) => {
    if (!pick) return;
    const next = line.state === "picked" ? "todo" : "picked";
    setPick({ ...pick, walk: withLineState(pick.walk, line.key, next) });
  };

  const markMissing = (line: PickLine, stop: PickStop | null) => {
    if (!pick) return;
    const isMissing = line.state === "missing";
    setPick({ ...pick, walk: withLineState(pick.walk, line.key, isMissing ? "todo" : "missing") });
    // Reported once, the first time: undoing a tap shouldn't take back an alert already sent.
    if (!isMissing && stop) {
      api
        .pickMissing({
          event_id: newUuid(),
          store_id: STORE_ID,
          session_id: `picker-${pick.sessionId}`,
          item_query: line.query,
          category_id: line.categoryId,
          x_coord: stop.x,
          y_coord: stop.y,
          timestamp: new Date().toISOString(),
        })
        .catch(() => setProblem(t.pickReportFailed));
    }
  };

  const finish = async () => {
    if (!pick) return;
    const progress = pickProgress(pick.walk);
    if (progress.left > 0 && !window.confirm(t.pickFinishEarly(progress.left))) return;
    setIsFinishing(true);
    setProblem(null);
    try {
      const result = await api.finishPick({
        id: pick.sessionId,
        store_id: STORE_ID,
        started_at: pick.startedAt,
        finished_at: new Date().toISOString(),
        lines: progress.total,
        missing: progress.missing,
      });
      setFinished({ minutes: result.minutes, lines: progress.total, missing: progress.missing });
      setPick(null);
    } catch {
      setProblem(t.saveFailed);
    } finally {
      setIsFinishing(false);
    }
  };

  if (!pick) {
    return (
      <section aria-labelledby="pick-title" className="flex flex-col gap-3">
        <h2 id="pick-title" className="text-xl font-semibold">
          {t.staffNav.pick}
        </h2>
        {finished && (
          <p role="status" className="flex items-start gap-2 rounded-3xl bg-brand-soft p-4 font-semibold text-brand-strong ring-1 ring-brand/30">
            <Check aria-hidden className="mt-0.5 size-5 shrink-0" />
            {t.pickDone(finished.minutes, finished.lines, finished.missing)}
          </p>
        )}
        {problem && <Notice message={problem} />}
        <label className="flex flex-col gap-1.5 font-medium">
          {t.pickPasteLabel}
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={8}
            placeholder={t.pickPastePlaceholder}
            className="rounded-2xl bg-surface p-3 text-base font-normal ring-1 ring-line outline-none focus:ring-2 focus:ring-brand"
          />
        </label>
        <button
          type="button"
          onClick={() => void sort()}
          disabled={isSorting || parseShoppingText(text).length === 0}
          className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-brand text-lg font-semibold text-white shadow-sm disabled:opacity-50"
        >
          {isSorting ? <LoaderCircle aria-hidden className="size-5 animate-spin" /> : <ClipboardList aria-hidden className="size-5" />}
          {t.pickSort}
        </button>
        <p className="text-sm text-muted">{t.pickHint}</p>
      </section>
    );
  }

  const progress = pickProgress(pick.walk);
  const row = (line: PickLine, stop: PickStop | null) => (
    <li key={line.key} data-pick-line={line.text} data-state={line.state} className="flex items-center gap-2">
      <button
        type="button"
        aria-pressed={line.state === "picked"}
        onClick={() => mark(line)}
        className={`flex min-h-12 flex-1 items-center gap-3 rounded-2xl px-3 text-start ring-1 ${
          line.state === "picked"
            ? "bg-brand-soft text-muted line-through ring-brand/30"
            : line.state === "missing"
              ? "bg-danger-soft text-danger ring-danger/30"
              : "bg-surface ring-line"
        }`}
      >
        <span
          aria-hidden
          className={`grid size-6 shrink-0 place-items-center rounded-lg ring-2 ${
            line.state === "picked" ? "bg-brand text-white ring-brand" : "ring-line"
          }`}
        >
          {line.state === "picked" && <Check className="size-4" />}
        </span>
        <span className="font-medium">{line.text}</span>
      </button>
      <button
        type="button"
        aria-pressed={line.state === "missing"}
        aria-label={`${t.pickMissing}: ${line.text}`}
        onClick={() => markMissing(line, stop)}
        className={`grid h-12 shrink-0 place-items-center rounded-2xl px-3 text-sm font-semibold ring-1 ${
          line.state === "missing" ? "bg-danger text-white ring-danger" : "bg-surface text-danger ring-line"
        }`}
      >
        <span className="flex items-center gap-1">
          <PackageX aria-hidden className="size-4" />
          {t.pickMissing}
        </span>
      </button>
    </li>
  );

  return (
    <section aria-labelledby="pick-title" className="flex flex-col gap-3">
      <div className="sticky top-[calc(3.75rem+env(safe-area-inset-top))] z-10 -mx-4 flex items-center gap-3 bg-paper/95 px-4 py-2 backdrop-blur">
        <h2 id="pick-title" className="flex-1 font-semibold" aria-live="polite">
          {t.pickProgress(progress.picked + progress.missing, progress.total, progress.missing)}
        </h2>
        <span className="flex items-center gap-1 text-sm text-muted tabular-nums" dir="ltr">
          <Timer aria-hidden className="size-4" />
          {elapsed(pick.startedAt, now)}
        </span>
      </div>
      {problem && <Notice message={problem} />}

      <ol className="flex flex-col gap-3">
        {pick.walk.stops.map((stop, index) => (
          <li key={stop.categoryId} data-pick-stop={stop.title} className="flex flex-col gap-2 rounded-3xl bg-paper">
            <p className="flex items-center gap-2 font-semibold">
              <span className="grid size-7 place-items-center rounded-full bg-slate-900 text-sm text-white">{index + 1}</span>
              {t.staffShelf(stop.title)}
            </p>
            <ul className="flex flex-col gap-2">{stop.lines.map((line) => row(line, stop))}</ul>
          </li>
        ))}
        {pick.walk.elsewhere.length > 0 && (
          <li data-pick-stop="elsewhere" className="flex flex-col gap-2">
            <p className="font-semibold text-muted">{t.pickElsewhere}</p>
            <ul className="flex flex-col gap-2">{pick.walk.elsewhere.map((line) => row(line, null))}</ul>
          </li>
        )}
      </ol>

      <button
        type="button"
        onClick={() => void finish()}
        disabled={isFinishing}
        className="mt-2 flex h-14 items-center justify-center gap-2 rounded-2xl bg-slate-900 text-lg font-semibold text-white disabled:opacity-60"
      >
        {isFinishing && <LoaderCircle aria-hidden className="size-5 animate-spin" />}
        {t.pickFinish}
      </button>
    </section>
  );
}

/** Reading the "not found" report: what a manager should act on first. */

import type { NotFoundReportRow } from "../../api/types";
import type { Language } from "../../i18n/strings";

/** One report can be a mistake. Three means the shelf really has a problem. */
export const ALERT_THRESHOLD = 3;

export function needsAttention(row: NotFoundReportRow): boolean {
  return row.times_reported >= ALERT_THRESHOLD;
}

export function countAlerts(rows: readonly NotFoundReportRow[]): number {
  return rows.filter(needsAttention).length;
}

/** The report groups by both, so the same words under two categories are two rows. */
export function reportRowKey({ category_id, item_query }: NotFoundReportRow): string {
  return JSON.stringify([category_id, item_query]);
}

const LOCALES: Record<Language, string> = { he: "he-IL", en: "en-GB" };

export function formatReportTime(iso: string, language: Language, timeZone?: string): string {
  return new Intl.DateTimeFormat(LOCALES[language], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

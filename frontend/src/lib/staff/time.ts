import type { Strings } from "../../i18n/strings";

const MINUTE_MS = 60_000;

/**
 * "לפני 12 דק׳", "לפני שעתיים", "אתמול": how long an alert has waited, at a glance.
 * Worded in our strings, not Intl's: browsers' Hebrew data disagree on the dual forms.
 */
export function formatAgo(iso: string, t: Pick<Strings, "ago">, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / MINUTE_MS));
  if (minutes < 1) return t.ago.now;
  if (minutes < 60) return t.ago.minutes(minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t.ago.hours(hours);
  return t.ago.days(Math.round(hours / 24));
}

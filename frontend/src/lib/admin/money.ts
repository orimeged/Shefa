/** Shekel amounts on the dashboard. The API sends agorot, so sums stay exact. */

import type { Language } from "../../i18n/strings";

// Arabic in Israel writes Western digits, as shop prices do.
const LOCALES: Record<Language, string> = { he: "he-IL", en: "en-IL", ar: "ar-IL-u-nu-latn", ru: "ru-IL" };
const AGOROT_PER_SHEKEL = 100;

/**
 * "₪7.10" for a shelf price, or whole shekels ("₪957") for a total, where agorot
 * would only be noise.
 */
export function formatShekels(agorot: number, language: Language, whole = false): string {
  return new Intl.NumberFormat(LOCALES[language], {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(agorot / AGOROT_PER_SHEKEL);
}

/** What a manager types, "7.1" or "₪7.10", to agorot; null for an empty field, NaN for nonsense. */
export function parseShekels(text: string): number | null {
  const cleaned = text.replace(/[₪,\s]/g, "");
  if (cleaned === "") {
    return null;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return Number.NaN;
  }
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * AGOROT_PER_SHEKEL + Number(fraction.padEnd(2, "0"));
}

/** The other way, for an edit field: 710 to "7.10". */
export function agorotToField(agorot: number | null): string {
  return agorot === null ? "" : (agorot / AGOROT_PER_SHEKEL).toFixed(2);
}

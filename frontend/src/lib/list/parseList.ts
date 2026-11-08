/**
 * Turns pasted text into list items: a WhatsApp message, several copied
 * messages, a note, or dictation. It only splits and cleans. Deciding what each
 * item is stays with the backend, so items appear at once even on a weak signal.
 */

export interface ParsedItem {
  /** What the shopper wrote, quantity included. */
  text: string;
  /** The part worth searching for. */
  query: string;
}

const MAX_ITEMS = 100;
const MAX_ITEM_LENGTH = 200;

const INVISIBLE_MARKS = /[‎‏‪-‮⁦-⁩﻿]/g;

const DATE = String.raw`\d{1,2}[./-]\d{1,2}[./-]\d{2,4}`;
const TIME = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp]\.?[Mm]\.?)?`;
const STAMP = `(?:${DATE},?\\s*${TIME}|${TIME},?\\s*${DATE})`;
/** "[12:30, 31/10/2026] Mom: " when copied, "31/10/2026, 12:30 - Mom: " when exported. */
const WHATSAPP_PREFIX = new RegExp(`^\\[?${STAMP}\\]?\\s*(?:-\\s*)?(?:[^:]{1,40}:\\s*)?`);

const BULLET = /^(?:[\s\-–—•·*▪▫◦○●>]|\p{Extended_Pictographic}|️|‍)+/u;
const NUMBERED = /^\d+[.)]\s+/;

const GREETING =
  /^(?:היי|הי|שלום|אהלן|בוקר טוב|צהריים טובים|ערב טוב|תודה(?: רבה)?|בבקשה|רשימת קניות|רשימה|קניות|לסופר|מהסופר|לקנות|נשיקות|אוהב אותך|אוהבת אותך|hi|hello|hey|thanks|thank you|shopping list|groceries)[\s:!.,]*$/i;
const NOT_AN_ITEM = /omitted|הושמט|<מדיה|https?:\/\//i;

const LEAD_IN =
  /^(?:(?:אפשר|וגם|גם|תביא|תביאי|תקנה|תקני|קח|קחי|צריך|צריכה|צריכים|לקנות|להביא|תוסיף|תוסיפי|בבקשה|please|get|buy)\s+)+/i;
const TAIL = /\s+(?:בבקשה|גם|please)$/i;

const NUMBER_WORDS =
  "חצי|רבע|שני|שתי|שניים|שתיים|שלושה|שלוש|ארבעה|ארבע|חמישה|חמש|שישה|שש|שבעה|שבע|שמונה|תשעה|תשע|עשרה|עשר";
const UNITS = `יחידות|יחידה|יח'|יח׳|ק"ג|ק״ג|קג|קילו|גרם|גר'|גר׳|ליטרים|ליטר|ל'|ל׳|חבילות|חבילה|בקבוקים|בקבוק|שקיות|שקית|קרטונים|קרטון|תבניות|תבנית|פחיות|פחית|זוגות|זוג|kg|g|l|packs|pack`;
const LEADING_QUANTITY = new RegExp(
  `^(?:\\d+(?:\\.\\d+)?(?:\\s*[x×*]\\s*|\\s+|(?=[א-ת]))|(?:${NUMBER_WORDS})\\s+)(?:(?:${UNITS})\\s+)?(?:של\\s+)?(?=\\S)`,
  "i",
);
const TRAILING_QUANTITY = /(?:\s*[x×*]\s*\d+|\s+\d+(?:\s*(?:יח'|יח׳|יחידות))?)$/i;

export function parseShoppingText(raw: string): ParsedItem[] {
  const items = new Map<string, ParsedItem>();

  for (const rawLine of raw.replace(INVISIBLE_MARKS, "").split(/\r?\n/)) {
    const line = cleanLine(rawLine);
    if (!line || isNotAnItem(line)) {
      continue;
    }
    for (const piece of splitPieces(line)) {
      const item = toItem(piece);
      if (item && !items.has(item.query)) {
        items.set(item.query, item);
      }
    }
  }
  return [...items.values()].slice(0, MAX_ITEMS);
}

function cleanLine(line: string): string {
  return line.trim().replace(WHATSAPP_PREFIX, "").replace(NUMBERED, "").replace(BULLET, "").trim();
}

function isNotAnItem(line: string): boolean {
  return line.endsWith(":") || GREETING.test(line) || NOT_AN_ITEM.test(line);
}

function splitPieces(line: string): string[] {
  // "1,5 ליטר" is a number, not two items.
  return line.replace(/(\d),(\d)/g, "$1.$2").split(/[,،;]+|\s+\+\s+/);
}

function toItem(piece: string): ParsedItem | null {
  const text = piece
    .trim()
    .replace(/[.!?]+$/, "")
    .replace(LEAD_IN, "")
    .replace(TAIL, "")
    .slice(0, MAX_ITEM_LENGTH);
  if (!text || GREETING.test(text)) {
    return null;
  }
  const query = text.replace(LEADING_QUANTITY, "").replace(TRAILING_QUANTITY, "").trim();
  return { text, query: query || text };
}

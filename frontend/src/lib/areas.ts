/**
 * An area is a word like "מים" that the server routes to where its products stand
 * (app/domain/areas.py). Its price is their median: a fair guess for a basket, so
 * the screens say it's about that much rather than that exact.
 */
export const AREA_PREFIX = "area:";

export function isArea(categoryId: string): boolean {
  return categoryId.startsWith(AREA_PREFIX);
}

/**
 * A short buzz where the browser allows one. Safari on iPhone has no vibration
 * for web pages at all, so there the rewards are the visual ones only.
 */
export function buzz(pattern: number | readonly number[]): void {
  try {
    navigator.vibrate?.(pattern as number | number[]);
  } catch {
    // Some browsers refuse outside a tap. Nothing else depends on it.
  }
}

export const FOUND_BUZZ = 30;
export const LIST_DONE_BUZZ = [40, 70, 40, 70, 120];

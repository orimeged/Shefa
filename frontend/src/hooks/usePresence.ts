import { useLayoutEffect, useState } from "react";

export interface Presence<T> {
  item: T;
  /** Removed from `items`, and still shown for a moment so it can animate out. */
  leaving: boolean;
}

/**
 * `items`, plus the ones just removed for `exitMs`. `items` and `keyOf` must
 * keep their identity while nothing changes, or every render counts as a change.
 */
export function usePresence<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  exitMs: number,
): Presence<T>[] {
  const [shown, setShown] = useState<Presence<T>[]>(() =>
    items.map((item) => ({ item, leaving: false })),
  );

  useLayoutEffect(() => {
    const present = new Set(items.map(keyOf));
    setShown((previous) => [
      ...items.map((item) => ({ item, leaving: false })),
      ...previous
        .filter((entry) => !present.has(keyOf(entry.item)))
        .map((entry) => ({ ...entry, leaving: true })),
    ]);
    const timer = setTimeout(
      () => setShown((previous) => previous.filter((entry) => !entry.leaving)),
      exitMs,
    );
    return () => clearTimeout(timer);
  }, [items, keyOf, exitMs]);

  return shown;
}

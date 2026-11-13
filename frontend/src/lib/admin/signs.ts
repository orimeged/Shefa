/** The QR signs a store hangs up: what each one opens. */

export interface SignSpec {
  key: string;
  /** Null for the entrance sign. */
  shelf: string | null;
  url: string;
}

/**
 * The entrance sign, and one per shelf. A shelf's sign carries the shelf's name, not
 * a tile: the phone asks where that shelf is when scanned, so a sign printed before
 * the map was redrawn still points to the right place.
 */
export function signSpecs(origin: string, shelves: readonly string[], withEntrance: boolean): SignSpec[] {
  const base = `${origin.replace(/\/$/, "")}/mobile`;
  return [
    ...(withEntrance ? [{ key: "entrance", shelf: null, url: base }] : []),
    ...shelves.map((shelf) => ({ key: `shelf:${shelf}`, shelf, url: `${base}?${new URLSearchParams({ at: shelf })}` })),
  ];
}

/**
 * A store's floor drawn as square tiles, for managers who lay out their own store.
 *
 * The grid is `grid[row][col]`, row 0 at the top. Every tile says whether a
 * shopper can stand on it, which is all a path search such as A* needs: a tile
 * is a node, and its walkable neighbours are its edges.
 */

export type TileKind = "aisle" | "shelf" | "wall" | "checkout" | "entrance";

export interface Tile {
  readonly kind: TileKind;
  /** Shelves only: the department on them, such as "מוצרי חלב". */
  readonly label?: string;
}

export type FloorGrid = readonly (readonly Tile[])[];

export interface Cell {
  readonly row: number;
  readonly col: number;
}

export const TILE_KINDS: readonly TileKind[] = ["aisle", "shelf", "wall", "checkout", "entrance"];

/** Shoppers walk aisles and come in through the entrance; the rest is in the way. */
const WALKABLE: Readonly<Record<TileKind, boolean>> = {
  aisle: true,
  entrance: true,
  shelf: false,
  wall: false,
  checkout: false,
};

export const AISLE: Tile = Object.freeze({ kind: "aisle" });

export const DEFAULT_ROWS = 20;
export const DEFAULT_COLS = 30;
export const MIN_SIZE = 5;
export const MAX_SIZE = 60;
export const MAX_LABEL_LENGTH = 40;
export const PAYLOAD_VERSION = 1;
/** One tile's side on the real floor, in metres; the server allows above 0 up to 5. */
export const DEFAULT_CELL_SIZE_M = 1;
export const MIN_CELL_SIZE_M = 0.25;
export const MAX_CELL_SIZE_M = 5;

export function isWalkable(tile: Tile): boolean {
  return WALKABLE[tile.kind];
}

export function createGrid(rows = DEFAULT_ROWS, cols = DEFAULT_COLS): FloorGrid {
  const height = clampSize(rows);
  const width = clampSize(cols);
  return Array.from({ length: height }, () => Array<Tile>(width).fill(AISLE));
}

export function gridSize(grid: FloorGrid): { rows: number; cols: number } {
  return { rows: grid.length, cols: grid[0]?.length ?? 0 };
}

/** Trimmed and capped; an empty label is no label. */
export function cleanLabel(label: string | undefined): string | undefined {
  const text = (label ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH);
  return text || undefined;
}

/** What a tool lays down. Only a shelf keeps its label. */
export function makeTile(kind: TileKind, label?: string): Tile {
  if (kind === "aisle") {
    return AISLE;
  }
  const clean = kind === "shelf" ? cleanLabel(label) : undefined;
  return clean ? { kind, label: clean } : { kind };
}

function sameTile(a: Tile, b: Tile): boolean {
  return a.kind === b.kind && a.label === b.label;
}

/**
 * The grid with `tile` on every given cell inside it. Rows nothing landed on
 * are the same arrays as before, so a row that didn't change needn't redraw.
 * Painting what is already there returns the very same grid.
 */
export function paint(grid: FloorGrid, cells: Iterable<Cell>, tile: Tile): FloorGrid {
  const { cols } = gridSize(grid);
  const copies = new Map<number, Tile[]>();
  for (const { row, col } of cells) {
    const line = grid[row];
    const current = col < cols ? line?.[col] : undefined;
    if (!line || !current || sameTile(current, tile)) {
      continue;
    }
    let copy = copies.get(row);
    if (!copy) {
      copy = [...line];
      copies.set(row, copy);
    }
    copy[col] = tile;
  }
  if (copies.size === 0) {
    return grid;
  }
  return grid.map((line, row) => copies.get(row) ?? line);
}

/**
 * Every cell on the straight line from one to the other, both included. A fast
 * drag reports far-apart points, and painting only those would leave gaps.
 */
export function cellsBetween(from: Cell, to: Cell): Cell[] {
  const cells: Cell[] = [];
  const dRow = Math.abs(to.row - from.row);
  const dCol = Math.abs(to.col - from.col);
  const stepRow = from.row < to.row ? 1 : -1;
  const stepCol = from.col < to.col ? 1 : -1;
  let row = from.row;
  let col = from.col;
  let error = dCol - dRow;
  for (;;) {
    cells.push({ row, col });
    if (row === to.row && col === to.col) {
      return cells;
    }
    const doubled = error * 2;
    if (doubled > -dRow) {
      error -= dRow;
      col += stepCol;
    }
    if (doubled < dCol) {
      error += dCol;
      row += stepRow;
    }
  }
}

/** A new size that keeps what was drawn from the top-left corner. */
export function resize(grid: FloorGrid, rows: number, cols: number): FloorGrid {
  const height = clampSize(rows);
  const width = clampSize(cols);
  return Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, col) => grid[row]?.[col] ?? AISLE),
  );
}

/** `true` where a shopper can stand: the form a path search reads. */
export function walkableMatrix(grid: FloorGrid): boolean[][] {
  return grid.map((line) => line.map(isWalkable));
}

export function countTiles(grid: FloorGrid): Record<TileKind, number> {
  const counts: Record<TileKind, number> = { aisle: 0, shelf: 0, wall: 0, checkout: 0, entrance: 0 };
  for (const line of grid) {
    for (const tile of line) {
      counts[tile.kind] += 1;
    }
  }
  return counts;
}

export interface LabelCount {
  label: string;
  tiles: number;
}

/** Departments on the shelves, the biggest first; same size, alphabetical. */
export function shelfLabels(grid: FloorGrid): LabelCount[] {
  const counts = new Map<string, number>();
  for (const line of grid) {
    for (const tile of line) {
      if (tile.label) {
        counts.set(tile.label, (counts.get(tile.label) ?? 0) + 1);
      }
    }
  }
  return [...counts]
    .map(([label, tiles]) => ({ label, tiles }))
    .sort((a, b) => b.tiles - a.tiles || a.label.localeCompare(b.label));
}

export interface FloorGridPayload {
  version: typeof PAYLOAD_VERSION;
  rows: number;
  cols: number;
  /** `tiles[row][col]`, row 0 at the top. */
  tiles: TileKind[][];
  /** Shelf tiles that carry a department. */
  labels: { row: number; col: number; label: string }[];
  /** Metres per tile: route distances are walked in these. */
  cell_size_m: number;
}

/** The grid as plain JSON for the server: kinds in a matrix, labels beside it. */
export function toPayload(grid: FloorGrid, cellSizeM = DEFAULT_CELL_SIZE_M): FloorGridPayload {
  const { rows, cols } = gridSize(grid);
  const labels: FloorGridPayload["labels"] = [];
  const tiles = grid.map((line, row) =>
    line.map((tile, col) => {
      if (tile.label) {
        labels.push({ row, col, label: tile.label });
      }
      return tile.kind;
    }),
  );
  return { version: PAYLOAD_VERSION, rows, cols, tiles, labels, cell_size_m: cellSizeM };
}

/** A payload read back, or null if it isn't one; anything stored can be stale or edited. */
export function fromPayload(value: unknown): FloorGrid | null {
  if (!isRecord(value) || value.version !== PAYLOAD_VERSION) {
    return null;
  }
  const { rows, cols, tiles, labels } = value;
  if (
    !isSize(rows) ||
    !isSize(cols) ||
    !Array.isArray(tiles) ||
    tiles.length !== rows ||
    !Array.isArray(labels)
  ) {
    return null;
  }
  const grid: Tile[][] = [];
  for (const line of tiles) {
    if (!Array.isArray(line) || line.length !== cols || !line.every(isTileKind)) {
      return null;
    }
    grid.push(line.map((kind) => makeTile(kind)));
  }
  for (const entry of labels) {
    if (!isRecord(entry)) {
      return null;
    }
    const { row, col, label } = entry;
    if (typeof row !== "number" || typeof col !== "number" || typeof label !== "string") {
      return null;
    }
    if (grid[row]?.[col]?.kind === "shelf") {
      grid[row][col] = makeTile("shelf", label);
    }
  }
  return grid;
}

/** A usable tile size, or null: blank, not a number, or outside what the server takes. */
export function parseCellSize(value: unknown): number | null {
  const size = typeof value === "string" ? Number(value.trim() || Number.NaN) : value;
  return typeof size === "number" && size >= MIN_CELL_SIZE_M && size <= MAX_CELL_SIZE_M
    ? size
    : null;
}

/** The tile size a saved payload states, a metre when it says none. */
export function readCellSize(payload: unknown): number {
  const stated = isRecord(payload) ? payload.cell_size_m : undefined;
  return typeof stated === "number" && stated > 0 ? stated : DEFAULT_CELL_SIZE_M;
}

function clampSize(size: number): number {
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(size)));
}

function isSize(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= MIN_SIZE && (value as number) <= MAX_SIZE;
}

function isTileKind(value: unknown): value is TileKind {
  return TILE_KINDS.includes(value as TileKind);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

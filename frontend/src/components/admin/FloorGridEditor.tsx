import type { LucideIcon } from "lucide-react";
import {
  BrickWall,
  Check,
  CircleAlert,
  Copy,
  DoorOpen,
  Footprints,
  Package,
  Save,
  ScanBarcode,
  Trash2,
  Undo2,
} from "lucide-react";
import type { KeyboardEvent, PointerEvent } from "react";
import { memo, useEffect, useId, useMemo, useRef, useState } from "react";

import type { FloorPlanCheck } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { Cell, FloorGrid, FloorGridPayload, Tile, TileKind } from "../../lib/admin/floorGrid";
import {
  AISLE,
  TILE_KINDS,
  cellsBetween,
  countTiles,
  createGrid,
  gridSize,
  isWalkable,
  makeTile,
  MAX_CELL_SIZE_M,
  MIN_CELL_SIZE_M,
  paint,
  parseCellSize,
  resize,
  shelfLabels,
  toPayload,
} from "../../lib/admin/floorGrid";

const SIZES: readonly (readonly [number, number])[] = [
  [20, 30],
  [30, 30],
  [30, 40],
  [40, 60],
];
const HISTORY_LIMIT = 100;

const TOOL_ICONS: Record<TileKind, LucideIcon> = {
  aisle: Footprints,
  shelf: Package,
  wall: BrickWall,
  checkout: ScanBarcode,
  entrance: DoorOpen,
};

const TILE_COLOR: Record<TileKind, string> = {
  aisle: "bg-white",
  shelf: "bg-shelf-strong",
  wall: "bg-ink",
  checkout: "bg-sky-700",
  entrance: "bg-brand",
};

const ARROWS: Partial<Record<string, readonly [number, number]>> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

interface FloorGridEditorProps {
  initialGrid: FloorGrid;
  /** The server's check of `initialGrid`; null when nothing has been saved yet. */
  initialCheck: FloorPlanCheck | null;
  /** Metres one tile stands for on the real floor, as last saved. */
  initialCellSize: number;
  /** Department names to offer for shelves. */
  /** Names to paint with: departments, and subcategories, each with the department it's within. */
  suggestions: readonly { value: string; within?: string }[];
  /** Sends the payload to the server: its check of the plan, or null if saving failed. */
  onSave: (payload: FloorGridPayload, json: string) => Promise<FloorPlanCheck | null>;
}

interface Stroke {
  tile: Tile;
  /** Null after the pointer left the grid, so coming back doesn't draw a line across. */
  last: Cell | null;
  before: FloorGrid;
}

/** A tile grid managers paint their store's layout on, for routing to read later. */
export function FloorGridEditor({
  initialGrid,
  initialCheck,
  initialCellSize,
  suggestions,
  onSave,
}: FloorGridEditorProps) {
  const { t } = useLanguage();
  const [grid, setGrid] = useState(initialGrid);
  // Pointer events can outrun renders, so every change reads and writes this first.
  const gridRef = useRef(initialGrid);
  const [past, setPast] = useState<FloorGrid[]>([]);
  const [savedGrid, setSavedGrid] = useState(initialGrid);
  const [savedJson, setSavedJson] = useState(() =>
    initialCheck ? JSON.stringify(toPayload(initialGrid, initialCellSize)) : null,
  );
  // Kept as typed, so "0." on the way to "0.5" isn't rewritten under the cursor.
  const [cellSizeText, setCellSizeText] = useState(String(initialCellSize));
  const [savedCellSize, setSavedCellSize] = useState(initialCellSize);
  const cellSize = parseCellSize(cellSizeText);
  const [check, setCheck] = useState(initialCheck);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tool, setTool] = useState<TileKind>("shelf");
  const [label, setLabel] = useState("");
  const [hover, setHover] = useState<Cell | null>(null);
  const [cursor, setCursor] = useState<Cell>({ row: 0, col: 0 });
  const [isKeyboard, setIsKeyboard] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const stroke = useRef<Stroke | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const toolGroup = useId();
  const labelList = useId();
  const inspectorId = useId();

  const { rows, cols } = gridSize(grid);
  const counts = useMemo(() => countTiles(grid), [grid]);
  const departments = useMemo(() => shelfLabels(grid), [grid]);
  const unlabelled = counts.shelf - departments.reduce((sum, entry) => sum + entry.tiles, 0);
  const isDirty = grid !== savedGrid || (cellSize !== null && cellSize !== savedCellSize);
  const currentTile = makeTile(tool, label);

  useEffect(() => {
    if (!isDirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const apply = (next: FloorGrid) => {
    gridRef.current = next;
    setGrid(next);
  };

  const remember = (before: FloorGrid) =>
    setPast((current) => [...current.slice(1 - HISTORY_LIMIT), before]);

  /** One step for undo: a click, a key, a clear or a resize. */
  const edit = (next: FloorGrid) => {
    if (next !== gridRef.current) {
      remember(gridRef.current);
      apply(next);
    }
  };

  const undo = () => {
    const previous = past.at(-1);
    if (previous) {
      setPast(past.slice(0, -1));
      apply(previous);
    }
  };

  const clear = () => {
    if (counts.aisle !== rows * cols) {
      edit(createGrid(rows, cols));
    }
  };

  const save = async () => {
    if (isSaving || cellSize === null) {
      return;
    }
    // What goes out now is what counts as saved; painting meanwhile stays unsaved.
    const sent = gridRef.current;
    const payload = toPayload(sent, cellSize);
    const json = JSON.stringify(payload);
    setIsSaving(true);
    const result = await onSave(payload, json);
    setIsSaving(false);
    if (result) {
      setSavedGrid(sent);
      setSavedCellSize(cellSize);
      setSavedJson(json);
      setCheck(result);
      setSaveFailed(false);
    } else {
      setSaveFailed(true);
    }
  };

  const copyJson = async () => {
    if (!savedJson) {
      return;
    }
    try {
      await navigator.clipboard.writeText(savedJson);
      setCopied(true);
    } catch {
      // No clipboard over plain HTTP; the text can still be selected by hand.
    }
  };

  const cellAt = (clientX: number, clientY: number): Cell | null => {
    const box = surface.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) {
      return null;
    }
    const col = Math.floor(((clientX - box.left) / box.width) * cols);
    const row = Math.floor(((clientY - box.top) / box.height) * rows);
    return row >= 0 && row < rows && col >= 0 && col < cols ? { row, col } : null;
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // The main button paints, the right one erases.
    if (event.button !== 0 && event.button !== 2) {
      return;
    }
    const cell = cellAt(event.clientX, event.clientY);
    if (!cell) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    // A finger drag never focuses by itself, which would leave a tablet's keyboard
    // open over the grid after typing a department.
    event.currentTarget.focus({ preventScroll: true });
    setIsKeyboard(false);
    setCursor(cell);
    const tile = event.button === 2 ? AISLE : currentTile;
    stroke.current = { tile, last: cell, before: gridRef.current };
    apply(paint(gridRef.current, [cell], tile));
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const cell = cellAt(event.clientX, event.clientY);
    setHover((current) =>
      current?.row === cell?.row && current?.col === cell?.col ? current : cell,
    );
    const current = stroke.current;
    if (!current) {
      return;
    }
    if (!cell) {
      current.last = null;
      return;
    }
    const cells = current.last ? cellsBetween(current.last, cell) : [cell];
    current.last = cell;
    apply(paint(gridRef.current, cells, current.tile));
  };

  const endStroke = () => {
    const current = stroke.current;
    stroke.current = null;
    if (current && gridRef.current !== current.before) {
      remember(current.before);
    }
  };

  const handleGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const arrow = ARROWS[event.key];
    if (arrow) {
      event.preventDefault();
      const next = {
        row: Math.min(rows - 1, Math.max(0, cursor.row + arrow[0])),
        col: Math.min(cols - 1, Math.max(0, cursor.col + arrow[1])),
      };
      setIsKeyboard(true);
      setCursor(next);
      // Shift draws a run as the cursor moves.
      if (event.shiftKey) {
        edit(paint(gridRef.current, [next], currentTile));
      }
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      setIsKeyboard(true);
      edit(paint(gridRef.current, [cursor], currentTile));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      setIsKeyboard(true);
      edit(paint(gridRef.current, [cursor], AISLE));
    }
  };

  const handleShortcut = (event: KeyboardEvent<HTMLElement>) => {
    if (isTyping(event.target)) {
      return;
    }
    // By position, so it works with a Hebrew keyboard layout too.
    if ((event.ctrlKey || event.metaKey) && event.code === "KeyZ") {
      event.preventDefault();
      undo();
      return;
    }
    const kind = TILE_KINDS[Number(event.key) - 1];
    if (kind && !event.ctrlKey && !event.metaKey && !event.altKey) {
      setTool(kind);
    }
  };

  const changeSize = (value: string) => {
    const [nextRows = rows, nextCols = cols] = value.split("x").map(Number);
    if (nextRows !== rows || nextCols !== cols) {
      edit(resize(gridRef.current, nextRows, nextCols));
      setCursor({ row: 0, col: 0 });
    }
  };

  const pickDepartment = (name: string) => {
    setTool("shelf");
    setLabel(name);
  };

  const marker = isKeyboard ? cursor : hover;
  const markedTile = marker ? grid[marker.row]?.[marker.col] : undefined;
  const sizes = SIZES.some(([r, c]) => r === rows && c === cols) ? SIZES : [...SIZES, [rows, cols] as const];

  return (
    <section
      onKeyDown={handleShortcut}
      aria-labelledby={`${inspectorId}-title`}
      className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <h2 id={`${inspectorId}-title`} className="text-lg font-semibold tracking-tight">
            {t.floorEditorTitle}
          </h2>
          <p className="text-sm text-slate-500">{t.floorEditorHint}</p>
          {/* A line of its own, kept even when empty: the first stroke must not move the grid under the finger. */}
          <div className="mt-1 min-h-5">
            <SaveStatus isDirty={isDirty} hasSaved={savedJson !== null} failed={saveFailed} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={undo}
            disabled={past.length === 0}
            className="flex h-11 items-center gap-2 rounded-full bg-white px-4 font-medium ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Undo2 aria-hidden className="size-4 rtl:-scale-x-100" />
            {t.floorUndo}
          </button>
          <button
            type="button"
            onClick={clear}
            className="flex h-11 items-center gap-2 rounded-full bg-white px-4 font-medium text-danger ring-1 ring-slate-200 transition hover:bg-danger-soft"
          >
            <Trash2 aria-hidden className="size-4" />
            {t.floorClear}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={isSaving || cellSize === null}
            className="flex h-11 items-center gap-2 rounded-full bg-brand px-5 font-semibold text-white shadow-sm transition hover:bg-brand-strong disabled:cursor-wait disabled:opacity-70"
          >
            <Save aria-hidden className="size-4" />
            {isSaving ? t.floorSaving : t.floorSave}
          </button>
        </div>
      </header>

      {/* Narrow, the departments go below the grid, since their list grows while painting. */}
      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[17rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
        <div className="flex flex-col gap-5 lg:col-start-1 lg:row-start-1">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-slate-700">{t.floorTools}</legend>
            <div className="grid gap-1.5 sm:grid-cols-3 lg:grid-cols-1">
              {TILE_KINDS.map((kind, index) => {
                const Icon = TOOL_ICONS[kind];
                const isSelected = tool === kind;
                return (
                  <label
                    key={kind}
                    className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 ring-1 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand ${
                      isSelected
                        ? "bg-slate-900 text-white shadow-sm ring-slate-900"
                        : "bg-white text-slate-800 ring-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name={toolGroup}
                      value={kind}
                      checked={isSelected}
                      onChange={() => setTool(kind)}
                      className="sr-only"
                    />
                    <span
                      className={`grid size-8 shrink-0 place-items-center rounded-lg ${TILE_COLOR[kind]} ${
                        kind === "aisle" ? "ring-1 ring-inset ring-slate-300" : ""
                      }`}
                    >
                      <Icon
                        aria-hidden
                        className={`size-4 ${kind === "aisle" ? "text-slate-500" : "text-white"}`}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{t.floorTiles[kind]}</span>
                      <span className={`block text-xs ${isSelected ? "text-white/70" : "text-slate-500"}`}>
                        {isWalkable(makeTile(kind)) ? t.floorWalkable : t.floorBlocked}
                      </span>
                    </span>
                    <kbd
                      aria-hidden
                      className={`grid size-6 place-items-center rounded-md font-sans text-xs ${
                        isSelected ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {index + 1}
                    </kbd>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
            {/* Stays in place for every tool, so picking one never moves the grid. */}
            <label
              className={`flex flex-col gap-1.5 text-sm font-semibold text-slate-700 transition-opacity ${
                tool === "shelf" ? "" : "opacity-50"
              }`}
            >
              {t.floorShelfLabel}
              <input
                type="text"
                list={labelList}
                value={label}
                maxLength={40}
                disabled={tool !== "shelf"}
                onChange={(event) => setLabel(event.target.value)}
                placeholder={t.floorShelfLabelPlaceholder}
                className="h-11 rounded-xl bg-white px-3 font-normal text-slate-900 ring-1 ring-slate-300 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-brand disabled:cursor-not-allowed disabled:bg-slate-50"
              />
              <datalist id={labelList}>
                {suggestions.map(({ value, within }) => (
                  <option key={value} value={value}>
                    {within ? t.floorWithin(within) : undefined}
                  </option>
                ))}
              </datalist>
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-semibold text-slate-700">
              {t.floorSize}
              <select
                value={`${rows}x${cols}`}
                onChange={(event) => changeSize(event.target.value)}
                className="h-11 rounded-xl bg-white px-3 font-normal text-slate-900 ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-brand"
              >
                {sizes.map(([r, c]) => (
                  <option key={`${r}x${c}`} value={`${r}x${c}`}>
                    {r} × {c}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-semibold text-slate-700">
              {t.floorTileSize}
              <span className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  min={MIN_CELL_SIZE_M}
                  max={MAX_CELL_SIZE_M}
                  step={0.05}
                  value={cellSizeText}
                  onChange={(event) => setCellSizeText(event.target.value)}
                  aria-invalid={cellSize === null}
                  aria-describedby={`${inspectorId}-scale`}
                  className="h-11 w-full rounded-xl bg-white ps-3 pe-10 font-normal text-slate-900 ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-brand aria-invalid:ring-2 aria-invalid:ring-danger"
                />
                <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 font-normal text-slate-500">
                  {t.metres}
                </span>
              </span>
              <span
                id={`${inspectorId}-scale`}
                className={`text-xs font-normal ${cellSize === null ? "text-danger" : "text-slate-500"}`}
              >
                {cellSize === null
                  ? t.floorTileSizeInvalid(MIN_CELL_SIZE_M, MAX_CELL_SIZE_M)
                  : t.floorTileSizeHint(cols * cellSize, rows * cellSize)}
              </span>
            </label>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="grid place-items-center rounded-xl bg-slate-50 p-2 ring-1 ring-inset ring-slate-200 sm:p-3">
            {/* A floor plan has no reading direction: column 0 is on the left in either language. */}
            <div
              ref={surface}
              dir="ltr"
              role="application"
              tabIndex={0}
              aria-label={t.floorGridLabel}
              aria-describedby={inspectorId}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              onLostPointerCapture={endStroke}
              onPointerLeave={() => setHover(null)}
              onContextMenu={(event) => event.preventDefault()}
              onKeyDown={handleGridKey}
              onBlur={() => setIsKeyboard(false)}
              className="relative grid cursor-crosshair touch-none gap-px overflow-hidden rounded-lg bg-slate-200 ring-1 ring-slate-300 outline-none select-none focus-visible:ring-2 focus-visible:ring-brand"
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                aspectRatio: `${cols} / ${rows}`,
                width: `min(100%, calc(68dvh * ${cols / rows}))`,
              }}
            >
              {grid.map((tiles, row) => (
                <GridRow key={row} tiles={tiles} row={row} highlight={highlight} />
              ))}
              {marker && (
                <div
                  aria-hidden
                  className={`pointer-events-none absolute rounded-[3px] ring-2 ${
                    isKeyboard ? "ring-brand" : "ring-slate-900/60"
                  }`}
                  style={{
                    left: `${(marker.col / cols) * 100}%`,
                    top: `${(marker.row / rows) * 100}%`,
                    width: `${100 / cols}%`,
                    height: `${100 / rows}%`,
                  }}
                />
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-slate-500">
            <p id={inspectorId} aria-live="polite" className="min-h-5">
              {marker && markedTile
                ? [t.floorCell(marker.row + 1, marker.col + 1), t.floorTiles[markedTile.kind], markedTile.label]
                    .filter(Boolean)
                    .join(" · ")
                : t.floorShortcuts}
            </p>
            <p>{t.floorStats(counts.aisle + counts.entrance, rows * cols - counts.aisle - counts.entrance)}</p>
          </div>

          {/* About the saved plan, so only while the screen still shows it. */}
          {check && !isDirty && <CheckNotes check={check} />}

          {savedJson && (
            <details className="group rounded-xl bg-slate-50 ring-1 ring-slate-200">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 text-sm font-medium text-slate-700">
                <span className="flex-1">{t.floorJson}</span>
                <span className="text-slate-400">{(savedJson.length / 1024).toFixed(1)} KB</span>
              </summary>
              <div className="flex flex-col gap-2 border-t border-slate-200 p-3">
                <pre
                  dir="ltr"
                  className="max-h-48 overflow-auto rounded-lg bg-white p-3 text-xs break-all whitespace-pre-wrap text-slate-700 ring-1 ring-slate-200"
                >
                  {savedJson}
                </pre>
                <button
                  type="button"
                  onClick={() => void copyJson()}
                  className="flex h-11 items-center gap-2 self-start rounded-full bg-white px-4 text-sm font-medium ring-1 ring-slate-200 transition hover:bg-slate-100"
                >
                  {copied ? <Check aria-hidden className="size-4 text-brand" /> : <Copy aria-hidden className="size-4" />}
                  {copied ? t.floorCopied : t.floorCopy}
                </button>
              </div>
            </details>
          )}
        </div>

        <div className="flex flex-col gap-2 lg:col-start-1 lg:row-start-2">
          <h3 className="text-sm font-semibold text-slate-700">{t.floorDepartments}</h3>
          {departments.length === 0 ? (
            <p className="text-sm text-slate-500">{t.floorNoDepartments}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {departments.map(({ label: name, tiles }) => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => pickDepartment(name)}
                    onPointerEnter={() => setHighlight(name)}
                    onPointerLeave={() => setHighlight(null)}
                    onFocus={() => setHighlight(name)}
                    onBlur={() => setHighlight(null)}
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-start text-sm transition hover:bg-slate-50"
                  >
                    <span aria-hidden className="size-3 shrink-0 rounded-sm bg-shelf-strong" />
                    <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                    <span className="text-slate-500">{t.floorTileCount(tiles)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {unlabelled > 0 && (
            <p className="flex items-center gap-2 px-2 text-sm text-slate-500">
              <span aria-hidden className="size-3 shrink-0 rounded-sm bg-shelf" />
              {t.floorUnlabelledShelves(unlabelled)}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/** What the server found in the saved plan: why it can't route, or what shoppers won't reach. */
function CheckNotes({ check }: { check: FloorPlanCheck }) {
  const { t } = useLanguage();
  const notes = [
    ...check.problems.map((problem) => t.floorProblems[problem]),
    ...check.departments.filter((d) => !d.reachable).map((d) => t.floorUnreachable(d.label)),
    ...check.departments
      .filter((d) => d.reachable && d.category_id === null)
      .map((d) => t.floorUnlinked(d.label)),
  ];
  if (notes.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-brand-soft px-4 py-3 text-sm font-medium text-brand-strong">
        <Check aria-hidden className="size-4 shrink-0" />
        {t.floorReady}
      </p>
    );
  }
  return (
    <section
      aria-label={t.floorCheckTitle}
      className={`rounded-xl px-4 py-3 text-sm ring-1 ${
        check.routable ? "bg-next-soft ring-next/40" : "bg-danger-soft ring-danger/30"
      }`}
    >
      <h3 className="mb-1 font-semibold text-slate-800">{t.floorCheckTitle}</h3>
      <ul className="flex flex-col gap-1 text-slate-700">
        {notes.map((note) => (
          <li key={note} className="flex items-start gap-2">
            <CircleAlert
              aria-hidden
              className={`mt-0.5 size-4 shrink-0 ${check.routable ? "text-amber-700" : "text-danger"}`}
            />
            {note}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SaveStatus({ isDirty, hasSaved, failed }: { isDirty: boolean; hasSaved: boolean; failed: boolean }) {
  const { t } = useLanguage();
  if (failed) {
    return <p role="status" className="text-sm font-medium text-danger">{t.floorSaveFailed}</p>;
  }
  if (isDirty) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm font-medium text-amber-700">
        <span aria-hidden className="size-2 rounded-full bg-next" />
        {t.floorUnsaved}
      </p>
    );
  }
  if (hasSaved) {
    return (
      <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-brand">
        <Check aria-hidden className="size-4" />
        {t.floorSaved}
      </p>
    );
  }
  return null;
}

/**
 * One row of tiles, laid straight into the parent grid. Painting copies only the
 * rows it touches, so the rest skip their render.
 */
const GridRow = memo(function GridRow({
  tiles,
  row,
  highlight,
}: {
  tiles: readonly Tile[];
  row: number;
  highlight: string | null;
}) {
  return tiles.map((tile, col) => (
    <div
      key={col}
      data-cell={`${row}-${col}`}
      data-kind={tile.kind}
      className={`grid place-items-center ${
        tile.kind === "shelf" && !tile.label ? "bg-shelf" : TILE_COLOR[tile.kind]
      } ${highlight !== null && tile.label === highlight ? "ring-2 ring-next ring-inset" : ""}`}
    >
      {tile.kind === "entrance" && <DoorOpen aria-hidden className="size-[70%] text-white" />}
      {tile.kind === "checkout" && <ScanBarcode aria-hidden className="size-[70%] text-white" />}
    </div>
  ));
});

function isTyping(target: EventTarget): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  if (target instanceof HTMLInputElement) {
    return !["radio", "checkbox", "button"].includes(target.type);
  }
  return target instanceof HTMLElement && target.isContentEditable;
}

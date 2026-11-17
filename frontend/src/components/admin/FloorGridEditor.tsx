import type { LucideIcon } from "lucide-react";
import {
  BrickWall,
  Check,
  ChevronDown,
  CircleAlert,
  DoorOpen,
  Eraser,
  Info,
  Move,
  Paintbrush,
  Pencil,
  RotateCw,
  Save,
  ScanBarcode,
  Settings2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { CSSProperties, FormEvent, KeyboardEvent, PointerEvent } from "react";
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { FloorPlanCheck } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { Block, Cell, FloorGrid, FloorGridPayload, LabelCount, Tile, TileKind } from "../../lib/admin/floorGrid";
import {
  AISLE,
  blockAt,
  cellsBetween,
  cleanLabel,
  countTiles,
  createGrid,
  findBlocks,
  gridSize,
  makeTile,
  MAX_CELL_SIZE_M,
  MIN_CELL_SIZE_M,
  moveBlock,
  paint,
  parseCellSize,
  resize,
  rotateBlock,
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

/** Picking things up comes first: on a store that's drawn, moving a shelf is what people come to do. */
type Tool = "select" | TileKind;
const TOOLS: readonly Tool[] = ["select", "shelf", "aisle", "wall", "checkout", "entrance"];
const MAIN_TOOLS: readonly Tool[] = ["select", "shelf", "aisle"];
const MORE_TOOLS: readonly Tool[] = ["wall", "checkout", "entrance"];

const TOOL_ICONS: Record<Tool, LucideIcon> = {
  select: Move,
  shelf: Paintbrush,
  aisle: Eraser,
  wall: BrickWall,
  checkout: ScanBarcode,
  entrance: DoorOpen,
};

const TOOL_SWATCH: Record<Tool, string> = {
  select: "bg-indigo-600 text-white",
  shelf: "bg-shelf-strong text-white",
  aisle: "bg-white text-muted ring-1 ring-inset ring-slate-300",
  wall: "bg-ink text-white",
  checkout: "bg-sky-700 text-white",
  entrance: "bg-brand text-white",
};

const TILE_COLOR: Record<TileKind, string> = {
  aisle: "bg-white",
  shelf: "bg-shelf",
  wall: "bg-ink",
  checkout: "bg-sky-700",
  entrance: "bg-brand",
};

/** One colour per department, its areas sharing it, so a glance tells the dairy from the snacks. */
const PALETTE = [
  "#93c5fd",
  "#86efac",
  "#fca5a5",
  "#fcd34d",
  "#c4b5fd",
  "#f9a8d4",
  "#5eead4",
  "#fdba74",
  "#a5b4fc",
  "#bef264",
  "#67e8f9",
  "#d8b4fe",
];
/** A name the catalog doesn't know is striped: no products will be sent there, and it should show. */
const UNKNOWN_FILL = "repeating-linear-gradient(135deg, #fef3c7 0 3px, #fcd34d 3px 6px)";

const ARROWS: Partial<Record<string, readonly [number, number]>> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

const normal = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

interface Areas {
  /** The department a name is in: itself for a department, undefined for a name the catalog doesn't know. */
  departmentOf: (label: string) => string | undefined;
  /** A CSS background for a shelf with this name. */
  fill: (label: string) => string;
}

function useAreas(suggestions: readonly { value: string; within?: string }[]): Areas {
  return useMemo(() => {
    const departmentByName = new Map<string, string>();
    const order: string[] = [];
    for (const { value, within } of suggestions) {
      const department = within ?? value;
      if (!order.includes(department)) order.push(department);
      if (!departmentByName.has(normal(value))) departmentByName.set(normal(value), department);
    }
    const departmentOf = (label: string) => departmentByName.get(normal(label));
    return {
      departmentOf,
      fill: (label) => {
        const department = departmentOf(label);
        return department === undefined ? UNKNOWN_FILL : (PALETTE[order.indexOf(department) % PALETTE.length] ?? UNKNOWN_FILL);
      },
    };
  }, [suggestions]);
}

interface FloorGridEditorProps {
  initialGrid: FloorGrid;
  /** The server's check of `initialGrid`; null when nothing has been saved yet. */
  initialCheck: FloorPlanCheck | null;
  /** Metres one tile stands for on the real floor, as last saved. */
  initialCellSize: number;
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

interface Offset {
  dRow: number;
  dCol: number;
}

interface Drag {
  from: Cell;
  block: Block;
  offset: Offset;
}

/**
 * The store's layout, for the staff who keep it right: tap a shelf and drag it
 * somewhere new, turn it, rename it or take it away; draw a new one by name. Every
 * area is coloured by its department and named on the map, and a name the catalog
 * doesn't know is striped, since no products would be sent there.
 */
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
  const [hasSaved, setHasSaved] = useState(initialCheck !== null);
  // Kept as typed, so "0." on the way to "0.5" isn't rewritten under the cursor.
  const [cellSizeText, setCellSizeText] = useState(String(initialCellSize));
  const [savedCellSize, setSavedCellSize] = useState(initialCellSize);
  const cellSize = parseCellSize(cellSizeText);
  const [check, setCheck] = useState(initialCheck);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // An empty floor starts with drawing; a drawn one with picking things up.
  const [tool, setToolState] = useState<Tool>(() => (countTiles(initialGrid).shelf > 0 ? "select" : "shelf"));
  const [label, setLabel] = useState("");
  const [hover, setHover] = useState<Cell | null>(null);
  const [cursor, setCursor] = useState<Cell>({ row: 0, col: 0 });
  const [isKeyboard, setIsKeyboard] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [selected, setSelected] = useState<Block | null>(null);
  const [dragOffset, setDragOffset] = useState<Offset | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The name being typed for the selected shelf; null when not renaming.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [cellPx, setCellPx] = useState(16);
  const stroke = useRef<Stroke | null>(null);
  const drag = useRef<Drag | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const toolGroup = useId();
  const labelList = useId();
  const nameId = useId();
  const inspectorId = useId();
  const areas = useAreas(suggestions);

  const { rows, cols } = gridSize(grid);
  const counts = useMemo(() => countTiles(grid), [grid]);
  const departments = useMemo(() => shelfLabels(grid), [grid]);
  const named = useMemo(() => findBlocks(grid).filter((block) => block.tile.label), [grid]);
  const unlabelled = counts.shelf - departments.reduce((sum, entry) => sum + entry.tiles, 0);
  const isDirty = grid !== savedGrid || (cellSize !== null && cellSize !== savedCellSize);
  const currentTile = makeTile(tool === "select" ? "aisle" : tool, label);

  // What's selected, as it stands now: undo, or painting over it, can take it away.
  const selection = useMemo(() => {
    const first = selected?.cells[0];
    const tile = first ? grid[first.row]?.[first.col] : undefined;
    return selected && first && tile && tile.kind === selected.tile.kind && tile.label === selected.tile.label
      ? blockAt(grid, first)
      : null;
  }, [grid, selected]);

  // Where a dragged block would land, and whether it may.
  const ghost = useMemo(() => {
    if (!selection || !dragOffset || (dragOffset.dRow === 0 && dragOffset.dCol === 0)) {
      return null;
    }
    return {
      ok: moveBlock(grid, selection, dragOffset.dRow, dragOffset.dCol) !== null,
      cells: selection.cells.map(({ row, col }) => ({ row: row + dragOffset.dRow, col: col + dragOffset.dCol })),
    };
  }, [grid, selection, dragOffset]);

  useEffect(() => {
    if (!isDirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  // A tile's size on screen, for names that fit their shelves and a toolbar that stays on the map.
  useEffect(() => {
    const element = surface.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(([entry]) => entry && setCellPx(entry.contentRect.width / cols));
    observer.observe(element);
    return () => observer.disconnect();
  }, [cols]);

  const setTool = (next: Tool) => {
    setToolState(next);
    setNotice(null);
    setRenaming(null);
    if (next !== "select") {
      setSelected(null);
    }
  };

  const apply = (next: FloorGrid) => {
    gridRef.current = next;
    setGrid(next);
  };

  const remember = (before: FloorGrid) =>
    setPast((current) => [...current.slice(1 - HISTORY_LIMIT), before]);

  /** One step for undo: a click, a key, a move, a clear or a resize. */
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
      setNotice(null);
      setRenaming(null);
    }
  };

  const clear = () => {
    if (counts.aisle !== rows * cols) {
      edit(createGrid(rows, cols));
      setSelected(null);
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
      setHasSaved(true);
      setCheck(result);
      setSaveFailed(false);
    } else {
      setSaveFailed(true);
    }
  };

  // ---- What can be done to a selected block
  const nudge = (dRow: number, dCol: number) => {
    if (!selection) return;
    const moved = moveBlock(gridRef.current, selection, dRow, dCol);
    if (moved) {
      edit(moved.grid);
      setSelected(moved.block);
      setNotice(null);
    } else {
      setNotice(t.floorCantPlace);
    }
  };

  const rotate = () => {
    if (!selection) return;
    const turned = rotateBlock(gridRef.current, selection);
    if (turned) {
      edit(turned.grid);
      setSelected(turned.block);
      setNotice(null);
    } else {
      setNotice(t.floorCantRotate);
    }
  };

  const remove = () => {
    if (!selection) return;
    edit(paint(gridRef.current, selection.cells, AISLE));
    setSelected(null);
    setRenaming(null);
    setNotice(null);
  };

  const rename = (event: FormEvent) => {
    event.preventDefault();
    if (!selection || renaming === null) return;
    const tile = makeTile("shelf", renaming);
    edit(paint(gridRef.current, selection.cells, tile));
    setSelected({ ...selection, tile });
    setRenaming(null);
  };

  /** From the list beside the map: its biggest piece, ready to move. */
  const selectArea = (name: string) => {
    const [biggest] = findBlocks(gridRef.current)
      .filter((block) => block.tile.label === name)
      .sort((a, b) => b.cells.length - a.cells.length);
    setToolState("select");
    setNotice(null);
    setRenaming(null);
    setSelected(biggest ?? null);
    // A long list can carry the map out of view; bring it back to show what was picked.
    surface.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  // ---- Pointer and keys on the map
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
    // open over the grid after typing a name.
    event.currentTarget.focus({ preventScroll: true });
    setIsKeyboard(false);
    setCursor(cell);
    if (tool === "select") {
      if (event.button !== 0) return;
      // Pressing on a block picks it up; on open floor, puts down what was picked.
      const block = blockAt(gridRef.current, cell);
      setNotice(null);
      setRenaming(null);
      setSelected(block);
      if (block) {
        drag.current = { from: cell, block, offset: { dRow: 0, dCol: 0 } };
        setDragOffset({ dRow: 0, dCol: 0 });
      }
      return;
    }
    const tile = event.button === 2 ? AISLE : currentTile;
    stroke.current = { tile, last: cell, before: gridRef.current };
    apply(paint(gridRef.current, [cell], tile));
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const cell = cellAt(event.clientX, event.clientY);
    setHover((current) =>
      current?.row === cell?.row && current?.col === cell?.col ? current : cell,
    );
    const moving = drag.current;
    if (moving) {
      if (cell) {
        const offset = { dRow: cell.row - moving.from.row, dCol: cell.col - moving.from.col };
        if (offset.dRow !== moving.offset.dRow || offset.dCol !== moving.offset.dCol) {
          moving.offset = offset;
          setDragOffset(offset);
        }
      }
      return;
    }
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
    const moving = drag.current;
    drag.current = null;
    if (moving) {
      setDragOffset(null);
      const { dRow, dCol } = moving.offset;
      if (dRow !== 0 || dCol !== 0) {
        const moved = moveBlock(gridRef.current, moving.block, dRow, dCol);
        if (moved) {
          edit(moved.grid);
          setSelected(moved.block);
        } else {
          setNotice(t.floorCantPlace);
        }
      }
      return;
    }
    const current = stroke.current;
    stroke.current = null;
    if (current && gridRef.current !== current.before) {
      remember(current.before);
    }
  };

  const handleGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const arrow = ARROWS[event.key];
    if (tool === "select") {
      if (arrow && selection) {
        event.preventDefault();
        nudge(arrow[0], arrow[1]);
        return;
      }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setIsKeyboard(true);
        setSelected(blockAt(gridRef.current, cursor));
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selection) {
        event.preventDefault();
        remove();
        return;
      }
      if (event.key === "Escape") {
        setSelected(null);
        setNotice(null);
        return;
      }
      if (event.code === "KeyR" && selection && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        rotate();
        return;
      }
    }
    if (arrow) {
      event.preventDefault();
      const next = {
        row: Math.min(rows - 1, Math.max(0, cursor.row + arrow[0])),
        col: Math.min(cols - 1, Math.max(0, cursor.col + arrow[1])),
      };
      setIsKeyboard(true);
      setCursor(next);
      // Shift draws a run as the cursor moves.
      if (event.shiftKey && tool !== "select") {
        edit(paint(gridRef.current, [next], currentTile));
      }
    } else if ((event.key === " " || event.key === "Enter") && tool !== "select") {
      event.preventDefault();
      setIsKeyboard(true);
      edit(paint(gridRef.current, [cursor], currentTile));
    } else if ((event.key === "Delete" || event.key === "Backspace") && tool !== "select") {
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
    const next = TOOLS[Number(event.key) - 1];
    if (next && !event.ctrlKey && !event.metaKey && !event.altKey) {
      setTool(next);
    }
  };

  const changeSize = (value: string) => {
    const [nextRows = rows, nextCols = cols] = value.split("x").map(Number);
    if (nextRows !== rows || nextCols !== cols) {
      edit(resize(gridRef.current, nextRows, nextCols));
      setCursor({ row: 0, col: 0 });
      setSelected(null);
    }
  };

  const nameOfBlock = (block: Block) =>
    block.tile.label ?? (block.tile.kind === "shelf" ? t.floorUnnamed : t.floorTiles[block.tile.kind]);

  const marker = isKeyboard ? cursor : hover;
  const markedTile = marker ? grid[marker.row]?.[marker.col] : undefined;
  const described =
    marker && markedTile
      ? [t.floorCell(marker.row + 1, marker.col + 1), t.floorTiles[markedTile.kind], markedTile.label].filter(Boolean).join(" · ")
      : null;
  const inspector =
    notice ??
    (tool === "select"
      ? selection
        ? t.floorSelected(nameOfBlock(selection), selection.cells.length)
        : t.floorSelectHint
      : (described ?? t.floorShortcuts));
  const sizes = SIZES.some(([r, c]) => r === rows && c === cols) ? SIZES : [...SIZES, [rows, cols] as const];
  const box = (cells: { top: number; left: number; bottom: number; right: number }): CSSProperties => ({
    left: `${(cells.left / cols) * 100}%`,
    top: `${(cells.top / rows) * 100}%`,
    width: `${((cells.right - cells.left + 1) / cols) * 100}%`,
    height: `${((cells.bottom - cells.top + 1) / rows) * 100}%`,
  });
  const shifted = selection && dragOffset
    ? {
        top: selection.top + dragOffset.dRow,
        bottom: selection.bottom + dragOffset.dRow,
        left: selection.left + dragOffset.dCol,
        right: selection.right + dragOffset.dCol,
      }
    : selection;
  const fontSize = Math.max(9, Math.min(15, cellPx * 0.72));

  return (
    <section
      onKeyDown={handleShortcut}
      aria-labelledby={`${inspectorId}-title`}
      className="rounded-3xl bg-surface shadow-sm ring-1 ring-line"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-line p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <h2 id={`${inspectorId}-title`} className="text-lg font-semibold tracking-tight">
            {t.floorEditorTitle}
          </h2>
          <p className="max-w-3xl text-sm text-muted">{t.floorEditorHint}</p>
          {/* A line of its own, kept even when empty: the first stroke must not move the grid under the finger. */}
          <div className="mt-1 min-h-5">
            <SaveStatus isDirty={isDirty} hasSaved={hasSaved} failed={saveFailed} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={undo}
            disabled={past.length === 0}
            className="flex h-11 items-center gap-2 rounded-full bg-white px-4 font-medium ring-1 ring-line transition hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Undo2 aria-hidden className="size-4 rtl:-scale-x-100" />
            {t.floorUndo}
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

      {/* Narrow, the areas go below the grid, since their list grows while painting. */}
      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[17rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
        <div className="flex flex-col gap-5 lg:col-start-1 lg:row-start-1">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink">{t.floorTools}</legend>
            <div className="grid gap-1.5 sm:grid-cols-3 lg:grid-cols-1">
              {MAIN_TOOLS.map((kind) => (
                <ToolOption
                  key={kind}
                  kind={kind}
                  group={toolGroup}
                  shortcut={TOOLS.indexOf(kind) + 1}
                  isSelected={tool === kind}
                  onSelect={setTool}
                />
              ))}
            </div>
            <p className="mt-3 mb-1.5 text-xs font-semibold text-muted">{t.floorMoreTools}</p>
            <div className="grid grid-cols-3 gap-1.5">
              {MORE_TOOLS.map((kind) => (
                <ToolOption
                  key={kind}
                  kind={kind}
                  group={toolGroup}
                  shortcut={TOOLS.indexOf(kind) + 1}
                  isSelected={tool === kind}
                  onSelect={setTool}
                  compact
                />
              ))}
            </div>
          </fieldset>

          {/* Choosing a name means drawing with it. */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className="text-sm font-semibold text-ink">
              {t.floorShelfLabel}
            </label>
            <input
              id={nameId}
              type="text"
              list={labelList}
              value={label}
              maxLength={40}
              onChange={(event) => {
                setLabel(event.target.value);
                if (tool !== "shelf") setTool("shelf");
              }}
              onFocus={() => tool !== "shelf" && setTool("shelf")}
              placeholder={t.floorShelfLabelPlaceholder}
              className="h-11 rounded-2xl bg-surface px-3 font-normal text-ink ring-1 ring-line outline-none placeholder:text-muted focus:ring-2 focus:ring-brand"
            />
            <datalist id={labelList}>
              {suggestions.map(({ value, within }) => (
                <option key={value} value={value}>
                  {within ? t.floorWithin(within) : undefined}
                </option>
              ))}
            </datalist>
            <div className="min-h-10">
              <NameHint label={label} areas={areas} />
            </div>
          </div>

          <details className="group rounded-2xl ring-1 ring-line">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
              <Settings2 aria-hidden className="size-4 text-muted" />
              <span className="flex-1">{t.floorAdvanced}</span>
              <ChevronDown aria-hidden className="size-4 text-muted transition group-open:rotate-180" />
            </summary>
            <div className="flex flex-col gap-4 border-t border-line p-3">
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">
                {t.floorSize}
                <select
                  value={`${rows}x${cols}`}
                  onChange={(event) => changeSize(event.target.value)}
                  className="h-11 rounded-2xl bg-surface px-3 font-normal text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-brand"
                >
                  {sizes.map(([r, c]) => (
                    <option key={`${r}x${c}`} value={`${r}x${c}`}>
                      {r} × {c}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">
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
                    className="h-11 w-full rounded-2xl bg-surface ps-3 pe-10 font-normal text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-brand aria-invalid:ring-2 aria-invalid:ring-danger"
                  />
                  <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 font-normal text-muted">
                    {t.metres}
                  </span>
                </span>
                <span
                  id={`${inspectorId}-scale`}
                  className={`text-xs font-normal ${cellSize === null ? "text-danger" : "text-muted"}`}
                >
                  {cellSize === null
                    ? t.floorTileSizeInvalid(MIN_CELL_SIZE_M, MAX_CELL_SIZE_M)
                    : t.floorTileSizeHint(cols * cellSize, rows * cellSize)}
                </span>
              </label>

              <button
                type="button"
                onClick={clear}
                className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-white px-4 font-medium text-danger ring-1 ring-line transition hover:bg-danger-soft"
              >
                <Trash2 aria-hidden className="size-4" />
                {t.floorClear}
              </button>
            </div>
          </details>
        </div>

        <div className="flex min-w-0 flex-col gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="grid place-items-center rounded-2xl bg-paper p-2 ring-1 ring-inset ring-line sm:p-3">
            {/* The toolbar floats beside the map, not on it, so pressing it never paints. */}
            <div className="relative w-full" style={{ maxWidth: `calc(68dvh * ${cols / rows})` }}>
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
                className={`relative grid w-full scroll-mt-28 touch-none gap-px overflow-hidden rounded-lg bg-slate-200 ring-1 ring-slate-300 outline-none select-none focus-visible:ring-2 focus-visible:ring-brand ${
                  tool === "select" ? (dragOffset ? "cursor-grabbing" : "cursor-pointer") : "cursor-crosshair"
                }`}
                style={{
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                  aspectRatio: `${cols} / ${rows}`,
                }}
              >
                {grid.map((tiles, row) => (
                  <GridRow key={row} tiles={tiles} row={row} highlight={highlight} fill={areas.fill} />
                ))}

                {/* Each area's name on it, sideways on an upright shelf. */}
                {named.map((block) => {
                  const upright = block.bottom - block.top > block.right - block.left;
                  return (
                    <div
                      key={`${block.top}-${block.left}-${block.tile.label}`}
                      aria-hidden
                      data-area-label={block.tile.label}
                      className="pointer-events-none absolute flex items-center justify-center overflow-hidden rounded-[3px] ring-1 ring-black/25 ring-inset"
                      style={box(block)}
                    >
                      <span
                        className="truncate px-0.5 leading-none font-semibold text-slate-900"
                        style={{
                          fontSize,
                          writingMode: upright ? "vertical-rl" : undefined,
                          textShadow: "0 0 3px #fff, 0 0 2px #fff",
                        }}
                      >
                        {block.tile.label}
                      </span>
                    </div>
                  );
                })}

                {ghost?.cells.map(({ row, col }) => (
                  <div
                    key={`${row}-${col}`}
                    aria-hidden
                    className={`pointer-events-none absolute ${ghost.ok ? "bg-brand/55" : "bg-danger/55"}`}
                    style={box({ top: row, bottom: row, left: col, right: col })}
                  />
                ))}
                {shifted && (
                  <div
                    aria-hidden
                    data-selected-block={selection ? nameOfBlock(selection) : undefined}
                    className={`pointer-events-none absolute rounded-[4px] ring-[3px] shadow-[0_0_0_5px_rgba(255,255,255,0.75)] ${
                      ghost && !ghost.ok ? "ring-danger" : "ring-slate-900"
                    }`}
                    style={box(shifted)}
                  />
                )}

                {marker && tool !== "select" && (
                  <div
                    aria-hidden
                    className={`pointer-events-none absolute rounded-[3px] ring-2 ${
                      isKeyboard ? "ring-brand" : "ring-slate-900/60"
                    }`}
                    style={box({ top: marker.row, bottom: marker.row, left: marker.col, right: marker.col })}
                  />
                )}
              </div>

              {selection && !dragOffset && (
                <SelectionToolbar
                  block={selection}
                  name={nameOfBlock(selection)}
                  areas={areas}
                  cellPx={cellPx}
                  cols={cols}
                  labelList={labelList}
                  renaming={renaming}
                  onRenameStart={() => setRenaming(selection.tile.label ?? "")}
                  onRenameChange={setRenaming}
                  onRenameSubmit={rename}
                  onRenameClose={() => setRenaming(null)}
                  onRotate={rotate}
                  onRemove={remove}
                  onClose={() => {
                    setSelected(null);
                    setRenaming(null);
                  }}
                />
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-muted">
            <p id={inspectorId} aria-live="polite" className={`min-h-5 ${notice ? "font-medium text-danger" : ""}`}>
              {inspector}
            </p>
            <p>{t.floorStats(counts.aisle + counts.entrance, rows * cols - counts.aisle - counts.entrance)}</p>
          </div>

          {/* About the saved plan, so only while the screen still shows it. */}
          {check && !isDirty && <CheckNotes check={check} />}
        </div>

        <AreaList
          departments={departments}
          unlabelled={unlabelled}
          areas={areas}
          selected={selection?.tile.label ?? null}
          onSelect={selectArea}
          onHighlight={setHighlight}
        />
      </div>
    </section>
  );
}

interface ToolOptionProps {
  kind: Tool;
  group: string;
  shortcut: number;
  isSelected: boolean;
  compact?: boolean;
  onSelect: (kind: Tool) => void;
}

/** A tool as a card: what it is, and on the main ones, what it does. */
function ToolOption({ kind, group, shortcut, isSelected, compact = false, onSelect }: ToolOptionProps) {
  const { t } = useLanguage();
  const Icon = TOOL_ICONS[kind];
  return (
    <label
      title={compact ? t.floorToolHints[kind] : undefined}
      className={`flex cursor-pointer rounded-xl ring-1 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand ${
        compact ? "min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-center" : "min-h-14 items-center gap-3 px-3 py-2"
      } ${isSelected ? "bg-slate-900 text-white shadow-sm ring-slate-900" : "bg-white text-ink ring-line hover:bg-paper"}`}
    >
      <input
        type="radio"
        name={group}
        value={kind}
        checked={isSelected}
        onChange={() => onSelect(kind)}
        className="sr-only"
      />
      <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${TOOL_SWATCH[kind]}`}>
        <Icon aria-hidden className="size-4" />
      </span>
      {compact ? (
        <span className="text-sm leading-tight font-medium">{t.floorToolNames[kind]}</span>
      ) : (
        <>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t.floorToolNames[kind]}</span>
            <span className={`block text-xs ${isSelected ? "text-white/70" : "text-muted"}`}>{t.floorToolHints[kind]}</span>
          </span>
          <kbd
            aria-hidden
            className={`grid size-6 place-items-center rounded-md font-sans text-xs ${
              isSelected ? "bg-white/15 text-white" : "bg-slate-100 text-muted"
            }`}
          >
            {shortcut}
          </kbd>
        </>
      )}
    </label>
  );
}

/** Under a name: whether products will come to a shelf called that. */
function NameHint({ label, areas, compact = false }: { label: string; areas: Areas; compact?: boolean }) {
  const { t } = useLanguage();
  const name = cleanLabel(label);
  const department = name ? areas.departmentOf(name) : undefined;
  const state = !name ? "empty" : department === undefined ? "unknown" : "known";
  const Icon = state === "known" ? Check : state === "unknown" ? CircleAlert : Info;
  const text =
    state === "known"
      ? t.floorNameKnown(normal(department!) === normal(name!) ? null : department!)
      : state === "unknown"
        ? t.floorNameUnknown
        : t.floorNameEmpty;
  const tone = state === "known" ? "text-brand-strong" : state === "unknown" ? "text-amber-800" : "text-muted";
  return (
    <p data-name-hint={state} className={`flex items-start gap-1.5 text-xs leading-snug ${tone} ${compact ? "max-w-60" : ""}`}>
      <Icon aria-hidden className="mt-px size-3.5 shrink-0" />
      {text}
    </p>
  );
}

interface SelectionToolbarProps {
  block: Block;
  name: string;
  areas: Areas;
  cellPx: number;
  cols: number;
  labelList: string;
  renaming: string | null;
  onRenameStart: () => void;
  onRenameChange: (name: string) => void;
  onRenameSubmit: (event: FormEvent) => void;
  onRenameClose: () => void;
  onRotate: () => void;
  onRemove: () => void;
  onClose: () => void;
}

/** What can be done to the picked-up block, floating just above it, or below it at the top of the map. */
function SelectionToolbar({
  block,
  name,
  areas,
  cellPx,
  cols,
  labelList,
  renaming,
  onRenameStart,
  onRenameChange,
  onRenameSubmit,
  onRenameClose,
  onRotate,
  onRemove,
  onClose,
}: SelectionToolbarProps) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    setWidth(ref.current?.offsetWidth ?? 0);
  }, [name, renaming !== null, t]);

  const mapWidth = cellPx * cols;
  const centre = ((block.left + block.right + 1) / 2) * cellPx;
  const left = Math.min(Math.max(centre - width / 2, 0), Math.max(0, mapWidth - width));
  const above = block.top * cellPx >= 64;
  const style: CSSProperties = above
    ? { left, top: block.top * cellPx - 8, transform: "translateY(-100%)" }
    : { left, top: (block.bottom + 1) * cellPx + 8 };
  const swatch = block.tile.label ? { background: areas.fill(block.tile.label) } : undefined;

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={name}
      data-selection-toolbar
      className="absolute z-10 flex max-w-full items-center gap-1 rounded-2xl bg-white p-1.5 shadow-lg ring-1 ring-black/10"
      style={style}
    >
      {renaming === null ? (
        <>
          <span className="flex min-w-0 items-center gap-2 px-2">
            <span
              aria-hidden
              className={`size-3.5 shrink-0 rounded ${swatch ? "" : TILE_COLOR[block.tile.kind]}`}
              style={swatch}
            />
            <span className="max-w-44 truncate font-semibold">{name}</span>
          </span>
          <span aria-hidden className="mx-0.5 h-7 w-px bg-line" />
          <ToolbarButton icon={RotateCw} label={t.floorRotate} onClick={onRotate} />
          {block.tile.kind === "shelf" && <ToolbarButton icon={Pencil} label={t.floorRename} onClick={onRenameStart} />}
          <ToolbarButton icon={Trash2} label={t.floorRemove} onClick={onRemove} isDanger />
          <button
            type="button"
            aria-label={t.floorDeselect}
            onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-xl text-muted transition hover:bg-paper"
          >
            <X aria-hidden className="size-5" />
          </button>
        </>
      ) : (
        <form onSubmit={onRenameSubmit} className="flex items-start gap-1">
          <div className="flex flex-col gap-1">
            <input
              autoFocus
              aria-label={t.floorRenameLabel}
              list={labelList}
              value={renaming}
              maxLength={40}
              onChange={(event) => onRenameChange(event.target.value)}
              className="h-11 w-60 rounded-xl bg-paper px-3 ring-1 ring-line outline-none focus:ring-2 focus:ring-brand"
            />
            <NameHint label={renaming} areas={areas} compact />
          </div>
          <button
            type="submit"
            aria-label={t.floorRenameSave}
            className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand text-white"
          >
            <Check aria-hidden className="size-5" />
          </button>
          <button
            type="button"
            aria-label={t.floorRenameClose}
            onClick={onRenameClose}
            className="grid size-11 shrink-0 place-items-center rounded-xl text-muted transition hover:bg-paper"
          >
            <X aria-hidden className="size-5" />
          </button>
        </form>
      )}
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  isDanger = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  isDanger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-medium transition ${
        isDanger ? "text-danger hover:bg-danger-soft" : "text-ink hover:bg-paper"
      }`}
    >
      <Icon aria-hidden className="size-4" />
      {label}
    </button>
  );
}

interface AreaListProps {
  departments: readonly LabelCount[];
  unlabelled: number;
  areas: Areas;
  selected: string | null;
  onSelect: (name: string) => void;
  onHighlight: (name: string | null) => void;
}

/** The map's legend: each department's colour and its areas, a tap away from being picked up. */
function AreaList({ departments, unlabelled, areas, selected, onSelect, onHighlight }: AreaListProps) {
  const { t } = useLanguage();
  const groups = useMemo(() => {
    const byDepartment = new Map<string | null, LabelCount[]>();
    for (const entry of departments) {
      const department = areas.departmentOf(entry.label) ?? null;
      byDepartment.set(department, [...(byDepartment.get(department) ?? []), entry]);
    }
    return [...byDepartment].sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)));
  }, [departments, areas]);

  return (
    <div className="flex flex-col gap-2 lg:col-start-1 lg:row-start-2">
      <h3 className="text-sm font-semibold text-ink">{t.floorDepartments}</h3>
      {departments.length === 0 ? (
        <p className="text-sm text-muted">{t.floorNoDepartments}</p>
      ) : (
        // Thirty areas would stretch the page far past the map: the list scrolls on its own.
        <div data-area-list className="-mx-1 flex max-h-[26rem] flex-col gap-2 overflow-y-auto overscroll-contain px-1">
        {groups.map(([department, entries]) => (
          <div key={department ?? ""} className="flex flex-col gap-0.5">
            {/* A department drawn as one shelf under its own name needs no heading over itself. */}
            {!(entries.length === 1 && department !== null && normal(entries[0]?.label ?? "") === normal(department)) && (
            <p className="flex items-center gap-2 px-2 pt-1 text-xs font-semibold text-muted">
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-sm"
                style={{ background: department === null ? UNKNOWN_FILL : areas.fill(department) }}
              />
              {department ?? t.floorUnlinkedGroup}
            </p>
            )}
            <ul className="flex flex-col gap-0.5">
              {entries.map(({ label: name, tiles }) => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => onSelect(name)}
                    onPointerEnter={() => onHighlight(name)}
                    onPointerLeave={() => onHighlight(null)}
                    onFocus={() => onHighlight(name)}
                    onBlur={() => onHighlight(null)}
                    aria-pressed={name === selected}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-start text-sm transition ${
                      name === selected ? "bg-slate-900 text-white" : "hover:bg-paper"
                    }`}
                  >
                    <span aria-hidden className="size-3 shrink-0 rounded-sm" style={{ background: areas.fill(name) }} />
                    <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                    <span className={name === selected ? "text-white/70" : "text-muted"}>{t.floorTileCount(tiles)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        </div>
      )}
      {unlabelled > 0 && (
        <p className="flex items-center gap-2 px-2 text-sm text-muted">
          <span aria-hidden className="size-3 shrink-0 rounded-sm bg-shelf" />
          {t.floorUnlabelledShelves(unlabelled)}
        </p>
      )}
    </div>
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
      <h3 className="mb-1 font-semibold text-ink">{t.floorCheckTitle}</h3>
      <ul className="flex flex-col gap-1 text-ink">
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
  fill,
}: {
  tiles: readonly Tile[];
  row: number;
  highlight: string | null;
  fill: (label: string) => string;
}) {
  return tiles.map((tile, col) => (
    <div
      key={col}
      data-cell={`${row}-${col}`}
      data-kind={tile.kind}
      className={`grid place-items-center ${tile.label ? "" : TILE_COLOR[tile.kind]} ${
        highlight !== null && tile.label === highlight ? "ring-2 ring-next ring-inset" : ""
      }`}
      style={tile.label ? { background: fill(tile.label) } : undefined}
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

import { useEffect, useRef } from "react";
import {
  LocaleType,
  mergeLocales,
  Univer,
  CellValueType,
  type ICellData,
} from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import DesignEn from "@univerjs/design/locale/en-US";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverDocsUIPlugin } from "@univerjs/docs-ui";
import DocsEn from "@univerjs/docs-ui/locale/en-US";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import { UniverFormulaEnginePlugin } from "@univerjs/engine-formula";
import { UniverUIPlugin } from "@univerjs/ui";
import UIEn from "@univerjs/ui/locale/en-US";
import { UniverSheetsPlugin } from "@univerjs/sheets";
import SheetsEn from "@univerjs/sheets/locale/en-US";
import { UniverSheetsUIPlugin } from "@univerjs/sheets-ui";
import SheetsUIEn from "@univerjs/sheets-ui/locale/en-US";
import { UniverSheetsFormulaPlugin } from "@univerjs/sheets-formula";
import { UniverSheetsFormulaUIPlugin } from "@univerjs/sheets-formula-ui";
import FormulaEn from "@univerjs/sheets-formula-ui/locale/en-US";
import { UniverSheetsNumfmtPlugin } from "@univerjs/sheets-numfmt";
import { UniverDataValidationPlugin } from "@univerjs/data-validation";
import { UniverSheetsDataValidationPlugin } from "@univerjs/sheets-data-validation";
import { UniverSheetsDataValidationUIPlugin } from "@univerjs/sheets-data-validation-ui";
import ValidationEn from "@univerjs/sheets-data-validation-ui/locale/en-US";
import "@univerjs/sheets/facade";
import "@univerjs/sheets-ui/facade";
import "@univerjs/ui/facade";
import "@univerjs/sheets-data-validation/facade";
import "@univerjs/design/lib/index.css";
import "@univerjs/ui/lib/index.css";
import "@univerjs/docs-ui/lib/index.css";
import "@univerjs/sheets-ui/lib/index.css";
import "@univerjs/sheets-formula-ui/lib/index.css";
import "@univerjs/sheets-data-validation-ui/lib/index.css";
import {
  columns,
  MAX_ROWS,
  entryCells,
  normalizeDateInput,
  type DraftRow,
  type Entry,
  type Baseline,
  type BatchInput,
} from "../model/rows";
import {
  compactSlots,
  insertSlots,
  removeSlots,
  shiftRows,
  shiftTouched,
} from "../model/row-structure";
import type { components } from "../../../api/generated/schema";

/**
 * Cells that failed validation are tinted rather than annotated: Univer's
 * comment plugin is not installed here, and the message belongs where there is
 * room to read it — the strip above the grid, for whichever row is selected.
 */
const ERROR_CELL_BG = "#fdecec";
const WARNING_CELL_BG = "#fdf3d7";

export interface GridStatus {
  active: number;
  selected: number;
  populated: number;
  dirty: boolean;
}
/** Sheet rows `start`..`end`, inclusive. */
export interface EditedRows {
  start: number;
  end: number;
}
export interface AssigneeEditorAnchor {
  row: number;
  left: number;
  top: number;
}
/**
 * Where to paint the in-cell button: the calendar for Shift Start/End, the
 * employee list for Assignee. Anchored to the cell itself, not to the
 * pointer, so the button keeps sitting in its cell when the selection is
 * moved with the keyboard or the sheet scrolls.
 */
export interface CellAnchor {
  row: number;
  column: number;
  left: number;
  top: number;
  height: number;
  value: string;
}
export interface GridControl {
  accept(
    rows: BatchInput[],
    result: components["schemas"]["ProductionEntryBatchResult"],
  ): void;
  read(): DraftRow[];
  /**
   * `count` rows from sheet row `row`, clipped to the rows that can hold
   * anything. Lets a long job read the sheet in slices instead of one
   * `read()` that blocks the tab.
   */
  readRange(row: number, count: number): DraftRow[];
  readRow(row: number): DraftRow | undefined;
  writeRange(row: number, cells: string[][]): void;
  /**
   * Grows the sheet to hold sheet row `row` before a sliced write. Growing
   * re-points the checkbox validation over the whole column, so doing it
   * once up front instead of once per slice keeps a long write linear.
   */
  reserveRows(row: number): void;
  finish(): Promise<unknown>;
  select(row: number): void;
  selected(): DraftRow[];
  selectAll(value: boolean): void;
  selectRow(row: number, value: boolean): void;
  isSelected(row: number): boolean;
  /**
   * Deletes these draft rows from the sheet — the rows below move up, the
   * same as Delete row in the right-click menu. Saved rows are never removed
   * (Batalkan keeps their audit trail). Returns how many rows went.
   */
  removeDrafts(keys: readonly string[]): number;
  write(row: number, cells: string[]): void;
  /**
   * Adds `count` empty rows at the bottom of the sheet ("Add 1000 more rows
   * at the bottom"). Stops at capacity; returns how many were added.
   */
  appendRows(count: number): number;
  activeCell(): { row: number; column: number };
  /**
   * Paints the cells that failed validation, replacing any previous marks.
   * Pass an empty list to clear them all. `warnings` are tinted amber: worth a
   * look, not a refusal. A cell in both lists shows red.
   */
  markErrors(
    cells: readonly { row: number; column: number }[],
    warnings?: readonly { row: number; column: number }[],
  ): void;
}
interface Props {
  entries: Entry[];
  names: ReadonlyMap<string, string>;
  editable: boolean;
  onReady(control: GridControl | null): void;
  onStatus(status: GridStatus): void;
  onAssignee(anchor: AssigneeEditorAnchor | null): void;
  onCellTrigger(anchor: CellAnchor | null): void;
  onPaste(text: string): void;
  /** A spreadsheet action this workspace had to refuse, and why. */
  onBlocked(message: string): void;
  /**
   * Rows were inserted (`delta` positive) or deleted (`delta` negative) at
   * sheet row `from`, so anything the page remembers by row number has moved.
   */
  onRowsShifted(from: number, delta: number): void;
  /**
   * Many scattered sheet rows (ascending) were removed in one step; anything
   * remembered by row number drops those rows and moves up by the removed
   * rows above it. See `removeDrafts`.
   */
  onRowsRemoved(rows: readonly number[]): void;
  /**
   * Cell values changed — typed, filled, undone — in these sheet rows
   * (inclusive). Not called for `writeRange`, whose caller validates what it
   * wrote, nor for a checkbox: neither can fix a problem cell.
   */
  onEdited(rows: readonly EditedRows[]): void;
}

/**
 * Above this many separate bands, `removeDrafts` stops running one Univer
 * remove-row command per band. Measured: 1.000 bands on the 100.000-row sheet
 * ran the tab out of memory ("Aw, Snap!" error 5) — each command snapshots
 * undo state and rewrites the checkbox validation for the whole sheet. Below
 * it the native command is kept, because it stays undoable.
 */
const NATIVE_REMOVE_MAX_BANDS = 20;
/**
 * Empty rows kept below the data. The sheet used to open with all 100.000
 * rows of capacity, so a page of 300 rows scrolled through 99.700 blank ones
 * and the scrollbar said nothing about how much data there was. Now it is
 * the data plus this much room, growing as rows are reached; capacity
 * (MAX_ROWS) is unchanged.
 */
const SPARE_ROWS = 50;
/** Sheet length, header included, for data reaching `row`. */
function sheetRowsFor(row: number) {
  return Math.min(MAX_ROWS, Math.max(0, row) + SPARE_ROWS) + 1;
}
const UNDO_COMMANDS = new Set(["univer.command.undo", "univer.command.redo"]);

/** Shift Start and Shift End — the two columns that hold a timestamp. */
const DATE_COLUMNS = [1, 2];
const ASSIGNEE_COLUMN = 4;
/** Matches the workbook's `freeze` below: the header row and the select column. */
const FROZEN_ROWS = 1;
const FROZEN_COLUMNS = 1;
/** Set explicitly so `fitColumns` can subtract it instead of guessing. */
const ROW_HEADER_WIDTH = 46;
/**
 * Minimum width per column, and the share of any leftover width it takes.
 *
 * The weights are not even. Assignee is the only column whose content has no
 * fixed length, and it was truncating names ("Muhammad Nasrudin Dzul Fikri ·
 * 7812") while nearly 400px of blank canvas sat to the right of the last
 * column — a dead zone that made the sheet look broken next to the side panel.
 * The timestamps and Result take the remainder so the sheet always ends where
 * its container ends. Station, Width and Weft never grow: they hold two or
 * three characters and widening them only pushes everything else in.
 */
/*
  Minimum widths, not widths: `fitColumns` hands out whatever is left by the
  grow weights. They were lowered when the controls moved into a right-hand
  column (2026-09-29) so all seven columns fit from 1280px without a
  horizontal scroll: "2026-09-04 07:00:00" measures ~135px, so 150px still
  shows a timestamp whole.
*/
const COLUMN_LAYOUT = [
  { w: 55, grow: 0 }, // Pilih
  { w: 150, grow: 1 }, // Shift Start
  { w: 150, grow: 1 }, // Shift End
  { w: 70, grow: 0 }, // Station
  { w: 180, grow: 3 }, // Assignee
  { w: 85, grow: 0 }, // Width
  { w: 85, grow: 0 }, // Weft
  { w: 95, grow: 1 }, // Result
];
const COLUMN_BASE = COLUMN_LAYOUT.reduce((sum, column) => sum + column.w, 0);
const COLUMN_GROW = COLUMN_LAYOUT.reduce((sum, column) => sum + column.grow, 0);

/**
 * Univer's own right-click menu is on, so the sheet answers the reflexes
 * admins bring from a spreadsheet. It is not a free-form workbook though:
 * seven fixed columns, one sheet, and a row whose identity is its position.
 * The lists below are where that line is drawn.
 *
 * Rows really are inserted and deleted — `applyRowShift` moves the row-indexed
 * bookkeeping with them. What stays refused is everything that rearranges
 * cells *within* a row: a column insert, a "shift cells up", a move, a sort, a
 * merge. Each of those would leave a value under the wrong field, which is a
 * worse outcome than the action being unavailable.
 */
const ROW_INSERT_COMMANDS = new Set([
  // A menu entry runs one of the named variants, and every one of those then
  // delegates to the plain `insert-row` / `remove-row` underneath. Both levels
  // pass through this guard, so both have to be listed: allowing only the
  // named one lets the menu item "work" while the command doing the job is
  // refused, which is exactly the silent no-op this guard exists to avoid.
  "sheet.command.insert-row",
  "sheet.command.insert-row-before",
  "sheet.command.insert-row-after",
  "sheet.command.insert-multi-rows-above",
  "sheet.command.insert-multi-rows-after",
  "sheet.command.insert-row-by-range",
]);
const ROW_REMOVE_COMMANDS = new Set([
  "sheet.command.remove-row",
  "sheet.command.remove-row-confirm",
  "sheet.command.remove-row-by-range",
]);
/**
 * Structural commands the pattern below does not catch by name. Each is
 * reachable from the right-click menu or from the shortcuts Univer registers
 * whether or not a menu entry for it is shown.
 */
const BLOCKED_COMMANDS = new Set([
  "sheet.command.delete-range-move-left",
  "sheet.command.delete-range-move-up",
  "sheet.command.delete-range-move-left-confirm",
  "sheet.command.delete-range-move-up-confirm",
  "sheet.command.insert-range-move-down-confirm",
  "sheet.command.insert-range-move-right-confirm",
  "sheet.command.remove-col-confirm",
  "sheet.command.reorder-range",
  "sheet.command.add-worksheet-merge",
  "sheet.command.add-worksheet-merge-all",
  "sheet.command.add-worksheet-merge-vertical",
  "sheet.command.add-worksheet-merge-horizontal",
  "sheet.command.remove-worksheet-merge",
  // A hidden row still counts in the numbering the problem panel prints, so
  // "baris 9.115" would point at a row nobody can see.
  "sheet.command.hide-row-confirm",
  "sheet.command.hide-col-confirm",
  "sheet.command.set-rows-hidden",
  "sheet.command.set-col-hidden",
]);
const STRUCTURAL_COMMAND =
  /^sheet\.command\..*(insert|remove|move|sort|merge).*(row|col|range|sheet)/;
/**
 * Paste goes through the page's `applyRows` instead of Univer's own writer:
 * that is the one path that normalises decimal commas and single-digit hours
 * and resolves an EID to a PIN before the cells are written. Every "Paste
 * special" entry delegates to `univer.command.paste`, so cancelling that
 * covers them all.
 */
const PASTE_COMMANDS = new Set([
  "univer.command.paste",
  "sheet.command.paste-by-short-key",
]);
/**
 * Menu entries whose command is refused above, plus the ones promising
 * something this workspace cannot keep.
 *
 * Freeze is on the list because the frozen header row and select column are
 * what the date affordance measures against, and a sheet whose header scrolls
 * away is not a better sheet. Range protection is on it because it would only
 * live in this browser tab until the next reload.
 */
const HIDDEN_MENU_ITEMS: Record<string, { hidden: true }> = Object.fromEntries(
  [
    ...BLOCKED_COMMANDS,
    "sheet.command.insert-col-before",
    "sheet.command.insert-col-after",
    "sheet.command.insert-multi-cols-before",
    "sheet.command.insert-multi-cols-right",
    "sheet.command.set-selected-rows-visible",
    "sheet.command.set-selected-cols-visible",
    "sheet.contextMenu.permission",
    "sheet.command.add-range-protection-from-toolbar",
    "sheet.menu.sheet-frozen",
    "sheet.row-header-menu.sheet-frozen",
    "sheet.column-header-menu.sheet-frozen",
  ].map((id) => [id, { hidden: true } as const]),
);

/** A command payload carrying the rows it is about. */
function rangeParam(params: unknown):
  | {
      startRow: number;
      endRow: number;
      startColumn?: number;
      subUnitId?: string;
    }
  | undefined {
  if (!params || typeof params !== "object") return undefined;
  const range = (params as { range?: unknown }).range;
  if (!range || typeof range !== "object") return undefined;
  const { startRow, endRow, startColumn } = range as {
    startRow?: unknown;
    endRow?: unknown;
    startColumn?: unknown;
  };
  if (typeof startRow !== "number" || typeof endRow !== "number")
    return undefined;
  const subUnitId = (params as { subUnitId?: unknown }).subUnitId;
  return {
    startRow,
    endRow,
    ...(typeof startColumn === "number" ? { startColumn } : {}),
    ...(typeof subUnitId === "string" ? { subUnitId } : {}),
  };
}

/**
 * Strips what `insert-row` would copy onto the rows it creates.
 *
 * It carries the reference row's formatting, and directly under the frozen
 * header that reference is the header itself — a new draft row would arrive
 * wearing the green title style and covering its own gridlines. Rewritten in
 * the payload rather than cleared by a second command afterwards, which would
 * cost the admin an extra Ctrl+Z to undo one insert.
 */
function prepareInsertedRows(params: unknown) {
  const target = rangeParam(params);
  if (!target || !params || typeof params !== "object") return;

  (params as { cellValue?: unknown }).cellValue = {};
  delete (params as { rowInfo?: unknown }).rowInfo;
}

/*
 * Known limit, measured against Univer 0.25.1: a row inserted directly under
 * the frozen header arrives without the select checkbox, and stays that way
 * until the page is reloaded. Rows inserted anywhere else keep theirs.
 *
 * The cell does hold its 0 and the validation rule does cover it — writing the
 * value again, re-pointing the rule's ranges, deleting and recreating the
 * rule, forcing a repaint and re-applying the freeze were all tried, and none
 * of them makes that one row paint. The row still saves and can still be
 * ticked from the row editor, so the insert is left available rather than
 * refused for one position.
 */

/** Data columns (1..7 in the sheet): Shift Start … Result. */
const FIRST_DATA_COLUMN = 1;
const LAST_DATA_COLUMN = 7;

/**
 * A typed cell as the text the rest of the grid reads.
 *
 * Every value this grid writes is a STRING, but a cell typed by hand went
 * through Univer's own detection: "10.000" became the NUMBER 10, "56.10"
 * became 56.1. Mixed types made the same figure compare unequal to its
 * baseline and turned a typed serial into a number nobody could read. A
 * number in a date column is a spreadsheet day serial; it is shown as the
 * wall-clock text the validator expects.
 */
function asText(cell: ICellData, column: number): ICellData | null {
  if (cell.f || cell.v === null || cell.v === undefined) return null;
  if (cell.t === CellValueType.STRING) return null;
  const text = String(cell.v);
  const v =
    cell.t === CellValueType.NUMBER && DATE_COLUMNS.includes(column)
      ? normalizeDateInput(text)
      : text;
  return { v, t: CellValueType.STRING };
}

/**
 * Forces the cell values of a `set-range-values` command to text before
 * Univer types them. Mutates the payload, like `prepareInsertedRows`, so the
 * edit stays one undo step. Handles the single-cell shape the in-cell editor
 * sends; matrices (fill, clear) are caught after the fact by `asText`.
 */
function forceTextValues(params: unknown) {
  if (!params || typeof params !== "object") return;
  const range = rangeParam(params);
  const value = (params as { value?: unknown }).value;
  if (!range || !value || typeof value !== "object") return;
  const single =
    range.startRow === range.endRow &&
    "v" in value &&
    !("f" in value && (value as ICellData).f);
  const column = (range as { startColumn?: number }).startColumn;
  if (
    !single ||
    column === undefined ||
    column < FIRST_DATA_COLUMN ||
    column > LAST_DATA_COLUMN
  )
    return;
  const cell = value as ICellData;
  if (cell.v === null || cell.v === undefined) return;
  cell.v = String(cell.v);
  cell.t = CellValueType.STRING;
}

/** The text Univer already read from the clipboard, when it read any. */
function pastedText(params: unknown): string | undefined {
  if (!params || typeof params !== "object") return undefined;
  const text = (params as { textContent?: unknown }).textContent;
  return typeof text === "string" ? text : undefined;
}

export function UniverGrid({
  entries,
  names,
  editable,
  onReady,
  onStatus,
  onAssignee,
  onCellTrigger,
  onPaste,
  onBlocked,
  onRowsShifted,
  onRowsRemoved,
  onEdited,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  /**
   * `editable` is read through a ref, not captured by the mount effect:
   * closing a book flips it, and rebuilding the workbook for that threw the
   * whole unsaved draft away. The effect below applies it in place.
   */
  const editableRef = useRef(editable);
  const workbookRef = useRef<{ setEditable(value: boolean): unknown } | null>(
    null,
  );
  /** True while Univer's in-cell editor is open; paste then belongs to it. */
  const editingRef = useRef(false);
  const pointer = useRef<
    { clientX: number; clientY: number; time: number } | undefined
  >(undefined);
  const callbacks = useRef({
    onStatus,
    onAssignee,
    onCellTrigger,
    onPaste,
    onBlocked,
    onRowsShifted,
    onRowsRemoved,
    onEdited,
  });
  useEffect(() => {
    callbacks.current = {
      onStatus,
      onAssignee,
      onCellTrigger,
      onPaste,
      onBlocked,
      onRowsShifted,
      onRowsRemoved,
      onEdited,
    };
  }, [
    onStatus,
    onAssignee,
    onCellTrigger,
    onPaste,
    onBlocked,
    onRowsShifted,
    onRowsRemoved,
    onEdited,
  ]);
  useEffect(() => {
    editableRef.current = editable;
    workbookRef.current?.setEditable(editable);
    if (!editable) {
      callbacks.current.onCellTrigger(null);
      callbacks.current.onAssignee(null);
    }
  }, [editable]);
  useEffect(() => {
    if (!host.current) return;
    const container = document.createElement("div");
    container.className = "manual-grid-engine";
    host.current.append(container);
    const univer = new Univer({
      locale: LocaleType.EN_US,
      locales: {
        [LocaleType.EN_US]: mergeLocales(
          DesignEn,
          UIEn,
          DocsEn,
          SheetsEn,
          SheetsUIEn,
          FormulaEn,
          ValidationEn,
        ),
      },
    });
    univer.registerPlugin(UniverRenderEnginePlugin);
    univer.registerPlugin(UniverFormulaEnginePlugin);
    univer.registerPlugin(UniverUIPlugin, {
      container,
      // No ribbon, no formula bar, no sheet tabs: the page's own toolbar is
      // the one place actions live. What IS on is Univer's right-click menu —
      // copy, cut, paste, clear, insert and delete rows — because those are
      // the spreadsheet reflexes people bring with them, and rebuilding them
      // as page buttons would be a worse copy of what the grid already has.
      header: false,
      toolbar: false,
      contextMenu: true,
      // The entries that cannot work here are hidden by id rather than left to
      // fail silently: a menu item that does nothing reads as a broken app.
      menu: HIDDEN_MENU_ITEMS,
      disableAutoFocus: true,
    });
    univer.registerPlugin(UniverDocsPlugin);
    univer.registerPlugin(UniverDocsUIPlugin);
    univer.registerPlugin(UniverSheetsPlugin);
    univer.registerPlugin(UniverSheetsUIPlugin, {
      footer: false,
      // These columns intentionally preserve decimal/date-looking input as
      // text until our domain validator runs. Univer's generic force-text
      // warning is not actionable for payroll admins.
      disableForceStringAlert: true,
      disableForceStringMark: true,
    });
    univer.registerPlugin(UniverSheetsFormulaPlugin);
    univer.registerPlugin(UniverSheetsFormulaUIPlugin);
    univer.registerPlugin(UniverSheetsNumfmtPlugin);
    univer.registerPlugin(UniverDataValidationPlugin);
    univer.registerPlugin(UniverSheetsDataValidationPlugin);
    univer.registerPlugin(UniverSheetsDataValidationUIPlugin);
    const api = FUniver.newAPI(univer);
    const data: Record<number, Record<number, ICellData>> = {};
    data[0] = Object.fromEntries(
      ["Pilih", ...columns].map((label, col) => [
        col,
        {
          v: label,
          t: CellValueType.STRING,
          s: { bg: { rgb: "#e8eeeb" }, bl: 1, cl: { rgb: "#253c32" } },
        },
      ]),
    );
    /**
     * Kunci baris dibuat malas. Membuat 100.000 UUID di awal memakan ratusan
     * milidetik dan memori untuk baris yang mungkin tidak pernah disentuh.
     */
    const keys: (string | undefined)[] = [];
    const keyIndex = new Map<string, number>();
    const originals: (Baseline | undefined)[] = [...entries];
    /**
     * A saved row's key is its id — but read from `originals`, which moves
     * with inserts and deletes, never from `entries`, which does not. After a
     * row is inserted above saved rows, `entries[index]` is the row that used
     * to sit there and has since moved down; the new empty slot took its id
     * and two rows shared one key.
     */
    function keyAt(index: number): string {
      const existing = keys[index];
      if (existing) return existing;

      const key = originals[index]?.id ?? crypto.randomUUID();
      keys[index] = key;
      keyIndex.set(key, index);
      return key;
    }
    const baselineCells: (string[] | undefined)[] = [];

    /**
     * Baris terakhir yang mungkin berisi sesuatu. Semua pemindaian berhenti di
     * sini, bukan di kapasitas: itu yang membuat kapasitas 100.000 tetap murah
     * selama halaman cuma memuat beberapa ratus baris.
     */
    let touched = entries.length;
    /** Filled once the sheet exists; see `ensureRows`. */
    const growth: { to?: (row: number) => void } = {};
    const reach = (row: number) => {
      touched = Math.max(touched, Math.min(row, MAX_ROWS));
      growth.to?.(row);
    };

    // `cellData` Univer bersifat sparse: baris kosong sengaja tidak ditulis.
    // Kolom checkbox tetap dapat nilai supaya kotaknya tergambar sejak awal.
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!;
      const cells = entryCells(entry, names.get(entry.pin));
      keyAt(index);
      baselineCells[index] = cells;
      data[index + 1] = {
        0: { v: 0, t: CellValueType.NUMBER },
        ...Object.fromEntries(
          cells.map((v, col) => [col + 1, { v, t: CellValueType.STRING }]),
        ),
      };
    }
    const workbook = api.createWorkbook({
      id: crypto.randomUUID(),
      name: "Manual Data",
      locale: LocaleType.EN_US,
      sheetOrder: ["manual"],
      sheets: {
        manual: {
          id: "manual",
          name: "Manual Data",
          rowCount: sheetRowsFor(entries.length),
          columnCount: 8,
          defaultRowHeight: 34,
          defaultColumnWidth: 120,
          cellData: data,
          columnData: Object.fromEntries(
            COLUMN_LAYOUT.map((column, index) => [index, { w: column.w }]),
          ),
          freeze: {
            startRow: 1,
            startColumn: 1,
            xSplit: 1,
            ySplit: 1,
          },
        },
      },
    });
    const sheet = workbook.getActiveSheet();
    sheet.setRowHeaderWidth(ROW_HEADER_WIDTH);
    /**
     * Keeps SPARE_ROWS empty rows below the furthest row anyone has reached —
     * by cursor, typing, paste, or import — so the sheet is always as long as
     * its data plus room to add, never the full capacity up front.
     */
    function ensureRows(row: number) {
      const needed = sheetRowsFor(row);
      if (sheet.getMaxRows() < needed) setSheetRows(needed);
    }
    /** Sheet length, header included; never past capacity. */
    function setSheetRows(total: number) {
      const rows = Math.min(total, MAX_ROWS + 1);
      sheet.setRowCount(rows);
      // One checkbox rule, re-pointed — not a new rule per growth step.
      sheet
        .getRange(1, 0, 1, 1)
        .getDataValidation()
        ?.setRanges([sheet.getRange(1, 0, rows - 1, 1)]);
    }
    growth.to = ensureRows;
    /**
     * Spreads whatever width the container has beyond the column minimums.
     * Only ever grows — a container narrower than the minimums keeps them and
     * scrolls, which is what `.manual-grid`'s own `min-width` already assumes.
     */
    function fitColumns() {
      const available = host.current?.clientWidth ?? 0;
      // Clamped, not returned early: opening the side panel narrows the grid,
      // and bailing out here would leave the columns at the width they had
      // when the panel was closed — permanent horizontal scroll.
      const surplus = Math.max(0, available - ROW_HEADER_WIDTH - COLUMN_BASE);
      COLUMN_LAYOUT.forEach((column, index) => {
        const width =
          column.w + Math.floor((surplus * column.grow) / COLUMN_GROW);
        // Guarded so a resize that changes nothing issues no command at all —
        // ResizeObserver fires on mount and on every layout pass.
        if (sheet.getColumnWidth(index) !== width) {
          sheet.setColumnWidth(index, width);
        }
      });
    }
    fitColumns();
    const resize = new ResizeObserver(fitColumns);
    if (host.current) resize.observe(host.current);
    // Covers the rows the sheet has; `ensureRows` stretches it as it grows.
    sheet
      .getRange(1, 0, sheet.getMaxRows() - 1, 1)
      .setDataValidation(
        api.newDataValidation().requireCheckbox("1", "0").build(),
      );
    // Applying the explicit mode also makes Univer recalculate/render the canvas.
    workbook.setEditable(editableRef.current);
    workbookRef.current = workbook;
    let active = 1;
    let column = 1;
    let frame = 0;
    let disposed = false;
    function openAssignee(row: number) {
      const bounds = host.current?.getBoundingClientRect();
      if (!bounds) return;
      const lastPointer = pointer.current;
      const isFresh =
        lastPointer !== undefined &&
        performance.now() - lastPointer.time < 1000;
      const x = isFresh
        ? lastPointer.clientX - bounds.left
        : bounds.width * 0.55;
      const y = isFresh ? lastPointer.clientY - bounds.top : 72;
      callbacks.current.onAssignee({
        row,
        // Keep the server-backed picker inside the visible grid viewport.
        left: Math.max(4, Math.min(x - 96, bounds.width - 356)),
        top: Math.max(4, Math.min(y + 18, bounds.height - 320)),
      });
    }
    /**
     * Univer draws the sheet on a canvas, so the icon cannot live inside the
     * cell — it is an HTML button painted over the cell's own rectangle.
     * `getCellRect` is measured against the grid host, so the anchor survives
     * scrolling and keyboard navigation, unlike the pointer-based assignee
     * popover.
     */
    function showCellTrigger(row: number, col: number) {
      const assignee = col === ASSIGNEE_COLUMN;
      if (
        !editableRef.current ||
        row < 1 ||
        (!assignee && !DATE_COLUMNS.includes(col))
      ) {
        callbacks.current.onCellTrigger(null);
        return;
      }
      // Saved rows keep both buttons: a shift typed into the wrong row is
      // corrected in place, and Simpan sends that row as an inline edit so it
      // keeps its id and history (see `patchProduction`).
      const rect = sheet.getRange(row, col).getCellRect();
      if (!rect || rect.width === 0) {
        callbacks.current.onCellTrigger(null);
        return;
      }
      /*
       * `getCellRect` measures against the sheet content, so it only matches
       * the screen while the sheet is unscrolled. Converting by row height
       * would bake in an assumption that every row is 34px; this instead
       * measures the cell relative to the first cell currently at the top-left
       * of the scrollable area, which stays true whatever the sizes are.
       */
      const scroll = sheet.getScrollState();
      const origin = sheet.getRange(FROZEN_ROWS, FROZEN_COLUMNS).getCellRect();
      // `sheetViewStart*` is counted as if nothing were frozen, so the cell
      // actually sitting at the top-left of the scrollable area is that many
      // rows/columns further in.
      const start = sheet
        .getRange(
          scroll.sheetViewStartRow + FROZEN_ROWS,
          scroll.sheetViewStartColumn + FROZEN_COLUMNS,
        )
        .getCellRect();
      if (!origin || !start) {
        callbacks.current.onCellTrigger(null);
        return;
      }
      const top = origin.top + (rect.top - start.top) - scroll.offsetY;
      const left =
        origin.left + (rect.left - start.left) - scroll.offsetX + rect.width;
      // Row 0 and column 0 are frozen, so they mark where the scrollable area
      // begins on screen. A cell scrolled underneath them must not leave its
      // icon stranded over the frozen header.
      const frozen = sheet.getRange(0, 0).getCellRect();
      if (frozen && (top < frozen.bottom || left < frozen.right)) {
        callbacks.current.onCellTrigger(null);
        return;
      }
      const cell = sheet.getRange(row, col).getCellData();
      callbacks.current.onCellTrigger({
        row,
        column: col,
        left,
        top,
        height: rect.height,
        value: String(cell?.v ?? ""),
      });
    }
    /**
     * Hanya baris yang pernah tersentuh. Baris di luar jendela ini dijamin
     * kosong dan tanpa baseline, jadi memindainya tidak menambah informasi —
     * cuma biaya, dan biaya itu yang dulu membatasi kapasitas grid.
     */
    function read(): DraftRow[] {
      return readRange(1, touched);
    }
    function readRange(row: number, count: number): DraftRow[] {
      const first = Math.max(0, row - 1);
      const length = Math.min(first + count, touched) - first;
      if (length < 1) return [];

      const matrix = sheet.getRange(first + 1, 1, length, 7).getCellDatas();
      return Array.from({ length }, (_, offset) => {
        const index = first + offset;
        return {
          key: keyAt(index),
          cells: Array.from({ length: 7 }, (_, col) => {
            const cell = matrix[offset]?.[col];
            return cell?.f ? cell.f : String(cell?.v ?? "");
          }),
          ...(originals[index] ? { original: originals[index] } : {}),
        };
      });
    }
    /*
     * What the status line counts, kept per row (index = sheet row - 1) and
     * updated from the rows each change touched.
     *
     * It used to be recounted from a full `read()` plus a `getValues` of the
     * whole checkbox column after every change. Measured at 100.000 rows that
     * was most of a 450-700 ms freeze per typed cell — the read builds an
     * object per row, and `getValues` on the checkbox column runs the
     * data-validation renderer for every cell of it.
     *
     * The slots move with inserts and deletes exactly like `keys` and
     * `baselineCells`, so a structural change costs a splice, not a rescan.
     */
    const filled: (true | undefined)[] = [];
    const changed: (true | undefined)[] = [];
    const checked: (true | undefined)[] = [];
    let filledCount = 0;
    let changedCount = 0;
    let checkedCount = 0;
    /** Flips one slot and returns how the slot's count moves. */
    function setSlot(slots: (true | undefined)[], index: number, on: boolean) {
      if (on === (slots[index] === true)) return 0;
      slots[index] = on ? true : undefined;
      return on ? 1 : -1;
    }
    function setFilled(index: number, on: boolean) {
      filledCount += setSlot(filled, index, on);
    }
    function setChanged(index: number, on: boolean) {
      changedCount += setSlot(changed, index, on);
    }
    function setChecked(index: number, on: boolean) {
      checkedCount += setSlot(checked, index, on);
    }
    /** Drops `count` slots at `index` from the counts, before they are spliced out. */
    function forgetSlots(index: number, count: number) {
      for (let offset = 0; offset < count; offset++) {
        setFilled(index + offset, false);
        setChanged(index + offset, false);
        setChecked(index + offset, false);
      }
    }
    const isChecked = (value: unknown) =>
      value === true || value === 1 || value === "1";
    /** Recounts rows `from`..`to` (indices, inclusive) from the sheet. */
    function recountCells(from: number, to: number) {
      const last = Math.min(to, touched - 1);
      if (last < from) return;
      const matrix = sheet
        .getRange(from + 1, 1, last - from + 1, 7)
        .getCellDatas();
      for (let index = from; index <= last; index++) {
        const row = matrix[index - from];
        const baseline = baselineCells[index];
        let any = false;
        let differs = false;
        for (let col = 0; col < 7; col++) {
          const cell = row?.[col];
          const text = cell?.f ? cell.f : String(cell?.v ?? "");
          if (text) any = true;
          if (baseline && text !== (baseline[col] ?? "")) differs = true;
        }
        setFilled(index, any);
        setChanged(index, baseline ? differs : any);
      }
    }
    function recountChecks(from: number, to: number) {
      const last = Math.min(to, touched - 1);
      if (last < from) return;
      const matrix = sheet
        .getRange(from + 1, 0, last - from + 1, 1)
        .getCellDatas();
      for (let index = from; index <= last; index++)
        setChecked(index, isChecked(matrix[index - from]?.[0]?.v));
    }
    /** Index ranges, inclusive, still to be recounted on the next frame. */
    let pendingCells: [number, number][] = [];
    let pendingChecks: [number, number][] = [];
    /** Overlapping and adjacent ranges as one, so a row is read once. */
    function coalesce(ranges: [number, number][]) {
      const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
      const merged: [number, number][] = [];
      for (const [from, to] of sorted) {
        const last = merged.at(-1);
        if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
        else merged.push([from, to]);
      }
      return merged;
    }
    /** Queues the rows of these sheet ranges to be recounted. */
    function enqueue(
      ranges: readonly {
        startRow: number;
        endRow: number;
        startColumn: number;
        endColumn: number;
      }[],
    ) {
      for (const range of ranges) {
        const from = Math.max(0, range.startRow - 1);
        const to = range.endRow - 1;
        if (to < from) continue;
        if (
          range.endColumn >= FIRST_DATA_COLUMN &&
          range.startColumn <= LAST_DATA_COLUMN
        )
          pendingCells.push([from, to]);
        if (range.startColumn <= 0) pendingChecks.push([from, to]);
      }
    }
    /** Counts from the last scan; a cursor move reuses them. */
    let counts = { populated: 0, dirty: false, selected: 0 };
    /** Something changed the cells or the rows: recount on the next frame. */
    function notify() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(emitStatus);
    }
    /**
     * Only the cursor moved. Re-reading every touched row for that made each
     * arrow key on a 100.000-row sheet a full scan; the counts cannot have
     * changed, so the last ones are sent with the new active row.
     */
    function notifyActive() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(emitStatus);
    }
    function emitStatus() {
      if (disposed) return;
      const cells = coalesce(pendingCells);
      const checks = coalesce(pendingChecks);
      pendingCells = [];
      pendingChecks = [];
      for (const [from, to] of cells) recountCells(from, to);
      for (const [from, to] of checks) recountChecks(from, to);
      counts = {
        populated: filledCount,
        dirty: changedCount > 0,
        selected: checkedCount,
      };

      callbacks.current.onStatus({ active, ...counts });
    }
    /**
     * Above zero while this grid makes a change whose `SheetValueChanged` it
     * must not handle as an edit: painting the error marks (a style-only
     * `set-range-values`), its own text conversions, and writes whose rows it
     * already queues itself. Univer 0.25.1 emits the event synchronously
     * inside the call (measured), so a counter around the call is enough.
     *
     * Without it every mark painted ran `afterValueChange` over the painted
     * range, whose per-cell `setValue` each sent sheets-formula through a
     * full-sheet scan: errors × sheet size, 268 s for 10.000 marks on a
     * 50.000-row paste.
     */
    let quiet = 0;
    function quietly(run: () => void) {
      quiet += 1;
      try {
        run();
      } finally {
        quiet -= 1;
      }
    }
    /**
     * After any value change: brings typed cells back to text (`asText`), and
     * stretches the scan window to the last row that actually holds
     * something. A fill dragged past the window would otherwise be invisible
     * to `read()`; a selection reaching the bottom of the sheet (Ctrl+A, a
     * whole column) no longer stretches it, because only content does.
     *
     * The conversions are written per vertical run of cells — one
     * `setValues` for a filled column, not one `setValue` per cell — because
     * every write is another pass of the formula engine over the sheet.
     */
    function afterValueChange(
      ranges: readonly {
        startRow: number;
        endRow: number;
        startColumn: number;
        endColumn: number;
      }[],
    ) {
      const maxRow = sheet.getMaxRows() - 1;
      let last = 0;
      const conversions = new Map<number, { row: number; cell: ICellData }[]>();
      for (const range of ranges) {
        const top = Math.max(1, range.startRow);
        const bottom = Math.min(maxRow, range.endRow);
        const left = Math.max(FIRST_DATA_COLUMN, range.startColumn);
        const right = Math.min(LAST_DATA_COLUMN, range.endColumn);
        if (bottom < top || right < left) continue;
        const matrix = sheet
          .getRange(top, left, bottom - top + 1, right - left + 1)
          .getCellDatas();
        matrix.forEach((row, rowOffset) =>
          row.forEach((cell, colOffset) => {
            if (!cell) return;
            if (
              cell.f ||
              (cell.v !== null && cell.v !== undefined && cell.v !== "")
            )
              last = Math.max(last, top + rowOffset);
            const text = asText(cell, left + colOffset);
            if (!text) return;
            const column = left + colOffset;
            const list = conversions.get(column) ?? [];
            list.push({ row: top + rowOffset, cell: text });
            conversions.set(column, list);
          }),
        );
      }
      if (conversions.size)
        quietly(() => {
          for (const [column, list] of conversions) {
            list.sort((a, b) => a.row - b.row);
            let start = 0;
            for (let index = 1; index <= list.length; index++) {
              if (
                index < list.length &&
                list[index]!.row === list[index - 1]!.row + 1
              )
                continue;
              const run = list.slice(start, index);
              sheet
                .getRange(run[0]!.row, column, run.length, 1)
                .setValues(run.map((item) => [item.cell]));
              start = index;
            }
          }
        });
      if (last > touched) reach(last);
    }
    let marked: readonly { row: number; column: number }[] = [];
    /**
     * Once a bulk removal has rewritten row positions, undo/redo stay off
     * until this workspace is rebuilt (Simpan or Muat ulang remount it).
     */
    let undoFenced = false;
    /**
     * Removes many scattered draft rows in a handful of commands instead of
     * one per band: every row under the first removed one is rewritten one
     * slot higher in a single `setValues`, and the now-empty tail is
     * cleared. To the admin it is the same as Delete row — the rows are gone
     * and the rest close up — and the sheet keeps its full capacity.
     *
     * The bookkeeping moves in one pass too (`compactSlots`,
     * `removeRowsFrom`), because the rewrite is plain cell values: no
     * remove-row mutation fires for `applyRowShift` to follow.
     *
     * That is also why undo is fenced afterwards. Univer's undo would put the
     * old VALUES back at the old positions while the saved-row identities
     * stay where they moved to, and Simpan would then send one row's figures
     * under another row's id. The documented facade has no way to clear the
     * undo stack, so undo is refused instead, with a message saying why.
     *
     * Measured against Univer 0.25.1 in this configuration (no header, no
     * toolbar): neither Ctrl+Z nor Cmd+Z reaches `univer.command.undo` at
     * all, even for a plain cell edit. The fence is kept for the day undo
     * does fire — an upgrade, or the toolbar coming back — because by then
     * nobody will remember that this rewrite made it unsafe.
     */
    function compact(indices: readonly number[]): number {
      const first = indices[0];
      if (first === undefined) return 0;
      const span = touched - first;
      const removedSet = new Set(indices);
      const cells = sheet.getRange(first + 1, 1, span, 7).getCellDatas();
      // Written back as explicit values — the same shape `write()` uses —
      // never as the raw `ICellData` read out: that carries style ids and
      // internal fields, and handing it back to `setValues` lost rows.
      const keptCells: ICellData[][] = [];
      const keptChecks: number[][] = [];
      for (let offset = 0; offset < span; offset++) {
        if (removedSet.has(first + offset)) continue;
        keptCells.push(
          Array.from({ length: 7 }, (_, col) => {
            const cell = cells[offset]?.[col];
            if (cell?.f) return { f: cell.f };
            return { v: String(cell?.v ?? ""), t: CellValueType.STRING };
          }),
        );
        keptChecks.push([checked[first + offset] ? 1 : 0]);
      }

      // Quiet: these writes only move content up, and the bookkeeping below
      // moves with them in one pass — handling each write as an edit would
      // rescan the whole span three times over.
      quietly(() => {
        const whole = sheet.getRange(first + 1, 1, span, 7);
        whole.clearContent();
        // Red marks are repainted by the page once its errors move (below);
        // clearing them here keeps a mark from staying on the row that slid
        // into a removed row's place.
        whole.clearFormat();
        sheet
          .getRange(first + 1, 0, span, 1)
          .setValues(
            keptChecks.concat(
              Array.from({ length: span - keptChecks.length }, () => [0]),
            ),
          );
        if (keptCells.length)
          sheet
            .getRange(first + 1, 1, keptCells.length, 7)
            .setValues(keptCells);
      });
      marked = marked.filter((cell) => cell.row < first + 1);

      for (const index of indices) forgetSlots(index, 1);
      compactSlots(keys, indices);
      compactSlots(originals, indices);
      compactSlots(baselineCells, indices);
      compactSlots(filled, indices);
      compactSlots(changed, indices);
      compactSlots(checked, indices);
      keyIndex.clear();
      keys.forEach((key, position) => {
        if (key) keyIndex.set(key, position);
      });
      touched -= indices.length;
      const sheetRows = indices.map((index) => index + 1);
      undoFenced = true;
      callbacks.current.onRowsRemoved(sheetRows);
      notify();
      return indices.length;
    }
    /**
     * Follows an insert or a delete that Univer has already performed.
     *
     * Driven by the mutation rather than by the command that caused it, so an
     * undo — which replays the opposite mutation — moves the bookkeeping back
     * without a second code path to keep in step.
     */
    function applyRowShift(from: number, delta: number) {
      const index = from - 1;
      if (index < 0 || delta === 0) return;

      if (delta > 0) {
        insertSlots(keys, index, delta);
        insertSlots(originals, index, delta);
        insertSlots(baselineCells, index, delta);
        insertSlots(filled, index, delta);
        insertSlots(changed, index, delta);
        insertSlots(checked, index, delta);
      } else {
        forgetSlots(index, -delta);
        removeSlots(keys, index, -delta);
        removeSlots(originals, index, -delta);
        removeSlots(baselineCells, index, -delta);
        removeSlots(filled, index, -delta);
        removeSlots(changed, index, -delta);
        removeSlots(checked, index, -delta);
      }
      // Rebuilt wholesale: every key below the change sits at a new index, and
      // this runs once per user action, not per row.
      keyIndex.clear();
      keys.forEach((key, position) => {
        if (key) keyIndex.set(key, position);
      });
      touched = shiftTouched(touched, from, delta, MAX_ROWS);
      // Univer moved the red backgrounds along with the rows; this moves the
      // record of which cells carry them, so clearing later finds them.
      marked = shiftRows(marked, from, delta);
      // An inserted row is normally empty, but an undone delete inserts the
      // rows back WITH their content.
      if (delta > 0) {
        pendingCells.push([index, index + delta - 1]);
        pendingChecks.push([index, index + delta - 1]);
      }
      callbacks.current.onRowsShifted(from, delta);
      notify();
    }
    /**
     * Whether a row insert or delete has to be refused, and what to tell the
     * admin when it does. An empty string means it may proceed.
     */
    function refuseRowChange(removing: boolean, params: unknown): string {
      const target =
        rangeParam(params) ??
        sheet.getSelection()?.getActiveRange()?.getRange();
      if (!target) return "Pilih dulu baris yang ingin diubah.";
      if (target.startRow < 1) return "Baris judul tidak bisa diubah.";

      const count = target.endRow - target.startRow + 1;
      if (!removing) {
        return touched + count > MAX_ROWS
          ? `Workspace penuh (${MAX_ROWS.toLocaleString("id-ID")} baris). Simpan lalu muat ulang.`
          : "";
      }

      // Saved rows are not the grid's to delete: their history lives in the
      // audit trail, and Batalkan is the action that keeps it.
      let saved = 0;
      for (let row = target.startRow; row <= target.endRow; row++) {
        if (originals[row - 1]) saved += 1;
      }
      return saved > 0
        ? `${saved} baris sudah tersimpan dan tidak bisa dihapus dari grid. Pakai Batalkan supaya histori audit tetap ada.`
        : "";
    }
    /**
     * Hands a paste to the page, which normalises it and writes the cells,
     * instead of letting Univer write the raw text. Ctrl+V already arrives as text; the menu entry has only just read
     * the clipboard itself, so this reads it again.
     */
    function requestPaste(params: unknown) {
      if (!editableRef.current) return;
      const text = pastedText(params);
      if (text !== undefined) {
        callbacks.current.onPaste(text);
        return;
      }
      navigator.clipboard.readText().then(
        (value) => {
          if (!disposed && value) callbacks.current.onPaste(value);
        },
        () => {
          callbacks.current.onBlocked(
            "Browser menolak akses clipboard. Tekan Ctrl+V di dalam grid atau pakai tombol Tempel.",
          );
        },
      );
    }
    const control: GridControl = {
      readRow(row) {
        if (row < 1 || row > MAX_ROWS) return;
        ensureRows(row);
        const key = keyAt(row - 1);
        const cells = sheet.getRange(row, 1, 1, 7).getCellDatas()[0];
        const original = originals[row - 1];
        return {
          key,
          cells: Array.from({ length: 7 }, (_, index) => {
            const cell = cells?.[index];
            return cell?.f ?? String(cell?.v ?? "");
          }),
          ...(original ? { original } : {}),
        };
      },
      writeRange(row, cells) {
        if (
          !editableRef.current ||
          !cells.length ||
          row < 1 ||
          row + cells.length > MAX_ROWS + 1
        )
          return;
        reach(row + cells.length - 1);
        // Quiet: every value written here is already text, so there is
        // nothing for `afterValueChange` to convert, and the counts follow
        // from `cells` below without reading the rows back.
        quietly(() => {
          // One command for the checkbox and the seven cells: each
          // `set-range-values` costs a formula-engine pass over the sheet and
          // a row-height pass over its range, so two per slice was double.
          // The checkbox gets its 0 here because a checkbox only paints once
          // its cell has a value.
          sheet
            .getRange(row, 0, cells.length, 8)
            .setValues(
              cells.map((values) => [
                { v: 0, t: CellValueType.NUMBER },
                ...values.map((v) => ({ v, t: CellValueType.STRING })),
              ]),
            );
        });
        cells.forEach((values, offset) => {
          const index = row - 1 + offset;
          const baseline = baselineCells[index];
          setFilled(index, values.some(Boolean));
          setChanged(
            index,
            baseline
              ? values.some((value, col) => value !== (baseline[col] ?? ""))
              : values.some(Boolean),
          );
          setChecked(index, false);
        });
        notify();
      },
      reserveRows(row) {
        if (row >= 1) ensureRows(Math.min(row, MAX_ROWS));
      },
      accept(rows, result) {
        // One sheet read for a batch; a single moved shift (accepted one at a
        // time by the PATCH path) reads only its own row instead of the whole
        // touched window per row.
        const current: (DraftRow | undefined)[] | null =
          result.rows.length > 64 ? read() : null;
        const cellsAt = (index: number) =>
          (current ? current[index] : control.readRow(index + 1))?.cells ?? [];
        // Peta, bukan `indexOf` di dalam loop: satu batch 10.000 baris berarti
        // 100 juta perbandingan kalau dicari linear.
        const inputs = new Map(rows.map((row) => [row.clientRowId, row]));

        for (const saved of result.rows) {
          if (
            saved.outcome === "REJECTED" ||
            !saved.productionEntryId ||
            !saved.rowVersion
          )
            continue;
          const index = keyIndex.get(saved.clientRowId) ?? -1;
          const input = inputs.get(saved.clientRowId);
          if (index < 0 || !input) continue;
          originals[index] = {
            ...input,
            id: saved.productionEntryId,
            rowVersion: saved.rowVersion,
            sourceType: originals[index]?.sourceType ?? "MANUAL",
            status: "ACTIVE",
          };
          baselineCells[index] = [...cellsAt(index)];
          setChanged(index, false);
        }
        notify();
      },
      read,
      readRange,
      finish: () => workbook.endEditingAsync(true),
      activeCell: () => ({ row: active, column }),
      select(row) {
        active = Math.max(1, Math.min(MAX_ROWS, row));
        reach(active);
        sheet.getRange(active, 1).activate();
        // `activate` moves the selection but never the viewport, so jumping to
        // row 9.115 from the error panel used to look like nothing happened.
        // Scrolled a couple of rows short of the target so it does not sit
        // flush against the frozen header, and to the first scrollable column
        // so a jump always starts reading at Shift Start.
        sheet.scrollToCell(Math.max(FROZEN_ROWS, active - 2), FROZEN_COLUMNS);
        // A cursor reaching past the data adds only empty rows: nothing to
        // count.
        notifyActive();
      },
      selected: () => {
        const rows = read();
        return rows.filter((_, index) => checked[index]);
      },
      selectAll(value) {
        if (touched < 1) return;

        const next = Array.from(
          { length: touched },
          (_, index) => value && filled[index] === true,
        );
        quietly(() => {
          sheet
            .getRange(1, 0, touched, 1)
            .setValues(next.map((on) => [on ? 1 : 0]));
        });
        next.forEach((on, index) => setChecked(index, on));
        emitStatus();
      },
      selectRow(row, value) {
        reach(row);
        quietly(() => {
          sheet.getRange(row, 0).setValue(value ? 1 : 0);
        });
        setChecked(row - 1, value);
        emitStatus();
      },
      isSelected: (row) => {
        if (row >= sheet.getMaxRows()) return false;
        const value = sheet.getRange(row, 0).getValue();
        return value === true || value === 1;
      },
      removeDrafts(draftKeys) {
        if (!editableRef.current) return 0;
        const indices = [
          ...new Set(
            draftKeys.flatMap((key) => {
              // The index, not `keys.indexOf`: thousands of keys against a
              // 100.000-slot array is hundreds of millions of comparisons.
              const index = keyIndex.get(key);
              return index !== undefined && !originals[index] ? [index] : [];
            }),
          ),
        ].sort((left, right) => left - right);
        const ranges = indices.reduce<{ start: number; end: number }[]>(
          (result, index) => {
            const last = result.at(-1);
            if (last && index === last.end + 1) last.end = index;
            else result.push({ start: index, end: index });
            return result;
          },
          [],
        );
        if (ranges.length > NATIVE_REMOVE_MAX_BANDS) return compact(indices);
        /*
          Few bands: deleted through Univer's own remove-row command, the one
          the right-click menu runs, so the rows are really gone rather than left
          blank — and so every piece of positional bookkeeping (draft keys,
          saved baselines, red marks, the problem panel's row numbers) moves
          through the single `applyRowShift` path that already follows that
          mutation. A second hand-rolled shift here could drift from it.

          Bottom band first: deleting a band moves everything under it, so
          going top-down would leave every later band pointing at rows that
          have already slid up.
        */
        let removed = 0;
        for (const range of ranges.reverse()) {
          const before = keys.length;
          sheet.deleteRows(range.start + 1, range.end - range.start + 1);
          removed += before - keys.length;
        }
        notify();
        return removed;
      },
      markErrors(cells, warnings = []) {
        /*
          One `set-range-values` for the whole repaint — clearing the cells
          no longer marked and tinting the new ones together — instead of a
          clear and a paint per run of cells. Bad cells rarely form runs (a
          zero Width every fifth row is 2.000 separate cells), and each command
          is another pass of the formula engine over the sheet.

          The matrix is sparse and keyed by ABSOLUTE row and column: measured
          on Univer 0.25.1, `FRange.setValues` applies an object matrix at the
          coordinates it names, so the range starts at A1, where absolute and
          relative are the same thing either way. A cell given only `s` keeps
          its value. `s: null` drops its style — the same result `clearFormat`
          gave, NOT a white fill: Univer draws its gridlines underneath the
          cell background, so a white fill covers them and a corrected row is
          left looking borderless. Only columns 1..7 are ever marked, and
          those carry no formatting of their own (the header style is row 0,
          the checkbox validation is column 0), so there is nothing else for
          the clear to take away.
        */
        const maxRow = sheet.getMaxRows() - 1;
        const inSheet = (cell: { row: number; column: number }) =>
          cell.row >= 1 &&
          cell.row <= maxRow &&
          cell.column >= FIRST_DATA_COLUMN &&
          cell.column <= LAST_DATA_COLUMN;
        const slot = (cell: { row: number; column: number }) =>
          cell.row * (LAST_DATA_COLUMN + 1) + cell.column;
        const red = cells.filter(inSheet);
        const reds = new Set(red.map(slot));
        const amber = warnings.filter(
          (cell) => inSheet(cell) && !reds.has(slot(cell)),
        );
        const matrix: Record<number, Record<number, ICellData>> = {};
        let bottom = 0;
        const put = (
          cell: { row: number; column: number },
          style: ICellData["s"],
        ) => {
          (matrix[cell.row] ??= {})[cell.column] = { s: style };
          bottom = Math.max(bottom, cell.row);
        };
        // Clearing first, and only what was actually marked, keeps an empty
        // list cheap and never touches a cell this never painted. A cell
        // marked again is simply overwritten by its new tint below.
        for (const cell of marked) if (inSheet(cell)) put(cell, null);
        for (const cell of amber) put(cell, { bg: { rgb: WARNING_CELL_BG } });
        for (const cell of red) put(cell, { bg: { rgb: ERROR_CELL_BG } });
        marked = [...red, ...amber];
        if (bottom < 1) return;
        quietly(() => {
          sheet
            .getRange(0, 0, bottom + 1, LAST_DATA_COLUMN + 1)
            .setValues(matrix);
        });
      },
      appendRows(count) {
        if (!editableRef.current || count < 1) return 0;
        const before = sheet.getMaxRows();
        if (before > MAX_ROWS) return 0;
        setSheetRows(before + Math.floor(count));
        return sheet.getMaxRows() - before;
      },
      write(row, cells) {
        if (!editableRef.current) return;
        reach(row);
        // Only the cells that differ: rewriting the whole row for one
        // changed date or assignee clobbered whatever the admin had just
        // typed elsewhere in it, and cost a seven-cell undo step.
        const current = sheet.getRange(row, 1, 1, 7).getCellDatas()[0];
        cells.forEach((v, index) => {
          const cell = current?.[index];
          const now = cell?.f ?? String(cell?.v ?? "");
          if (now === v && (cell?.t === CellValueType.STRING || v === ""))
            return;
          sheet
            .getRange(row, index + 1)
            .setValue({ v, t: CellValueType.STRING });
        });
        notify();
      },
    };
    const events = [
      api.addEvent(api.Event.BeforeCommandExecute, (event) => {
        if (undoFenced && UNDO_COMMANDS.has(event.id)) {
          event.cancel = true;
          callbacks.current.onBlocked(
            "Undo tidak tersedia setelah menghapus banyak baris sekaligus. Muat ulang untuk membuang semua perubahan draft.",
          );
          return;
        }
        if (PASTE_COMMANDS.has(event.id)) {
          if (editingRef.current) return;
          event.cancel = true;
          requestPaste(event.params);
          return;
        }
        if (event.id === "sheet.command.set-range-values") {
          forceTextValues(event.params);
          return;
        }
        const removing = ROW_REMOVE_COMMANDS.has(event.id);
        if (removing || ROW_INSERT_COMMANDS.has(event.id)) {
          const refusal = refuseRowChange(removing, event.params);
          if (refusal) {
            event.cancel = true;
            callbacks.current.onBlocked(refusal);
          } else if (!removing) {
            prepareInsertedRows(event.params);
          }
          return;
        }
        // Everything else structural stays refused: row identity is positional
        // inside this bounded workbook, and the seven columns are the contract.
        if (BLOCKED_COMMANDS.has(event.id) || STRUCTURAL_COMMAND.test(event.id))
          event.cancel = true;
      }),
      api.addEvent(api.Event.CommandExecuted, (event) => {
        const insert = event.id === "sheet.mutation.insert-row";
        if (!insert && event.id !== "sheet.mutation.remove-rows") return;
        const target = rangeParam(event.params);
        if (!target || target.subUnitId !== sheet.getSheetId()) return;
        const count = target.endRow - target.startRow + 1;
        applyRowShift(target.startRow, insert ? count : -count);
      }),
      api.addEvent(api.Event.SelectionChanged, (event) => {
        const selection = event.selections[0];
        if (selection && selection.startRow > 0) {
          active = selection.startRow;
          // Jendela pemindaian mengikuti kursor: mengetik di baris 40.000
          // harus terbaca. Hanya sel aktif — ujung seleksi (Ctrl+A, satu
          // kolom penuh) tidak berisi apa-apa dan dulu memanjangkan sheet
          // sampai kapasitas; isi yang benar-benar masuk dikejar
          // `afterValueChange`.
          const grew = active > touched;
          reach(active);
          column = Math.max(1, selection.startColumn);
          if (selection.startColumn !== 4) callbacks.current.onAssignee(null);
          showCellTrigger(active, column);
          if (grew) notify();
          else notifyActive();
        }
      }),

      api.addEvent(api.Event.SheetValueChanged, (event) => {
        if (quiet) return;
        const ranges = event.effectedRanges
          .filter((range) => range.getSheetId() === sheet.getSheetId())
          .map((range) => range.getRange());
        afterValueChange(ranges);
        enqueue(ranges);
        notify();
        // Only data cells can fix a problem; a ticked checkbox cannot.
        const edited = ranges
          .filter(
            (range) =>
              range.endColumn >= FIRST_DATA_COLUMN &&
              range.startColumn <= LAST_DATA_COLUMN &&
              range.endRow >= 1,
          )
          .map((range) => ({
            start: Math.max(1, range.startRow),
            end: range.endRow,
          }));
        if (edited.length) callbacks.current.onEdited(edited);
      }),
      api.addEvent(api.Event.SheetEditStarted, () => {
        editingRef.current = true;
      }),
      // The anchor is measured, so it goes stale the moment the sheet scrolls
      // under it.
      api.addEvent(api.Event.Scroll, () => showCellTrigger(active, column)),
      api.addEvent(api.Event.CellClicked, (event) => {
        if (event.row > 0) {
          active = event.row;
          const grew = event.row > touched;
          reach(event.row);
          column = Math.max(1, event.column);
          if (grew) notify();
          else notifyActive();
          // A click only selects the cell; the list opens from the button
          // painted inside it, the same as the calendar.
          callbacks.current.onAssignee(null);
          showCellTrigger(event.row, column);
        }
      }),
      api.addEvent(api.Event.SheetEditEnded, () => {
        editingRef.current = false;
        showCellTrigger(active, column);
      }),
      api.addEvent(api.Event.BeforeSheetEditStart, (event) => {
        callbacks.current.onCellTrigger(null);
        if (
          !editableRef.current ||
          event.row === 0 ||
          // A saved row's station stays fixed; its shift can be corrected.
          (originals[event.row - 1] && event.column === 3)
        )
          event.cancel = true;
        if (event.column === 4) {
          event.cancel = true;
          openAssignee(event.row);
        }
      }),
    ];
    // The route is lazy-loaded below the fold on short viewports. Univer can
    // measure the host before the browser finishes layout; a resize tick makes
    // the canvas adopt the final 480px workspace without requiring user scroll.
    const layoutFrame = requestAnimationFrame(() =>
      window.dispatchEvent(new Event("resize")),
    );
    onReady(control);
    // The saved rows this sheet opened with: counted once, then kept up by
    // the changes that touch them.
    if (entries.length) pendingCells.push([0, entries.length - 1]);
    notify();
    return () => {
      disposed = true;
      workbookRef.current = null;
      editingRef.current = false;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(layoutFrame);
      resize.disconnect();
      events.forEach((event) => event.dispose());
      // Univer owns nested React roots. Defer their teardown until the parent
      // route has finished its current React commit to avoid nested unmounts.
      window.setTimeout(() => {
        univer.dispose();
        container.remove();
      }, 0);
    };
  }, [entries, names, onReady]);
  return (
    <div
      className="manual-grid-viewport"
      onPointerDownCapture={(event) => {
        pointer.current = {
          clientX: event.clientX,
          clientY: event.clientY,
          time: performance.now(),
        };
      }}
      onWheelCapture={() => onAssignee(null)}
      onPasteCapture={(event) => {
        // Inside the in-cell editor a paste is text for that one cell, the
        // way every spreadsheet treats it — not a block for `applyRows`.
        if (editingRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        if (editable) onPaste(event.clipboardData.getData("text/plain"));
      }}
    >
      <div
        ref={host}
        className="manual-grid"
        aria-label="Spreadsheet Manual Data. Gunakan editor baris di bawah sebagai alternatif keyboard."
      />
    </div>
  );
}

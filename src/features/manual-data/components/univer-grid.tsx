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

export interface GridStatus {
  active: number;
  selected: number;
  populated: number;
  dirty: boolean;
}
export interface AssigneeEditorAnchor {
  row: number;
  left: number;
  top: number;
}
/**
 * Where to paint the date affordance for a Shift Start/End cell. Unlike the
 * assignee popover this is anchored to the cell itself, not to the pointer:
 * the icon has to keep sitting in its cell when the selection is moved with
 * the keyboard.
 */
export interface DateCellAnchor {
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
  readRow(row: number): DraftRow | undefined;
  writeRange(row: number, cells: string[][]): void;
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
  activeCell(): { row: number; column: number };
  /**
   * Paints the cells that failed validation, replacing any previous marks.
   * Pass an empty list to clear them all.
   */
  markErrors(cells: readonly { row: number; column: number }[]): void;
}
interface Props {
  entries: Entry[];
  names: ReadonlyMap<string, string>;
  editable: boolean;
  onReady(control: GridControl | null): void;
  onStatus(status: GridStatus): void;
  onAssignee(anchor: AssigneeEditorAnchor | null): void;
  onDateCell(anchor: DateCellAnchor | null): void;
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
}

/**
 * Above this many separate bands, `removeDrafts` stops running one Univer
 * remove-row command per band. Measured: 1.000 bands on the 100.000-row sheet
 * ran the tab out of memory ("Aw, Snap!" error 5) — each command snapshots
 * undo state and rewrites the checkbox validation for the whole sheet. Below
 * it the native command is kept, because it stays undoable.
 */
const NATIVE_REMOVE_MAX_BANDS = 20;
const UNDO_COMMANDS = new Set(["univer.command.undo", "univer.command.redo"]);

/** Shift Start and Shift End — the two columns that hold a timestamp. */
const DATE_COLUMNS = [1, 2];
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
 * Paste keeps going through the preview panel instead of writing cells
 * straight in: that is the one path that normalises decimal commas and
 * single-digit hours and resolves an EID to a PIN. Every "Paste special" entry
 * delegates to `univer.command.paste`, so cancelling that covers them all.
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
function rangeParam(
  params: unknown,
): { startRow: number; endRow: number; subUnitId?: string } | undefined {
  if (!params || typeof params !== "object") return undefined;
  const range = (params as { range?: unknown }).range;
  if (!range || typeof range !== "object") return undefined;
  const { startRow, endRow } = range as {
    startRow?: unknown;
    endRow?: unknown;
  };
  if (typeof startRow !== "number" || typeof endRow !== "number")
    return undefined;
  const subUnitId = (params as { subUnitId?: unknown }).subUnitId;
  return {
    startRow,
    endRow,
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
  onDateCell,
  onPaste,
  onBlocked,
  onRowsShifted,
  onRowsRemoved,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const pointer = useRef<
    { clientX: number; clientY: number; time: number } | undefined
  >(undefined);
  const callbacks = useRef({
    onStatus,
    onAssignee,
    onDateCell,
    onPaste,
    onBlocked,
    onRowsShifted,
    onRowsRemoved,
  });
  useEffect(() => {
    callbacks.current = {
      onStatus,
      onAssignee,
      onDateCell,
      onPaste,
      onBlocked,
      onRowsShifted,
      onRowsRemoved,
    };
  }, [
    onStatus,
    onAssignee,
    onDateCell,
    onPaste,
    onBlocked,
    onRowsShifted,
    onRowsRemoved,
  ]);
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
    function keyAt(index: number): string {
      const existing = keys[index];
      if (existing) return existing;

      const key = entries[index]?.id ?? crypto.randomUUID();
      keys[index] = key;
      keyIndex.set(key, index);
      return key;
    }

    const originals: (Baseline | undefined)[] = [...entries];
    const baselineCells: (string[] | undefined)[] = [];

    /**
     * Baris terakhir yang mungkin berisi sesuatu. Semua pemindaian berhenti di
     * sini, bukan di kapasitas: itu yang membuat kapasitas 100.000 tetap murah
     * selama halaman cuma memuat beberapa ratus baris.
     */
    let touched = entries.length;
    const reach = (row: number) => {
      touched = Math.max(touched, Math.min(row, MAX_ROWS));
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
          rowCount: MAX_ROWS + 1,
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
    sheet
      .getRange(1, 0, MAX_ROWS, 1)
      .setDataValidation(
        api.newDataValidation().requireCheckbox("1", "0").build(),
      );
    // Applying the explicit mode also makes Univer recalculate/render the canvas.
    workbook.setEditable(editable);
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
    function showDateCell(row: number, col: number) {
      if (!editable || row < 1 || !DATE_COLUMNS.includes(col)) {
        callbacks.current.onDateCell(null);
        return;
      }
      // A saved row's shift and station are the unique key; the grid already
      // refuses to edit them, so the icon must not offer to either.
      if (originals[row - 1]) {
        callbacks.current.onDateCell(null);
        return;
      }
      const rect = sheet.getRange(row, col).getCellRect();
      if (!rect || rect.width === 0) {
        callbacks.current.onDateCell(null);
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
        callbacks.current.onDateCell(null);
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
        callbacks.current.onDateCell(null);
        return;
      }
      const cell = sheet.getRange(row, col).getCellData();
      callbacks.current.onDateCell({
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
      if (touched < 1) return [];

      const matrix = sheet.getRange(1, 1, touched, 7).getCellDatas();
      return Array.from({ length: touched }, (_, index) => ({
        key: keyAt(index),
        cells: Array.from({ length: 7 }, (_, col) => {
          const cell = matrix[index]?.[col];
          return cell?.f ? cell.f : String(cell?.v ?? "");
        }),
        ...(originals[index] ? { original: originals[index] } : {}),
      }));
    }
    function selectedIndices() {
      if (touched < 1) return [];

      const matrix = sheet.getRange(1, 0, touched, 1).getValues();
      return Array.from({ length: touched }, (_, index) => index).filter(
        (index) => matrix[index]?.[0] === true || matrix[index]?.[0] === 1,
      );
    }
    /** Perbandingan per sel, tanpa merakit string gabungan untuk tiap baris. */
    function changedFrom(
      cells: readonly string[],
      baseline?: readonly string[],
    ) {
      if (!baseline) return cells.some(Boolean);
      for (let col = 0; col < cells.length; col++)
        if (cells[col] !== (baseline[col] ?? "")) return true;
      return false;
    }
    function notify() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(emitStatus);
    }
    function emitStatus() {
      if (disposed) return;
      const rows = read();
      let populated = 0;
      let dirty = false;

      for (let index = 0; index < rows.length; index++) {
        const cells = rows[index]!.cells;
        if (cells.some(Boolean)) populated += 1;
        if (!dirty && changedFrom(cells, baselineCells[index])) dirty = true;
      }

      callbacks.current.onStatus({
        active,
        selected: selectedIndices().length,
        populated,
        dirty,
      });
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
      const checks = sheet.getRange(first + 1, 0, span, 1).getValues();
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
        const checked = checks[offset]?.[0];
        keptChecks.push([checked === true || checked === 1 ? 1 : 0]);
      }

      const whole = sheet.getRange(first + 1, 1, span, 7);
      whole.clearContent();
      // Red marks are repainted by the page once its errors move (below);
      // clearing them here keeps a mark from staying on the row that slid
      // into a removed row's place.
      whole.clearFormat();
      marked = marked.filter((cell) => cell.row < first + 1);
      sheet
        .getRange(first + 1, 0, span, 1)
        .setValues(
          keptChecks.concat(
            Array.from({ length: span - keptChecks.length }, () => [0]),
          ),
        );
      if (keptCells.length)
        sheet.getRange(first + 1, 1, keptCells.length, 7).setValues(keptCells);

      compactSlots(keys, indices);
      compactSlots(originals, indices);
      compactSlots(baselineCells, indices);
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
      } else {
        removeSlots(keys, index, -delta);
        removeSlots(originals, index, -delta);
        removeSlots(baselineCells, index, -delta);
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
     * Sends a paste to the preview panel instead of letting Univer write the
     * cells. Ctrl+V already arrives as text; the menu entry has only just read
     * the clipboard itself, so this reads it again.
     */
    function requestPaste(params: unknown) {
      if (!editable) return;
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
          !editable ||
          !cells.length ||
          row < 1 ||
          row + cells.length > MAX_ROWS + 1
        )
          return;
        reach(row + cells.length - 1);
        sheet
          .getRange(row, 1, cells.length, 7)
          .setValues(
            cells.map((values) =>
              values.map((v) => ({ v, t: CellValueType.STRING })),
            ),
          );
        // Checkbox baru tergambar setelah selnya punya nilai.
        sheet
          .getRange(row, 0, cells.length, 1)
          .setValues(Array.from({ length: cells.length }, () => [0]));
        notify();
      },
      accept(rows, result) {
        const current = read();
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
          baselineCells[index] = [...(current[index]?.cells ?? [])];
        }
        notify();
      },
      read,
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
        notify();
      },
      selected: () => {
        const rows = read();
        return selectedIndices().flatMap((index) =>
          rows[index] ? [rows[index]] : [],
        );
      },
      selectAll(value) {
        const rows = read();
        if (!rows.length) return;

        sheet
          .getRange(1, 0, rows.length, 1)
          .setValues(
            rows.map((row) => [value && row.cells.some(Boolean) ? 1 : 0]),
          );
        emitStatus();
      },
      selectRow(row, value) {
        reach(row);
        sheet.getRange(row, 0).setValue(value ? 1 : 0);
        emitStatus();
      },
      isSelected: (row) => {
        const value = sheet.getRange(row, 0).getValue();
        return value === true || value === 1;
      },
      removeDrafts(draftKeys) {
        if (!editable) return 0;
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
      markErrors(cells) {
        // Styling one cell at a time would be tens of thousands of commands
        // for a large import. Consecutive rows in the same column are painted
        // as a single range instead, which is how these actually arrive: one
        // operator owns a run of rows.
        const paint = (
          targets: readonly { row: number; column: number }[],
          apply: (range: ReturnType<typeof sheet.getRange>) => void,
        ) => {
          const byColumn = new Map<number, number[]>();
          for (const cell of targets) {
            const rows = byColumn.get(cell.column) ?? [];
            rows.push(cell.row);
            byColumn.set(cell.column, rows);
          }

          for (const [column, rows] of byColumn) {
            rows.sort((a, b) => a - b);
            let start = 0;
            for (let index = 1; index <= rows.length; index += 1) {
              const broken =
                index === rows.length || rows[index] !== rows[index - 1]! + 1;
              if (!broken) continue;
              const from = rows[start]!;
              const span = rows[index - 1]! - from + 1;
              apply(sheet.getRange(from, column, span, 1));
              start = index;
            }
          }
        };

        // Clearing first, and only what was actually marked, keeps an empty
        // list cheap and never touches a cell this never painted.
        //
        // Cleared with `clearFormat`, NOT by painting white: Univer draws its
        // gridlines underneath the cell background, so a white fill covers
        // them and a corrected row is left looking borderless. Only columns
        // 1..7 are ever marked, and those carry no formatting of their own
        // (the header style is row 0, the checkbox validation is column 0),
        // so there is nothing else here for clearFormat to take away.
        if (marked.length) paint(marked, (range) => range.clearFormat());
        marked = cells.filter(
          (cell) => cell.row >= 1 && cell.column >= 1 && cell.column <= 7,
        );
        if (marked.length) {
          paint(marked, (range) => range.setBackgroundColor(ERROR_CELL_BG));
        }
      },
      write(row, cells) {
        if (!editable) return;
        reach(row);
        sheet
          .getRange(row, 1, 1, 7)
          .setValues([cells.map((v) => ({ v, t: CellValueType.STRING }))]);
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
          event.cancel = true;
          requestPaste(event.params);
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
          // Jendela pemindaian mengikuti ke mana pun orang menaruh kursor:
          // mengetik di baris 40.000 harus terbaca, bukan hilang karena
          // jendelanya berhenti di baris terakhir yang pernah terisi.
          reach(selection.endRow ?? active);
          column = Math.max(1, selection.startColumn);
          if (selection.startColumn !== 4) callbacks.current.onAssignee(null);
          showDateCell(active, column);
          notify();
        }
      }),

      api.addEvent(api.Event.SheetValueChanged, notify),
      // The anchor is measured, so it goes stale the moment the sheet scrolls
      // under it.
      api.addEvent(api.Event.Scroll, () => showDateCell(active, column)),
      api.addEvent(api.Event.CellClicked, (event) => {
        if (event.row > 0) {
          active = event.row;
          reach(event.row);
          column = Math.max(1, event.column);
          notify();
          if (event.column === 4 && editable) openAssignee(event.row);
          else callbacks.current.onAssignee(null);
          showDateCell(event.row, column);
        }
      }),
      api.addEvent(api.Event.SheetEditEnded, () =>
        showDateCell(active, column),
      ),
      api.addEvent(api.Event.BeforeSheetEditStart, (event) => {
        callbacks.current.onDateCell(null);
        if (
          !editable ||
          event.row === 0 ||
          (originals[event.row - 1] && event.column >= 1 && event.column <= 3)
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
    notify();
    return () => {
      disposed = true;
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
  }, [entries, names, editable, onReady]);
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

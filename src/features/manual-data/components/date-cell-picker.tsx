import { useEffect, useId, useRef, useState } from "react";
import type { CellAnchor } from "./univer-grid";

/**
 * Native datetime picker for the Shift Start / Shift End cells.
 *
 * Univer paints the sheet on a canvas, so nothing can be rendered inside a
 * cell: this is an HTML button positioned over the cell's own rectangle. The
 * picker itself is `<input type="datetime-local">` — the platform already has
 * a calendar, a clock, keyboard support and locale handling, and a hand-rolled
 * one would have to re-earn all four.
 *
 * The grid stores these cells as "YYYY-MM-DD HH:mm:ss" wall-clock text in
 * Asia/Jakarta (see `toJakartaInput`), which is the same shape the input uses
 * once the space is swapped for "T". No timezone conversion happens here; the
 * offset is attached later, when the row is validated for the API.
 */
export function DateCellPicker({
  anchor,
  onApply,
  onDismiss,
}: {
  anchor: CellAnchor;
  onApply(value: string): void;
  onDismiss(): void;
}) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const label = anchor.column === 1 ? "Shift Start" : "Shift End";

  useEffect(() => {
    if (!open) return;
    const field = input.current;
    field?.focus();
    try {
      // Opens the browser's own calendar straight away, so the icon is one
      // click rather than two. Not every browser has it; focus is the fallback.
      field?.showPicker();
    } catch {
      // Some browsers refuse showPicker outside a user gesture; the field is
      // focused and still fully usable by typing.
    }
  }, [open]);

  return (
    <div
      className="manual-date-cell"
      style={{ left: anchor.left, top: anchor.top, height: anchor.height }}
      /*
       * Univer tracks pointer events to drive canvas selection. Without this
       * the click reaches the sheet as well, the selection moves, and this
       * popover is remounted shut by the anchor change before it can open.
       */
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        setOpen(false);
        onDismiss();
      }}
      onBlur={(event) => {
        // `relatedTarget` is null when focus leaves the document altogether,
        // which is exactly what the browser's own datetime picker does. Closing
        // on that would shut this the instant the calendar appears.
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      <button
        type="button"
        className="manual-date-trigger"
        aria-label={`Pilih tanggal dan jam ${label} baris ${anchor.row}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <CalendarIcon />
      </button>
      {/*
       * The field carries its own visible label, so the wrapper gets no
       * accessible name of its own: a second identical name would only make
       * the control ambiguous to a screen reader.
       */}
      {open && (
        <div className="manual-date-popover">
          <label htmlFor={id}>{label}</label>
          <input
            id={id}
            ref={input}
            type="datetime-local"
            step="1"
            defaultValue={anchor.value.replace(" ", "T")}
            onChange={(event) => onApply(toCellValue(event.target.value))}
          />
          <button
            type="button"
            className="manual-btn"
            onClick={() => {
              setOpen(false);
              onDismiss();
            }}
          >
            Selesai
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * "YYYY-MM-DDTHH:mm[:ss]" from the input becomes the grid's "YYYY-MM-DD
 * HH:mm[:ss]". Milliseconds are dropped: some engines append ".000" at
 * `step="1"`, and the row validator only accepts up to seconds — a value it
 * refuses would surface as an invalid row at save time, far from the cause.
 */
function toCellValue(value: string): string {
  return value.replace("T", " ").replace(/\.\d+$/, "");
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="1.5" y="3" width="13" height="11.5" rx="1.5" />
      <path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" />
    </svg>
  );
}

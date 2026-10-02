import type { CellAnchor } from "./univer-grid";

/**
 * The employee-list button inside an Assignee cell — the counterpart of the
 * calendar in Shift Start/End. The list used to open on every click of the
 * cell, covering the sheet whenever someone only meant to select it; now a
 * click selects and this button opens.
 *
 * Only the button lives here. The list itself stays the page's one assignee
 * popover, so Enter or a double-click on the cell (the keyboard route) and
 * this button open the same picker.
 */
export function AssigneeCellTrigger({
  anchor,
  open,
  onToggle,
}: {
  anchor: CellAnchor;
  open: boolean;
  onToggle(): void;
}) {
  return (
    <div
      className="manual-date-cell"
      style={{ left: anchor.left, top: anchor.top, height: anchor.height }}
      // Univer drives canvas selection from pointer events; without this the
      // click also reaches the sheet and closes the list it just opened.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="manual-date-trigger"
        aria-label={`Pilih assignee baris ${anchor.row}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        // Keeps focus inside an open list, so its blur-to-close does not shut
        // it a moment before this click would.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggle}
      >
        <ListIcon />
      </button>
    </div>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="6" cy="5.5" r="2.25" />
      <path d="M2 13c.6-2.3 2.1-3.5 4-3.5s3.4 1.2 4 3.5M11 6.5l1.75 1.75L14.5 6.5" />
    </svg>
  );
}

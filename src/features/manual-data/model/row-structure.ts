/**
 * Bookkeeping for a grid whose row identity is its position.
 *
 * Univer's own Insert/Delete row commands are enabled in the Manual Data
 * workspace, so the sheet can grow and shrink underneath arrays that are
 * indexed by row: the draft key, the saved baseline a row came from, the cells
 * painted as failing, and the row numbers the problem panel prints. Every one
 * of them has to move exactly as far as the rows did, or a correction lands on
 * whatever slid into the old position.
 *
 * Kept pure and separate from the grid so the arithmetic can be tested without
 * a canvas: the grid itself only splices and re-indexes.
 */

/** Sheet row 0 is the frozen header, so draft index N lives in sheet row N+1. */
export const HEADER_ROWS = 1;

/**
 * Moves anything addressed by a sheet row across an insert or a delete.
 *
 * `delta` is positive for rows inserted at `from`, negative for rows removed
 * starting at `from`. Items inside a removed band are dropped — they no longer
 * describe anything.
 */
export function shiftRows<T extends { row: number }>(
  items: readonly T[],
  from: number,
  delta: number,
): T[] {
  if (delta === 0) return [...items];
  if (delta > 0) {
    return items.map((item) =>
      item.row >= from ? { ...item, row: item.row + delta } : item,
    );
  }

  const removedUntil = from - delta;
  return items.flatMap((item) => {
    if (item.row < from) return [item];
    if (item.row < removedUntil) return [];
    return [{ ...item, row: item.row + delta }];
  });
}

/**
 * The scan window after the same change.
 *
 * `touched` is how many draft rows the grid still bothers to read; a change
 * below it moves nothing, which is what keeps a 100.000 row capacity cheap.
 */
export function shiftTouched(
  touched: number,
  from: number,
  delta: number,
  max: number,
): number {
  const index = from - HEADER_ROWS;
  if (index < 0 || index >= touched) return touched;
  if (delta > 0) return Math.min(max, touched + delta);
  return touched - Math.min(-delta, touched - index);
}

/**
 * Splices holes into an index-addressed array so slot N keeps describing
 * sheet row N + 1.
 */
export function insertSlots<T>(
  slots: (T | undefined)[],
  index: number,
  count: number,
): void {
  slots.splice(index, 0, ...Array.from({ length: count }, () => undefined));
}

/** Drops the slots of rows that were removed. */
export function removeSlots<T>(
  slots: (T | undefined)[],
  index: number,
  count: number,
): void {
  slots.splice(index, count);
}

/**
 * Moves anything addressed by a sheet row across the removal of MANY
 * scattered rows at once — the one-pass counterpart of calling `shiftRows`
 * per band, which is quadratic when an import leaves thousands of separate
 * bad rows.
 *
 * `removed` holds the removed sheet rows, sorted ascending. Items on a removed
 * row are dropped; every other item moves up by the number of removed rows
 * above it.
 */
export function removeRowsFrom<T extends { row: number }>(
  items: readonly T[],
  removed: readonly number[],
): T[] {
  if (!removed.length) return [...items];
  return items.flatMap((item) => {
    const above = countBelow(removed, item.row);
    if (removed[above] === item.row) return [];
    return above ? [{ ...item, row: item.row - above }] : [item];
  });
}

/**
 * Keeps the slots of every index NOT in `removed` (sorted ascending), in
 * order, and pads the end with empty slots so the array covers the same
 * length. The in-place counterpart of `removeRowsFrom` for index-addressed
 * bookkeeping.
 */
export function compactSlots<T>(
  slots: (T | undefined)[],
  removed: readonly number[],
): void {
  if (!removed.length) return;
  const length = slots.length;
  let write = removed[0]!;
  let next = 0;
  for (let read = write; read < length; read++) {
    if (removed[next] === read) {
      next += 1;
      continue;
    }
    slots[write++] = slots[read];
  }
  for (; write < length; write++) slots[write] = undefined;
}

/** How many values in the ascending list are strictly below `value`. */
function countBelow(sorted: readonly number[], value: number) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle]! < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

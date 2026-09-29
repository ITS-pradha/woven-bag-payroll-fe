import { describe, expect, it } from "vitest";
import {
  insertSlots,
  removeSlots,
  compactSlots,
  removeRowsFrom,
  shiftRows,
  shiftTouched,
} from "./row-structure";

describe("shiftRows", () => {
  const marks = [{ row: 3 }, { row: 5 }, { row: 6 }, { row: 9 }];

  it("moves rows at or below an insert down by the same amount", () => {
    expect(shiftRows(marks, 5, 2)).toEqual([
      { row: 3 },
      { row: 7 },
      { row: 8 },
      { row: 11 },
    ]);
  });

  it("leaves rows above the change alone", () => {
    expect(shiftRows(marks, 9, 1)[0]).toEqual({ row: 3 });
  });

  it("drops rows inside a deleted band and pulls the rest up", () => {
    expect(shiftRows(marks, 5, -2)).toEqual([{ row: 3 }, { row: 7 }]);
  });

  it("keeps the other fields of what it moves", () => {
    expect(
      shiftRows([{ row: 4, field: "Assignee", message: "x" }], 2, 3),
    ).toEqual([{ row: 7, field: "Assignee", message: "x" }]);
  });

  it("is a no-op for a zero delta", () => {
    expect(shiftRows(marks, 2, 0)).toEqual(marks);
  });
});

describe("shiftTouched", () => {
  it("grows the scan window when rows are inserted inside it", () => {
    expect(shiftTouched(10, 3, 2, 100)).toBe(12);
  });

  it("ignores a change below everything scanned", () => {
    expect(shiftTouched(10, 40, 5, 100)).toBe(10);
  });

  it("shrinks by the rows actually removed from inside it", () => {
    expect(shiftTouched(10, 3, -2, 100)).toBe(8);
  });

  it("never counts removed rows that were beyond the window", () => {
    // Window ends at draft index 10 (sheet row 11); deleting rows 9..13 only
    // takes the three that were inside it.
    expect(shiftTouched(10, 9, -5, 100)).toBe(8);
  });

  it("never grows past the capacity", () => {
    expect(shiftTouched(99, 2, 5, 100)).toBe(100);
  });

  it("refuses to move for the header row", () => {
    expect(shiftTouched(10, 0, 3, 100)).toBe(10);
  });
});

describe("slot splicing", () => {
  it("keeps slot N describing sheet row N+1 after an insert", () => {
    const keys: (string | undefined)[] = ["a", "b", "c"];
    insertSlots(keys, 1, 2);
    expect(keys).toEqual(["a", undefined, undefined, "b", "c"]);
  });

  it("drops the slots of removed rows", () => {
    const keys: (string | undefined)[] = ["a", "b", "c", "d"];
    removeSlots(keys, 1, 2);
    expect(keys).toEqual(["a", "d"]);
  });
});

describe("removeRowsFrom", () => {
  it("drops items on removed rows and moves the rest up by the rows removed above", () => {
    const marks = [{ row: 1 }, { row: 3 }, { row: 4 }, { row: 7 }, { row: 9 }];
    expect(removeRowsFrom(marks, [3, 5, 6])).toEqual([
      { row: 1 },
      { row: 3 },
      { row: 4 },
      { row: 6 },
    ]);
  });

  it("matches applying shiftRows band by band, bottom first", () => {
    const marks = Array.from({ length: 40 }, (_, row) => ({ row: row + 1 }));
    const removed = [2, 3, 7, 10, 11, 12, 30];
    let banded = marks;
    for (const row of [...removed].reverse())
      banded = shiftRows(banded, row, -1);
    expect(removeRowsFrom(marks, removed)).toEqual(banded);
  });
});

describe("compactSlots", () => {
  it("closes the gaps in order and pads the tail, keeping the length", () => {
    const slots: (string | undefined)[] = [
      "a",
      "b",
      "c",
      "d",
      "e",
      undefined,
      "g",
    ];
    compactSlots(slots, [1, 3]);
    expect(slots).toEqual([
      "a",
      "c",
      "e",
      undefined,
      "g",
      undefined,
      undefined,
    ]);
  });
});

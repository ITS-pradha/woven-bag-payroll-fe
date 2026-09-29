import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DateCellPicker } from "./date-cell-picker";
import type { DateCellAnchor } from "./univer-grid";

const anchor: DateCellAnchor = {
  row: 3,
  column: 1,
  left: 200,
  top: 120,
  height: 34,
  value: "2026-09-14 07:00:00",
};

function renderPicker(overrides: Partial<DateCellAnchor> = {}) {
  const onApply = vi.fn();
  const onDismiss = vi.fn();
  render(
    <DateCellPicker
      anchor={{ ...anchor, ...overrides }}
      onApply={onApply}
      onDismiss={onDismiss}
    />,
  );
  return { onApply, onDismiss };
}

describe("DateCellPicker", () => {
  it("stays collapsed until the cell icon is used", () => {
    renderPicker();

    expect(
      screen.getByRole("button", {
        name: "Pilih tanggal dan jam Shift Start baris 3",
        expanded: false,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Shift Start")).not.toBeInTheDocument();
  });

  it("names the column and row it edits", () => {
    renderPicker({ column: 2, row: 7 });

    expect(
      screen.getByRole("button", {
        name: "Pilih tanggal dan jam Shift End baris 7",
      }),
    ).toBeInTheDocument();
  });

  /**
   * The grid keeps these cells as "YYYY-MM-DD HH:mm:ss" wall-clock text while
   * the input speaks "YYYY-MM-DDTHH:mm:ss". Only the separator differs, and
   * getting that wrong shows up as an unparseable row at save time.
   */
  it("opens on the cell's current value", async () => {
    renderPicker();

    await userEvent.click(
      screen.getByRole("button", { name: /Pilih tanggal/ }),
    );

    // Whole minutes come back without the ":00" — the browser normalises the
    // value, and the row validator accepts both spellings.
    expect(screen.getByLabelText("Shift Start")).toHaveValue(
      "2026-09-14T07:00",
    );
  });

  it("writes the picked value back in the grid's own format", async () => {
    const { onApply } = renderPicker();

    await userEvent.click(
      screen.getByRole("button", { name: /Pilih tanggal/ }),
    );
    const field = screen.getByLabelText("Shift Start");
    await userEvent.clear(field);
    await userEvent.type(field, "2026-09-15T15:30:45");

    expect(onApply).toHaveBeenLastCalledWith("2026-09-15 15:30:45");
  });

  it("opens empty for a blank cell without inventing a date", async () => {
    const { onApply } = renderPicker({ value: "" });

    await userEvent.click(
      screen.getByRole("button", { name: /Pilih tanggal/ }),
    );

    expect(screen.getByLabelText("Shift Start")).toHaveValue("");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("closes and hands focus back to the grid", async () => {
    const { onDismiss } = renderPicker();

    await userEvent.click(
      screen.getByRole("button", { name: /Pilih tanggal/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Selesai" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Shift Start")).not.toBeInTheDocument();
  });
});

import { useState } from "react";

import {
  applyRatePaste,
  copyRateRows,
  createEmptyRateRow,
  parseRateClipboard,
  type EditableRateRow,
} from "../model/rate-draft";

interface RateMatrixEditorProps {
  rows: EditableRateRow[];
  selected: Set<string>;
  editable: boolean;
  onRowsChange: (rows: EditableRateRow[]) => void;
  onSelectionChange: (selected: Set<string>) => void;
}

type VariantField = "threadWidth" | "baseRatePerMeter";

export function RateMatrixEditor({
  rows,
  selected,
  editable,
  onRowsChange,
  onSelectionChange,
}: RateMatrixEditorProps) {
  const [clipboardMessage, setClipboardMessage] = useState("");

  function updateWidth(
    rowId: string,
    field: "widthFromCm" | "widthToCm",
    value: string,
  ) {
    onRowsChange(
      rows.map((row) =>
        row.clientRowId === rowId ? { ...row, [field]: value } : row,
      ),
    );
  }

  function updateVariant(
    rowId: string,
    density: "10" | "11" | "12",
    field: VariantField,
    value: string,
  ) {
    onRowsChange(
      rows.map((row) =>
        row.clientRowId === rowId
          ? {
              ...row,
              variants: {
                ...row.variants,
                [density]: { ...row.variants[density], [field]: value },
              },
            }
          : row,
      ),
    );
  }

  function toggle(rowId: string) {
    const next = new Set(selected);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    onSelectionChange(next);
  }

  async function copySelection() {
    const text = copyRateRows(rows, [...selected]);
    if (!text) return setClipboardMessage("Pilih range yang akan disalin.");
    try {
      await navigator.clipboard.writeText(text);
      setClipboardMessage(`${selected.size} range disalin.`);
    } catch {
      setClipboardMessage(
        "Clipboard tidak dapat diakses. Salin langsung dari sel tabel.",
      );
    }
  }

  async function pasteSelection() {
    if (!editable) return;
    try {
      const matrix = parseRateClipboard(await navigator.clipboard.readText());
      const result = applyRatePaste(rows, [...selected], matrix);
      setClipboardMessage(
        result.error ?? `${selected.size} range diperbarui dari clipboard.`,
      );
      if (!result.error) onRowsChange(result.rows);
    } catch {
      setClipboardMessage(
        "Clipboard tidak dapat dibaca. Tempel langsung pada sel pertama.",
      );
    }
  }

  function pasteFromCell(
    event: React.ClipboardEvent<HTMLInputElement>,
    rowId: string,
  ) {
    const text = event.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return;
    event.preventDefault();
    const targetIds = selected.size > 0 ? [...selected] : [rowId];
    const result = applyRatePaste(rows, targetIds, parseRateClipboard(text));
    setClipboardMessage(
      result.error ?? `${targetIds.length} range diperbarui.`,
    );
    if (!result.error) onRowsChange(result.rows);
  }

  const allSelected = rows.length > 0 && selected.size === rows.length;

  return (
    <section
      className="min-h-0 border border-border bg-surface"
      aria-labelledby="rate-table-title"
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
        <div className="mr-auto min-w-48">
          <h2 id="rate-table-title" className="text-xs font-bold">
            Harga borongan per meter
          </h2>
          <p className="text-[0.625rem] text-muted">
            Urutan paste: lebar min, max, lalu lebar benang dan harga 10/11/12.
          </p>
        </div>
        <button
          type="button"
          className="min-h-7 border border-border px-2 text-[0.6875rem] font-semibold disabled:text-disabled"
          disabled={selected.size === 0}
          onClick={() => void copySelection()}
        >
          Salin ({selected.size})
        </button>
        <button
          type="button"
          className="min-h-7 border border-border px-2 text-[0.6875rem] font-semibold disabled:text-disabled"
          disabled={!editable || selected.size === 0}
          onClick={() => void pasteSelection()}
        >
          Tempel
        </button>
        <button
          type="button"
          className="min-h-7 border border-border px-2 text-[0.6875rem] font-semibold disabled:text-disabled"
          disabled={!editable}
          onClick={() => onRowsChange([...rows, createEmptyRateRow()])}
        >
          Tambah range
        </button>
        <button
          type="button"
          className="min-h-7 border border-border px-2 text-[0.6875rem] font-semibold text-danger disabled:text-disabled"
          disabled={!editable || selected.size === 0}
          onClick={() => {
            onRowsChange(rows.filter((row) => !selected.has(row.clientRowId)));
            onSelectionChange(new Set());
          }}
        >
          Hapus ({selected.size})
        </button>
      </div>
      {clipboardMessage ? (
        <p
          role="status"
          className="border-b border-border bg-surface-muted px-2 py-1 text-[0.6875rem] text-muted"
        >
          {clipboardMessage}
        </p>
      ) : null}
      <div className="max-h-[calc(100vh-26rem)] min-h-64 overflow-auto">
        <table
          className="w-full min-w-[62rem] table-fixed border-collapse text-xs"
          aria-label="Konfigurasi harga borongan"
        >
          <thead className="sticky top-0 z-10 bg-grid-header text-grid-header-foreground">
            <tr>
              <th rowSpan={2} className="w-10 border border-grid-border p-1">
                <input
                  type="checkbox"
                  aria-label="Pilih semua range harga"
                  checked={allSelected}
                  ref={(input) => {
                    if (input)
                      input.indeterminate = selected.size > 0 && !allSelected;
                  }}
                  onChange={(event) =>
                    onSelectionChange(
                      event.target.checked
                        ? new Set(rows.map((row) => row.clientRowId))
                        : new Set(),
                    )
                  }
                />
              </th>
              <th colSpan={2} className="border border-grid-border p-1">
                Lebar roll [cm]
              </th>
              <th colSpan={2} className="border border-grid-border p-1">
                10 × 10
              </th>
              <th colSpan={2} className="border border-grid-border p-1">
                11 × 11
              </th>
              <th colSpan={2} className="border border-grid-border p-1">
                12 × 12
              </th>
            </tr>
            <tr>
              {[
                "Minimum",
                "Maksimum",
                "Lebar benang",
                "Harga [Rp/m]",
                "Lebar benang",
                "Harga [Rp/m]",
                "Lebar benang",
                "Harga [Rp/m]",
              ].map((label, index) => (
                <th
                  key={`${label}-${index}`}
                  className="border border-grid-border p-1 font-semibold"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={row.clientRowId}
                className={
                  selected.has(row.clientRowId) ? "bg-info-soft" : "bg-surface"
                }
              >
                <td className="border border-grid-border p-1 text-center">
                  <input
                    type="checkbox"
                    aria-label={`Pilih range ${rowIndex + 1}`}
                    checked={selected.has(row.clientRowId)}
                    onChange={() => toggle(row.clientRowId)}
                  />
                </td>
                <RateInput
                  label={`Lebar minimum range ${rowIndex + 1}`}
                  value={row.widthFromCm}
                  disabled={!editable}
                  onChange={(value) =>
                    updateWidth(row.clientRowId, "widthFromCm", value)
                  }
                  onPaste={(event) => pasteFromCell(event, row.clientRowId)}
                />
                <RateInput
                  label={`Lebar maksimum range ${rowIndex + 1}`}
                  value={row.widthToCm}
                  disabled={!editable}
                  onChange={(value) =>
                    updateWidth(row.clientRowId, "widthToCm", value)
                  }
                />
                {(["10", "11", "12"] as const).flatMap((density) => [
                  <RateInput
                    key={`${density}-thread`}
                    label={`Lebar benang ${density} × ${density}, range ${rowIndex + 1}`}
                    value={row.variants[density].threadWidth}
                    disabled={!editable}
                    onChange={(value) =>
                      updateVariant(
                        row.clientRowId,
                        density,
                        "threadWidth",
                        value,
                      )
                    }
                  />,
                  <RateInput
                    key={`${density}-rate`}
                    label={`Harga ${density} × ${density}, range ${rowIndex + 1}`}
                    value={row.variants[density].baseRatePerMeter}
                    disabled={!editable}
                    onChange={(value) =>
                      updateVariant(
                        row.clientRowId,
                        density,
                        "baseRatePerMeter",
                        value,
                      )
                    }
                  />,
                ])}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">
            Belum ada range harga. Tambahkan range sebelum aktivasi.
          </p>
        ) : null}
      </div>
    </section>
  );
}

interface RateInputProps {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLInputElement>) => void;
}

function RateInput({
  label,
  value,
  disabled,
  onChange,
  onPaste,
}: RateInputProps) {
  return (
    <td className="border border-grid-border p-0">
      <input
        aria-label={label}
        inputMode="decimal"
        className="min-h-8 w-full border-0 bg-transparent px-2 text-right font-mono text-xs focus:outline-2 focus:-outline-offset-2 focus:outline-focus disabled:bg-surface-muted disabled:text-muted"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onPaste={onPaste}
      />
    </td>
  );
}

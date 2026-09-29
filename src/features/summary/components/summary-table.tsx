import { useState } from "react";
import { Link } from "react-router-dom";

import type { PayrollSummary } from "../api/summary-api";
import { formatRupiah, type OverrideField } from "../model/summary-draft";

export interface SummaryDraftValue {
  basePay: string;
  bonusPay: string;
}

export function SummaryTable({
  runId,
  rows,
  drafts,
  selected,
  editable,
  onSelect,
  onSelectAll,
  onChange,
  onPaste,
}: {
  runId: string;
  rows: PayrollSummary[];
  drafts: ReadonlyMap<string, SummaryDraftValue>;
  selected: ReadonlySet<string>;
  editable: boolean;
  onSelect: (pin: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
  onChange: (pin: string, field: OverrideField, value: string) => void;
  onPaste: (pin: string, field: OverrideField, text: string) => void;
}) {
  const allSelected =
    rows.length > 0 && rows.every((row) => selected.has(row.pin));
  return (
    <div className="min-h-0 flex-1 overflow-auto border-x border-border bg-surface">
      <table
        aria-label="Summary payroll per karyawan"
        className="w-full min-w-[74rem] table-fixed border-collapse text-xs"
      >
        <thead className="sticky top-0 z-10 bg-grid-header text-grid-header-foreground">
          <tr className="border-b border-grid-border">
            <th className="w-10 px-2 py-1.5">
              <input
                type="checkbox"
                aria-label="Pilih semua summary di halaman ini"
                checked={allSelected}
                onChange={(event) => onSelectAll(event.target.checked)}
              />
            </th>
            <th className="w-24 px-2 py-1.5 text-left">PIN</th>
            <th className="w-48 px-2 py-1.5 text-left">Nama karyawan</th>
            <th className="w-32 px-2 py-1.5 text-right">Calc. base</th>
            <th className="w-32 px-2 py-1.5 text-right">Base pay</th>
            <th className="w-32 px-2 py-1.5 text-right">Calc. bonus</th>
            <th className="w-32 px-2 py-1.5 text-right">Bonus pay</th>
            <th className="w-32 px-2 py-1.5 text-right">Total pay</th>
            <th className="w-24 px-2 py-1.5 text-right">Working days</th>
            <th className="w-28 px-2 py-1.5 text-left">Status</th>
            <th className="w-20 px-2 py-1.5">
              <span className="sr-only">Aksi</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const draft = drafts.get(row.pin);
            return (
              <tr
                key={row.pin}
                className={`border-b border-grid-border ${draft ? "bg-info-soft" : "hover:bg-surface-muted"}`}
              >
                <td className="px-2 py-1 text-center">
                  <input
                    type="checkbox"
                    aria-label={`Pilih ${row.employeeName}`}
                    checked={selected.has(row.pin)}
                    onChange={(event) =>
                      onSelect(row.pin, event.target.checked)
                    }
                  />
                </td>
                <td className="px-2 py-1 font-mono">{row.pin}</td>
                <td
                  className="truncate px-2 py-1 font-semibold"
                  title={row.employeeName}
                >
                  {row.employeeName}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {formatRupiah(row.calculatedBasePay)}
                </td>
                <MoneyCell
                  row={row}
                  field="basePay"
                  value={draft?.basePay ?? row.basePay}
                  editable={editable}
                  onChange={onChange}
                  onPaste={onPaste}
                />
                <td className="px-2 py-1 text-right tabular-nums">
                  {formatRupiah(row.calculatedBonusPay)}
                </td>
                <MoneyCell
                  row={row}
                  field="bonusPay"
                  value={draft?.bonusPay ?? row.bonusPay}
                  editable={editable}
                  onChange={onChange}
                  onPaste={onPaste}
                />
                <td className="px-2 py-1 text-right font-bold tabular-nums">
                  {formatRupiah(row.totalPay)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {row.workingDays} hari
                </td>
                <td className="px-2 py-1">
                  <span
                    className={
                      row.hasBlockingException
                        ? "font-bold text-danger"
                        : row.hasOverride
                          ? "font-bold text-warning-strong"
                          : "text-muted"
                    }
                  >
                    {row.hasBlockingException
                      ? "PERLU DICEK"
                      : row.hasOverride
                        ? "OVERRIDE"
                        : "TERHITUNG"}
                  </span>
                </td>
                <td className="px-2 py-1 text-center">
                  <Link
                    className="font-semibold text-brand-strong underline underline-offset-2"
                    to={`/detail?run=${encodeURIComponent(runId)}&pin=${encodeURIComponent(row.pin)}`}
                  >
                    Detail
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MoneyCell({
  row,
  field,
  value,
  editable,
  onChange,
  onPaste,
}: {
  row: PayrollSummary;
  field: OverrideField;
  value: string;
  editable: boolean;
  onChange: (pin: string, field: OverrideField, value: string) => void;
  onPaste: (pin: string, field: OverrideField, text: string) => void;
}) {
  /*
    Rupiah only while the cell is at rest, the exact value while it is being
    edited. Formatting is presentation: it never reaches the draft, so merely
    tabbing through a row cannot round a stored 3384288.6953 into an override.
    The exact value stays one hover away in the tooltip.
  */
  const [editing, setEditing] = useState(false);
  // Only the server's own value is formatted. A draft is shown as typed:
  // "3500.500" reads as 3.500.500 to the save path's parser but would render
  // as Rp3.501 here, and a cell must never show a number other than the one
  // that will be sent.
  const saved = value === row[field];
  const shown = editing || !saved ? value : formatRupiah(value);
  return (
    <td className="p-0.5">
      <input
        aria-label={`${field === "basePay" ? "Base pay" : "Bonus pay"} ${row.employeeName}`}
        inputMode="decimal"
        className="h-7 w-full border border-transparent bg-transparent px-1.5 text-right tabular-nums focus:border-focus focus:bg-surface focus:outline-none disabled:text-foreground"
        value={shown}
        title={shown !== value ? value : undefined}
        disabled={!editable}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onChange={(event) => onChange(row.pin, field, event.target.value)}
        onPaste={(event) => {
          event.preventDefault();
          onPaste(row.pin, field, event.clipboardData.getData("text/plain"));
        }}
      />
    </td>
  );
}

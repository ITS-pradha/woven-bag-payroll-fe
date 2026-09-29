import { useState } from "react";

import { formatRupiah, formatRupiahRate } from "../../../lib/format-money";
import type { PayrollProductionLine } from "../api/detail-api";
import { formatDateTimeWib, formatDecimal } from "../model/detail-format";
import { CalculationTracePanel } from "./calculation-trace-panel";

export function ProductionLinesTable({
  employeeName,
  rows,
}: {
  employeeName: string;
  rows: PayrollProductionLine[];
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <div className="min-h-0 flex-1 overflow-auto border-x border-t border-border bg-surface">
      <table
        aria-label={`Rincian produksi ${employeeName}`}
        className="w-full min-w-[86rem] table-fixed border-collapse text-[0.6875rem]"
      >
        <thead className="sticky top-0 z-10 bg-grid-header text-grid-header-foreground">
          <tr className="border-b border-grid-border">
            <th className="w-36 px-2 py-1.5 text-left">Shift start</th>
            <th className="w-36 px-2 py-1.5 text-left">Shift end</th>
            <th className="w-16 px-2 py-1.5 text-right">Mesin</th>
            <th className="w-20 px-2 py-1.5 text-right">Width</th>
            <th className="w-20 px-2 py-1.5 text-right">Weft</th>
            <th className="w-20 px-2 py-1.5 text-right">Result</th>
            <th className="w-20 px-2 py-1.5 text-right">Durasi</th>
            <th className="w-24 px-2 py-1.5 text-right">Target</th>
            <th className="w-24 px-2 py-1.5 text-right">Tarif/m</th>
            <th className="w-28 px-2 py-1.5 text-right">Base pay</th>
            <th className="w-28 px-2 py-1.5 text-right">Bonus</th>
            <th className="w-28 px-2 py-1.5 text-right">Total</th>
            <th className="w-32 px-2 py-1.5 text-left">Versi harga</th>
            <th className="w-20 px-2 py-1.5 text-center">Trace</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = expandedId === row.id;
            return (
              <FragmentRow
                key={row.id}
                row={row}
                expanded={expanded}
                onToggle={() => setExpandedId(expanded ? null : row.id)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({
  row,
  expanded,
  onToggle,
}: {
  row: PayrollProductionLine;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b border-grid-border hover:bg-surface-muted">
        <td className="px-2 py-1 tabular-nums">
          {formatDateTimeWib(row.shiftStart)}
        </td>
        <td className="px-2 py-1 tabular-nums">
          {formatDateTimeWib(row.shiftEnd)}
        </td>
        <td className="px-2 py-1 text-right tabular-nums">{row.stationNo}</td>
        <td className="px-2 py-1 text-right tabular-nums">
          {formatDecimal(row.widthCm)} cm
        </td>
        <td className="px-2 py-1 text-right tabular-nums">
          {formatDecimal(row.weftDensity)}
        </td>
        <td className="px-2 py-1 text-right tabular-nums">
          {formatDecimal(row.resultMeter)} m
        </td>
        <td className="px-2 py-1 text-right tabular-nums">
          {formatDecimal(row.durationHours)} jam
        </td>
        <td className="px-2 py-1 text-right tabular-nums">
          {formatDecimal(row.targetMeter)} m
        </td>
        <td className="px-2 py-1 text-right tabular-nums">
          {formatRupiahRate(row.payRatePerMeter)}
        </td>
        <td className="px-2 py-1 text-right tabular-nums">
          {formatRupiah(row.calculatedBasePay)}
        </td>
        <td className="px-2 py-1 text-right tabular-nums">
          {formatRupiah(row.calculatedBonusPay)}
        </td>
        <td className="px-2 py-1 text-right font-bold tabular-nums">
          {formatRupiah(row.calculatedTotalPay)}
        </td>
        <td className="truncate px-2 py-1" title={row.rateVersionCode}>
          {row.rateVersionCode}
        </td>
        <td className="px-2 py-1 text-center">
          <button
            type="button"
            aria-expanded={expanded}
            className="font-semibold text-brand-strong underline underline-offset-2"
            onClick={onToggle}
          >
            {expanded ? "Tutup" : `Lihat trace mesin ${row.stationNo}`}
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-grid-border bg-info-soft">
          <td colSpan={14} className="px-3 py-3">
            <CalculationTracePanel
              stationNo={row.stationNo}
              trace={row.calculationTrace}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

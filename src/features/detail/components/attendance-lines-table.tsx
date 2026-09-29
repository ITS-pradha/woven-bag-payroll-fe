import type { PayrollAttendanceLine } from "../api/detail-api";
import { formatDateWib, formatDecimal } from "../model/detail-format";

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

export function AttendanceLinesTable({
  employeeName,
  rows,
}: {
  employeeName: string;
  rows: PayrollAttendanceLine[];
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto border-x border-t border-border bg-surface">
      <table
        aria-label={`Rincian attendance ${employeeName}`}
        className="w-full min-w-[56rem] table-fixed border-collapse text-xs"
      >
        <thead className="sticky top-0 z-10 bg-grid-header text-grid-header-foreground">
          <tr className="border-b border-grid-border">
            <th className="w-28 px-2 py-1.5 text-left">Tanggal</th>
            <th className="w-28 px-2 py-1.5 text-left">Shift</th>
            <th className="w-36 px-2 py-1.5 text-left">Status</th>
            <th className="w-28 px-2 py-1.5 text-right">Working days</th>
            <th className="w-24 px-2 py-1.5 text-right">Jam kerja</th>
            <th className="w-24 px-2 py-1.5 text-right">Lembur</th>
            <th className="px-2 py-1.5 text-left">Keputusan HRD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-grid-border hover:bg-surface-muted"
            >
              <td className="px-2 py-1 tabular-nums">
                {formatDateWib(row.workingDate)}
              </td>
              <td className="px-2 py-1">{statusLabel(row.shiftCode)}</td>
              <td className="px-2 py-1 font-semibold">
                {statusLabel(row.attendanceStatus)}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">
                {formatDecimal(row.workingDays)}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">
                {formatDecimal(row.workingHours)} jam
              </td>
              <td className="px-2 py-1 text-right tabular-nums">
                {formatDecimal(row.overtimeHours)} jam
              </td>
              <td className="px-2 py-1">{row.decisionReason ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { formatRupiah } from "../../../lib/format-money";
import type { PayrollPinDetail } from "../api/detail-api";
import { formatDecimal } from "../model/detail-format";

export function DetailSummary({ detail }: { detail: PayrollPinDetail }) {
  const { summary } = detail;
  const metrics = [
    ["Base pay", formatRupiah(summary.basePay)],
    ["Bonus pay", formatRupiah(summary.bonusPay)],
    ["Penyesuaian absen", formatRupiah(summary.attendanceAdjustment)],
    ["Total pay", formatRupiah(summary.totalPay)],
    ["Working days", `${formatDecimal(summary.workingDays)} hari`],
    ["Jam kerja", `${formatDecimal(summary.workingHours)} jam`],
    ["Lembur", `${formatDecimal(summary.overtimeHours)} jam`],
  ];
  return (
    <section aria-label={`Ringkasan payroll ${summary.employeeName}`}>
      <div className="flex flex-wrap items-center gap-x-3 border border-border bg-surface px-3 py-2">
        <div className="mr-auto min-w-52">
          <h2 className="text-sm font-bold">{summary.employeeName}</h2>
          <p className="text-[0.6875rem] text-muted">PIN {summary.pin}</p>
        </div>
        {summary.hasOverride ? (
          <span className="border border-warning-border bg-warning-soft px-1.5 py-0.5 text-[0.625rem] font-bold text-warning-strong">
            OVERRIDE
          </span>
        ) : null}
        {summary.hasBlockingException ? (
          <span className="border border-danger/30 px-1.5 py-0.5 text-[0.625rem] font-bold text-danger">
            PERLU DICEK
          </span>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 border-x border-b border-border bg-surface sm:grid-cols-4 xl:grid-cols-7">
        {metrics.map(([label, value]) => (
          <div
            key={label}
            className="min-w-0 border-r border-border px-3 py-2 last:border-r-0"
          >
            <dt className="text-[0.5625rem] font-bold uppercase tracking-wide text-muted">
              {label}
            </dt>
            <dd
              className="mt-0.5 truncate text-xs font-bold tabular-nums"
              title={value}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

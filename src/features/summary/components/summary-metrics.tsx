import type { PayrollSummaryListResponse } from "../api/summary-api";
import { formatRupiah } from "../model/summary-draft";

export function SummaryMetrics({
  aggregate,
  pinCount,
}: {
  aggregate: PayrollSummaryListResponse["aggregate"];
  pinCount: number;
}) {
  const items = [
    ["Karyawan", `${pinCount} PIN`],
    ["Total base pay", formatRupiah(aggregate.totalBasePay)],
    ["Total bonus", formatRupiah(aggregate.totalBonusPay)],
    ["Total payroll", formatRupiah(aggregate.totalPay)],
    ["Working days", `${aggregate.totalWorkingDays} hari`],
  ] as const;
  return (
    <section
      aria-label="Ringkasan nominal payroll"
      className="grid border border-border bg-surface sm:grid-cols-3 xl:grid-cols-5"
    >
      {items.map(([label, value]) => (
        <div
          key={label}
          className="min-w-0 border-b border-border px-3 py-2 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
        >
          <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted">
            {label}
          </p>
          <strong className="block truncate text-sm">{value}</strong>
        </div>
      ))}
    </section>
  );
}

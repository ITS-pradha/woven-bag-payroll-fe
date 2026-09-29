import type { PayrollRun } from "../api/summary-api";

const labels: Record<PayrollRun["status"], string> = {
  QUEUED: "ANTREAN",
  CALCULATING: "MENGHITUNG",
  GENERATED: "SIAP DIPERIKSA",
  REVIEWED: "SUDAH DIREVIEW",
  LOCKED: "TERKUNCI",
  FAILED: "GAGAL",
  CANCELLED: "DIBATALKAN",
};

export function SummaryStatusBadge({
  status,
}: {
  status: PayrollRun["status"];
}) {
  const tone =
    status === "LOCKED" || status === "REVIEWED" || status === "GENERATED"
      ? "border-success-border bg-success-soft text-success-strong"
      : status === "FAILED" || status === "CANCELLED"
        ? "border-danger/30 bg-surface text-danger"
        : "border-warning-border bg-warning-soft text-warning-strong";
  return (
    <span
      className={`inline-flex min-h-5 items-center border px-1.5 text-[0.625rem] font-bold ${tone}`}
    >
      {labels[status]}
    </span>
  );
}

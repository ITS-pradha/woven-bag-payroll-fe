import type { RateVersion } from "../api/rates-api";

const statusCopy = {
  DRAFT: "DRAFT",
  ACTIVE: "AKTIF",
  RETIRED: "HISTORI",
} as const;

export function RateStatusBadge({ status }: { status: RateVersion["status"] }) {
  const color =
    status === "ACTIVE"
      ? "border-success-border bg-success-soft text-success-strong"
      : status === "DRAFT"
        ? "border-info-border bg-info-soft text-info-strong"
        : "border-border bg-surface-muted text-muted";
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[0.625rem] font-bold ${color}`}
    >
      {statusCopy[status]}
    </span>
  );
}

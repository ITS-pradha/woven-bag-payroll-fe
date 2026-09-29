import type { PayrollRun } from "../api/summary-api";
import { SummaryStatusBadge } from "./summary-status-badge";

function createdLabel(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

export function PayrollRunSelector({
  runs,
  selected,
  onSelect,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  runs: PayrollRun[];
  selected: PayrollRun | undefined;
  onSelect: (id: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <section className="flex min-w-0 flex-wrap items-center gap-2 border border-border bg-surface px-3 py-2">
      <label className="min-w-52 flex-1 text-[0.6875rem] font-semibold">
        Histori payroll
        <select
          aria-label="Pilih payroll run"
          className="mt-1 min-h-8 w-full border border-border-strong bg-surface px-2 text-xs focus:outline-2 focus:outline-focus"
          value={selected?.id ?? ""}
          onChange={(event) => onSelect(event.target.value)}
        >
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              Run {run.runNo} · {createdLabel(run.createdAt)} · {run.status}
            </option>
          ))}
        </select>
      </label>
      {selected ? (
        <div className="flex items-center gap-2 self-end pb-1">
          <SummaryStatusBadge status={selected.status} />
          <span className="text-[0.6875rem] text-muted">
            {selected.pinCount} PIN · {selected.sourceRowCount} data produksi
          </span>
        </div>
      ) : null}
      {hasMore ? (
        <button
          type="button"
          className="min-h-8 self-end border border-border-strong px-2 text-xs font-semibold"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? "Memuat…" : "Muat histori"}
        </button>
      ) : null}
    </section>
  );
}

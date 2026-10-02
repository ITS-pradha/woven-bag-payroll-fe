import {
  GhostBar,
  GhostLabel,
  GhostTable,
} from "../../../components/empty-state/empty-state";
import {
  SUMMARY_COLUMNS,
  SUMMARY_HEAD,
  SUMMARY_METRICS,
} from "../model/table-layout";

/**
 * Sketsa layar Summary: deretan metrik nominal payroll di atas tabel per
 * karyawan, dengan judul kolomnya sendiri.
 */
export function SummaryEmptyBackdrop() {
  return (
    <div className="grid gap-2 p-2">
      <div className="ghost-box grid sm:grid-cols-3 xl:grid-cols-5">
        {SUMMARY_METRICS.map((label) => (
          <div
            key={label}
            className="grid gap-1.5 border-r border-border px-3 py-2.5 last:border-r-0"
          >
            <GhostLabel text={label} />
            <GhostBar width="60%" height="0.75rem" />
          </div>
        ))}
      </div>
      <GhostTable
        columns={SUMMARY_COLUMNS}
        head={SUMMARY_HEAD}
        rows={12}
        filled
      />
    </div>
  );
}

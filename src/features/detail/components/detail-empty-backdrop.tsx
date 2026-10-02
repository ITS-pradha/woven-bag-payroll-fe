import {
  GhostBar,
  GhostLabel,
  GhostTable,
} from "../../../components/empty-state/empty-state";
import { PRODUCTION_COLUMNS, PRODUCTION_HEAD } from "../model/table-layout";

/**
 * Sketsa layar Detail: kartu karyawan (nama, PIN, total), tab Produksi /
 * Attendance, lalu tabel rincian produksi dengan judul kolomnya sendiri.
 */
export function DetailEmptyBackdrop() {
  return (
    <div className="grid gap-2 p-2">
      <div className="ghost-box flex items-center gap-3 p-3">
        <span className="size-9 shrink-0 rounded-full bg-border" />
        <div className="grid gap-1.5">
          <GhostBar width="11rem" height="0.625rem" />
          <GhostBar width="6rem" />
        </div>
        <div className="ml-auto hidden gap-8 md:flex">
          {["Produksi", "Attendance", "Working days", "Total pay"].map(
            (label) => (
              <div key={label} className="grid gap-1.5">
                <GhostLabel text={label} />
                <GhostBar width="5.5rem" height="0.625rem" />
              </div>
            ),
          )}
        </div>
      </div>
      <div className="flex gap-5 border-b border-border px-2 pb-1.5">
        <GhostLabel text="Produksi" />
        <GhostLabel text="Attendance" />
      </div>
      <GhostTable
        columns={PRODUCTION_COLUMNS}
        head={PRODUCTION_HEAD}
        rows={14}
        filled
      />
    </div>
  );
}

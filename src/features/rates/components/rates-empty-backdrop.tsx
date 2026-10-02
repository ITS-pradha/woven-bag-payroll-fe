import {
  GhostBar,
  GhostLabel,
  GhostTable,
} from "../../../components/empty-state/empty-state";

const MATRIX_COLUMNS = [12, 12, 12, 12, 12, 12, 12, 12];
const MATRIX_HEAD = [
  "Min [cm]",
  "Maks [cm]",
  "10 × 10",
  "Harga",
  "11 × 11",
  "Harga",
  "12 × 12",
  "Harga",
] as const;

/**
 * Sketsa layar Tabel harga: daftar versi di kiri (kode, status, masa
 * berlaku), matriks harga di kanan — range lebar roll per baris, lalu lebar
 * benang dan harga per anyaman.
 */
export function RatesEmptyBackdrop() {
  return (
    <div className="grid gap-2 p-2 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="ghost-box hidden content-start gap-0 lg:grid">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="grid gap-1.5 border-b border-border px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <GhostBar width={`${[58, 46, 64, 52, 40, 60][index]}%`} />
              <span className="h-3.5 w-12 rounded-full border border-border" />
            </div>
            <GhostBar width="40%" height="0.375rem" />
          </div>
        ))}
      </div>
      <GhostTable
        columns={MATRIX_COLUMNS}
        head={MATRIX_HEAD}
        rows={16}
        filled
      />
    </div>
  );
}

/**
 * Banyak chip per kelompok hanya bentuk, bukan data: tidak ada nomor station
 * contoh yang bisa terbaca seperti mapping sungguhan.
 */
const STATION_GROUPS = [
  { label: "Regular", chips: 12 },
  { label: "CS", chips: 8 },
  { label: "SP", chips: 4 },
] as const;

/**
 * Sketsa layar Kelompok mesin: tiga kelompok, masing-masing berisi nomor
 * station yang dipetakan ke sana.
 */
export function StationsEmptyBackdrop() {
  return (
    <div className="grid gap-2 p-2 md:grid-cols-3">
      {STATION_GROUPS.map((group) => (
        <div key={group.label} className="ghost-box grid content-start">
          <div className="flex items-center justify-between border-b border-border bg-grid-header px-3 py-2">
            <GhostLabel text={group.label} />
          </div>
          <div className="grid grid-cols-4 gap-1.5 p-3">
            {Array.from({ length: group.chips }, (_, index) => (
              <span key={index} className="ghost-chip">
                <GhostBar width="1rem" height="0.375rem" />
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

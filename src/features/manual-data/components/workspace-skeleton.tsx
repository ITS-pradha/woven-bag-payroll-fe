import type { ReactNode } from "react";

import "../../../components/skeleton/skeleton.css";

/**
 * Loading Manual Data sebagai bentuk layar yang akan muncul, bukan deretan
 * strip teks.
 *
 * Empat tahap berjalan berurutan (buku → produksi → nama karyawan → engine
 * spreadsheet), dan dulu masing-masing punya strip sendiri yang muncul lalu
 * hilang, sehingga layar melompat tiga kali sebelum grid tampil. Di sini
 * kerangka dua kolomnya sama persis dengan workspace, dan yang berubah hanya
 * satu penanda tahap — grid lalu menggantikan kerangkanya di tempat.
 */
export type LoadStage = "periods" | "production" | "employees" | "engine";

const STAGES: { id: LoadStage; label: string }[] = [
  { id: "periods", label: "Membuka buku periode" },
  { id: "production", label: "Memuat data produksi" },
  { id: "employees", label: "Mencocokkan nama karyawan" },
  { id: "engine", label: "Menyiapkan spreadsheet" },
];

/** Lebar isian per kolom, bergiliran — rata semua terbaca seperti pola, bukan data. */
const CELL_WIDTHS = [
  [100, 78, 78, 60, 86, 70, 64, 72],
  [100, 78, 78, 44, 62, 56, 64, 58],
  [100, 78, 78, 60, 74, 70, 50, 80],
  [100, 78, 78, 52, 90, 56, 64, 66],
];
/** Cukup untuk layar tertinggi; kelebihannya terpotong oleh kontainer. */
const ROWS = 36;

export function WorkspaceSkeleton({
  stage,
  controls,
}: {
  stage: LoadStage;
  /** Pemilih buku asli: tetap bisa dipakai selama memuat. */
  controls: ReactNode;
}) {
  return (
    <section
      className="manual-workspace manual-skeleton"
      aria-busy="true"
      aria-labelledby="manual-skeleton-title"
    >
      <h2 id="manual-skeleton-title" className="manual-page-heading">
        Data produksi
      </h2>
      <div className="manual-split">
        <div className="manual-split-grid">
          <GridSkeleton stage={stage} />
        </div>
        <div className="manual-split-side">
          <div className="manual-side-controls">
            {controls}
            <div className="manual-skeleton-side" aria-hidden="true">
              <div className="manual-skeleton-heading">
                <span
                  className="skeleton-bone manual-skeleton-bar"
                  style={{ width: "7rem" }}
                />
                <span className="skeleton-bone manual-skeleton-block" />
              </div>
              <span
                className="skeleton-bone manual-skeleton-bar"
                style={{ width: "72%" }}
              />
              {[5, 3, 3].map((count, row) => (
                <div key={row} className="manual-skeleton-buttons">
                  {Array.from({ length: count }, (_, index) => (
                    <span
                      key={index}
                      className="skeleton-bone manual-skeleton-chip"
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Kerangka grid saja. Dipakai sendiri sebagai fallback engine spreadsheet,
 * saat kolom kanan sudah berisi kontrol sungguhan.
 */
export function GridSkeleton({ stage }: { stage: LoadStage }) {
  const current = STAGES.findIndex((item) => item.id === stage);
  const label = STAGES[current]?.label ?? "Memuat";
  return (
    <div className="manual-skeleton-grid">
      <div className="manual-skeleton-table" aria-hidden="true">
        <div className="manual-skeleton-row manual-skeleton-head">
          {CELL_WIDTHS[0]!.map((_, column) => (
            <span key={column} className="manual-skeleton-cell">
              <span
                className="skeleton-bone manual-skeleton-bar"
                style={{ width: "55%" }}
              />
            </span>
          ))}
        </div>
        {Array.from({ length: ROWS }, (_, row) => (
          <div key={row} className="manual-skeleton-row">
            {CELL_WIDTHS[row % CELL_WIDTHS.length]!.map((width, column) => (
              <span key={column} className="manual-skeleton-cell">
                {column === 0 ? (
                  <span className="skeleton-bone manual-skeleton-box" />
                ) : (
                  <span
                    className="skeleton-bone manual-skeleton-bar"
                    style={{ width: `${width}%` }}
                  />
                )}
              </span>
            ))}
          </div>
        ))}
      </div>

      <div className="manual-load-stage" role="status" aria-live="polite">
        <p className="manual-load-label">{label}…</p>
        <ol className="manual-load-steps" aria-label="Tahap memuat">
          {STAGES.map((item, index) => (
            <li
              key={item.id}
              data-state={
                index < current ? "done" : index === current ? "active" : "todo"
              }
            >
              <span className="manual-visually-hidden">
                {item.label}
                {index < current
                  ? " (selesai)"
                  : index === current
                    ? " (sedang berjalan)"
                    : ""}
              </span>
            </li>
          ))}
        </ol>
        <p className="manual-load-count">
          Langkah {current + 1} dari {STAGES.length}
        </p>
      </div>
    </div>
  );
}

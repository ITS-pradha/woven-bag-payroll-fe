import { formatSaveTime } from "../model/save-time";

/**
 * Simpan, dari tombol sampai hasil, di satu tempat di bawah tombol Simpan.
 *
 * Dulu Simpan hanya mengganti satu baris teks abu-abu: "Menyimpan batch…",
 * lalu "3 ditambahkan · 0 diperbarui · 0 tetap · 1 ditolak". Pencocokan
 * karyawan ke HRIS — langkah yang paling lama pada draft besar — tidak
 * tampil sama sekali, jadi layar terlihat diam, dan hasilnya harus dibaca
 * kata per kata untuk tahu apakah ada yang ditolak.
 *
 * Satu batang dipakai untuk dua hal, berurutan: selama pengiriman ia terisi
 * sesuai baris yang sudah terkirim (angka sungguhan dari batch, bukan
 * animasi karangan), dan begitu server menjawab ia terbelah menjadi
 * proporsi hasilnya. Mata yang mengikuti progres langsung mendarat di hasil.
 */
export type SaveStep = "check" | "shift" | "send";

export interface SaveCounts {
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
}

export type SaveRun =
  | {
      phase: "running";
      step: SaveStep;
      /** Baris yang akan dikirim; belum diketahui selama pemeriksaan. */
      total: number;
      sent: number;
      /** Ada baris tersimpan yang shift-nya dipindah lewat PATCH. */
      withShift: boolean;
    }
  | {
      phase: "done";
      counts: SaveCounts;
      /** Baris tersimpan yang dipindah shift-nya lewat PATCH. */
      moved: number;
      at: Date;
      /** Baris (1-based) pertama yang ditolak, untuk lompat ke sana. */
      firstRejectedRow: number | null;
      /**
       * Simpan berbatch yang berhenti di tengah: batch sebelumnya tersimpan
       * (itulah `counts`), sisanya belum. Berisi jumlah baris yang belum
       * terkirim dan alasannya.
       */
      unsent?: { rows: number; reason: string };
    };

const STEP_LABEL: Record<SaveStep | "done", string> = {
  check: "Periksa draft",
  shift: "Pindah shift",
  send: "Kirim ke server",
  done: "Selesai",
};

const SEGMENTS = [
  ["inserted", "baru"],
  ["updated", "diperbarui"],
  ["unchanged", "tetap"],
  ["rejected", "ditolak"],
] as const;

export function SaveProgress({
  run,
  onShowRow,
  rowLabel,
}: {
  run: SaveRun;
  onShowRow(row: number): void;
  /** Row number as the sheet's own gutter prints it (header is row 1). */
  rowLabel(row: number): string;
}) {
  const steps: (SaveStep | "done")[] = [
    "check",
    ...((run.phase === "running" ? run.withShift : run.moved > 0)
      ? (["shift"] as const)
      : []),
    "send",
    "done",
  ];
  const current =
    run.phase === "done" ? steps.length - 1 : steps.indexOf(run.step);

  return (
    <section
      className="manual-save"
      data-phase={run.phase}
      data-outcome={
        run.phase === "done"
          ? run.counts.rejected > 0
            ? "partial"
            : "ok"
          : undefined
      }
      aria-label="Proses simpan"
      aria-busy={run.phase === "running"}
    >
      <ol className="manual-save-steps">
        {steps.map((step, index) => (
          <li
            key={step}
            aria-current={index === current ? "step" : undefined}
            data-state={
              index < current || run.phase === "done"
                ? "done"
                : index === current
                  ? "active"
                  : "todo"
            }
          >
            {STEP_LABEL[step]}
          </li>
        ))}
      </ol>
      {run.phase === "running" ? <Running run={run} /> : null}
      {run.phase === "done" ? (
        <Done run={run} onShowRow={onShowRow} rowLabel={rowLabel} />
      ) : null}
    </section>
  );
}

function Running({ run }: { run: Extract<SaveRun, { phase: "running" }> }) {
  // A percentage only once a batch has actually landed. Before that — and for
  // the whole of a single-batch save — "0%" would read as stuck, not as
  // waiting for the server's answer.
  const percent =
    run.step === "send" && run.total > 0 && run.sent > 0
      ? Math.round((run.sent / run.total) * 100)
      : undefined;
  const rows = run.total.toLocaleString("id-ID");
  const message =
    run.step === "check"
      ? "Memeriksa sel dan mencocokkan karyawan ke HRIS…"
      : run.step === "shift"
        ? "Memperbarui shift baris tersimpan…"
        : percent === undefined
          ? `Mengirim ${rows} baris, menunggu jawaban server…`
          : `Mengirim ${rows} baris · ${run.sent.toLocaleString("id-ID")} terkirim`;
  return (
    <>
      <div className="manual-save-bar" aria-hidden="true">
        <span
          className={
            percent === undefined
              ? "manual-save-fill manual-save-indeterminate"
              : "manual-save-fill"
          }
          style={
            percent === undefined
              ? undefined
              : { transform: `scaleX(${percent / 100})` }
          }
        />
      </div>
      <p role="status" className="manual-save-message">
        {message}
        {percent === undefined ? "" : ` (${percent}%)`}
      </p>
    </>
  );
}

function Done({
  run,
  onShowRow,
  rowLabel,
}: {
  run: Extract<SaveRun, { phase: "done" }>;
  onShowRow(row: number): void;
  rowLabel(row: number): string;
}) {
  const { counts, firstRejectedRow: firstRejected } = run;
  const total =
    counts.inserted + counts.updated + counts.unchanged + counts.rejected;
  const written = counts.inserted + counts.updated + run.moved;
  const headline = run.unsent
    ? `${written.toLocaleString("id-ID")} baris tersimpan, ${run.unsent.rows.toLocaleString("id-ID")} belum terkirim`
    : counts.rejected > 0
      ? `${written.toLocaleString("id-ID")} baris tersimpan, ${counts.rejected.toLocaleString("id-ID")} ditolak`
      : written > 0
        ? `${written.toLocaleString("id-ID")} baris tersimpan`
        : "Server sudah sama dengan draft";
  return (
    <>
      {total > 0 && (
        <div className="manual-save-bar manual-save-split" aria-hidden="true">
          {SEGMENTS.map(([key]) =>
            counts[key] > 0 ? (
              <span
                key={key}
                className="manual-save-segment"
                data-kind={key}
                style={{ flexGrow: counts[key] }}
              />
            ) : null,
          )}
        </div>
      )}
      <p role="status" className="manual-save-headline">
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          {counts.rejected > 0 || run.unsent ? (
            <path d="M8 4.5v4.25M8 11.25v.25" />
          ) : (
            <path d="m4 8.25 2.75 2.75L12 5.5" />
          )}
        </svg>
        <span>
          {headline}
          <span className="manual-save-time">
            {" "}
            · pukul {formatSaveTime(run.at)}
          </span>
        </span>
      </p>
      <ul className="manual-save-legend">
        {run.moved > 0 && (
          <li data-kind="updated">
            <strong>{run.moved.toLocaleString("id-ID")}</strong> shift dipindah
          </li>
        )}
        {SEGMENTS.map(([key, label]) => (
          <li
            key={key}
            data-kind={key}
            data-zero={counts[key] === 0 || undefined}
          >
            <strong>{counts[key].toLocaleString("id-ID")}</strong> {label}
          </li>
        ))}
      </ul>
      {run.unsent && (
        <p role="alert" className="manual-save-unsent">
          Pengiriman berhenti: {run.unsent.reason} Baris yang sudah tersimpan
          tidak dikirim ulang; klik Simpan lagi untuk mengirim sisanya.
        </p>
      )}
      {firstRejected !== null && (
        <button
          type="button"
          className="manual-save-jump"
          onClick={() => onShowRow(firstRejected)}
        >
          Lihat baris ditolak pertama (baris {rowLabel(firstRejected)})
        </button>
      )}
    </>
  );
}

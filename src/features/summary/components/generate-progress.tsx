import type { PayrollRun } from "../api/summary-api";
import { STALE_QUEUE_MS } from "./hris-sync-progress";
import { JobProgressDialog, type JobResultItem } from "./job-progress-dialog";
import { formatDay } from "../model/format-day";

/**
 * Pop-up "Generate payroll" / "Generate ulang". Setelah run dibuat, tahapnya
 * diturunkan dari status run (QUEUED → CALCULATING → GENERATED) yang sudah
 * di-polling query run — pop-up tidak menambah request sendiri.
 *
 * Worker menghitung seluruh baris periode dalam satu kali jalan dan baru
 * melaporkan jumlah baris/PIN setelah selesai, jadi angka itu tampil di akhir,
 * bukan sebagai hitungan berjalan.
 */
export interface GenerateProgressState {
  kind: "generate" | "regenerate";
  startedAt: number;
  periodStart: string;
  periodEnd: string;
  sourceRunNo?: number | undefined;
  /** Ada setelah POST run berhasil; sebelum itu tahap "Kirim permintaan". */
  runId?: string | undefined;
  /** Gagal sebelum run terbentuk (jaringan, validasi). */
  error?: string | undefined;
}

const STEPS = [
  {
    label: "Kirim permintaan",
    hint: "Menyiapkan buku periode dan mendaftarkan run ke antrean.",
  },
  {
    label: "Antre di worker",
    hint: "Menunggu worker payroll mengambil tugas.",
  },
  {
    label: "Menghitung payroll",
    hint: "Menghargai tiap baris produksi dengan tarif dan mencocokkan attendance.",
  },
  {
    label: "Tersimpan",
    hint: "Summary per karyawan siap direview.",
  },
] as const;

const DONE: ReadonlySet<PayrollRun["status"]> = new Set([
  "GENERATED",
  "REVIEWED",
  "LOCKED",
]);

export function GenerateProgress({
  state,
  run,
  onRetry,
  onDismiss,
}: {
  state: GenerateProgressState;
  /** Run dari cache query; kosong sampai POST run berhasil. */
  run: PayrollRun | undefined;
  onRetry?: (() => void) | undefined;
  onDismiss: () => void;
}) {
  const runFailed = run?.status === "FAILED" || run?.status === "CANCELLED";
  const status =
    state.error || runFailed
      ? "failed"
      : run && DONE.has(run.status)
        ? "done"
        : "running";
  const current = !run
    ? 0
    : run.status === "QUEUED"
      ? 1
      : run.status === "CALCULATING" || runFailed
        ? 2
        : 3;

  const error =
    state.error ??
    (runFailed
      ? (run.failure?.error.message ??
        (run.status === "CANCELLED"
          ? "Run dibatalkan sebelum selesai dihitung."
          : "Generate payroll gagal di worker."))
      : undefined);

  const result: JobResultItem[] =
    status === "done" && run
      ? [
          {
            label: "Baris produksi dihitung",
            value: run.sourceRowCount.toLocaleString("id-ID"),
          },
          {
            label: "Karyawan (PIN)",
            value: run.pinCount.toLocaleString("id-ID"),
          },
          {
            label: "Exception blocking",
            value: run.blockingExceptionCount.toLocaleString("id-ID"),
            attention: run.blockingExceptionCount > 0,
          },
        ]
      : [];

  const regenerate = state.kind === "regenerate";
  const subtitle = [
    run ? `Run #${run.runNo}` : null,
    regenerate && state.sourceRunNo
      ? `dari run #${state.sourceRunNo}`
      : `Periode ${formatDay(state.periodStart)} – ${formatDay(state.periodEnd)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <JobProgressDialog
      icon="calculate"
      titles={{
        running: regenerate ? "Menghitung ulang payroll" : "Menghitung payroll",
        done: "Payroll selesai dihitung",
        failed: regenerate ? "Generate ulang gagal" : "Generate payroll gagal",
      }}
      subtitle={subtitle}
      steps={STEPS}
      current={current}
      status={status}
      startedAt={state.startedAt}
      error={error}
      runningMessages={{
        2: "Worker menghitung semua baris periode sekaligus; jumlah baris dan karyawan tampil begitu selesai.",
      }}
      doneMessage={
        run && run.blockingExceptionCount > 0
          ? `Ada ${run.blockingExceptionCount.toLocaleString("id-ID")} exception blocking — selesaikan sebelum payroll bisa dikunci.`
          : "Periksa summary, lalu tandai direview."
      }
      stale={{
        step: 1,
        afterMs: STALE_QUEUE_MS,
        message:
          "Run belum diambil worker. Pastikan worker payroll (npm run worker) berjalan; perhitungan akan lanjut sendiri begitu worker aktif.",
      }}
      result={result}
      // Run yang gagal di worker tidak diulang dari sini: tombol Generate
      // ulang di halaman membuat run baru dengan kunci baru.
      onRetry={state.error ? onRetry : undefined}
      onDismiss={onDismiss}
    />
  );
}

import { JobProgressDialog, type JobResultItem } from "./job-progress-dialog";
import { formatDay } from "../model/format-day";
import { HRIS_SYNC_PHASES, type HrisSyncPhase } from "../model/hris-sync-phase";

/**
 * Pop-up "Tarik dari HRIS". Tahap diturunkan dari status job sinkronisasi
 * (QUEUED → SYNCING → COMPLETED).
 */
export interface HrisSyncProgressState {
  phase: HrisSyncPhase;
  periodStart: string;
  periodEnd: string;
  startedAt: number;
  /**
   * Job sempat kembali ke antrean setelah diambil worker: percobaan
   * sebelumnya gagal dan BullMQ mengulangnya otomatis.
   */
  retrying?: boolean | undefined;
  /** Ada = proses berhenti di `phase` dengan pesan ini. */
  error?: string | undefined;
  hrisRevision?: number | null | undefined;
  recordCount?: number | null | undefined;
}

const STEPS = [
  {
    label: "Kirim permintaan",
    hint: "Mendaftarkan periode ke antrean sinkronisasi.",
  },
  {
    label: "Antre di worker",
    hint: "Menunggu worker payroll mengambil tugas.",
  },
  {
    label: "Tarik dari HRIS",
    hint: "Mengambil snapshot FINAL, lalu menyimpan karyawan dan hari kerja.",
  },
  {
    label: "Siap dipakai",
    hint: "Attendance FINAL tersimpan untuk generate payroll.",
  },
] as const;

export function HrisSyncProgress({
  state,
  onRetry,
  onDismiss,
}: {
  state: HrisSyncProgressState;
  onRetry?: (() => void) | undefined;
  onDismiss: () => void;
}) {
  const status = state.error
    ? "failed"
    : state.phase === "done"
      ? "done"
      : "running";
  const result: JobResultItem[] = [];
  if (status === "done") {
    if (state.hrisRevision)
      result.push({
        label: "Revision HRIS",
        value: String(state.hrisRevision),
      });
    if (typeof state.recordCount === "number")
      result.push({
        label: "Catatan attendance",
        value: state.recordCount.toLocaleString("id-ID"),
      });
  }
  return (
    <JobProgressDialog
      icon="sync"
      titles={{
        running: "Menarik attendance dari HRIS",
        done: "Attendance FINAL berhasil ditarik",
        failed: "Tarik data HRIS gagal",
      }}
      subtitle={`Periode ${formatDay(state.periodStart)} – ${formatDay(state.periodEnd)}`}
      steps={STEPS}
      current={HRIS_SYNC_PHASES.indexOf(state.phase)}
      runningMessages={
        state.retrying
          ? {
              2: "Percobaan sebelumnya gagal; worker mengulang otomatis (maksimal 3 kali).",
            }
          : undefined
      }
      status={status}
      startedAt={state.startedAt}
      error={state.error}
      doneMessage="Lanjutkan dengan Generate payroll untuk menghitung periode ini."
      stale={{
        step: 1,
        afterMs: STALE_QUEUE_MS,
        message:
          "Tugas belum diambil worker. Pastikan worker payroll (npm run worker) berjalan; proses akan lanjut sendiri begitu worker aktif.",
      }}
      result={result}
      onRetry={onRetry}
      onDismiss={onDismiss}
    />
  );
}

/** Setelah selama ini masih QUEUED, hampir pasti worker tidak berjalan. */
export const STALE_QUEUE_MS = 12_000;

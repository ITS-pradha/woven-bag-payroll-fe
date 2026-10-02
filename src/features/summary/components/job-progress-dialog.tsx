import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import "./job-progress-dialog.css";

/**
 * Pop-up progres untuk job worker (tarik HRIS, generate payroll).
 *
 * Selama berjalan pop-up tidak bisa ditutup (Escape diabaikan): langkah
 * berikutnya di halaman bergantung pada hasil job ini, jadi halaman di
 * belakangnya sengaja tidak bisa dipakai dulu. Begitu selesai atau gagal,
 * pop-up menunjukkan hasilnya dan baru bisa ditutup.
 *
 * Tahap yang tampil berjalan maju satu per satu (paling cepat
 * `STEP_DWELL_MS` per tahap) dan tidak pernah mundur. Status job bisa melompat
 * — worker sering sudah mengambil tugas sebelum polling pertama — atau
 * kembali ke antrean saat worker mengulang percobaan yang gagal; keduanya
 * tidak boleh membuat jejak proses melompat-lompat.
 *
 * Tahapan dilaporkan apa adanya dari status job. Worker tidak melaporkan
 * persentase, jadi yang bergerak hanya tahap aktif dan jam berjalan — bukan
 * angka karangan. Angka hasil (`result`) hanya tampil setelah server
 * melaporkannya.
 */
export interface JobStep {
  label: string;
  hint: string;
}

export interface JobResultItem {
  label: string;
  value: string;
  /** Angka yang perlu ditindaklanjuti, mis. exception blocking > 0. */
  attention?: boolean | undefined;
}

export interface JobProgressDialogProps {
  icon: "sync" | "calculate";
  /** Judul per keadaan. */
  titles: { running: string; done: string; failed: string };
  subtitle: string;
  steps: readonly JobStep[];
  /** Indeks tahap menurut status job terakhir, atau tempat job berhenti. */
  current: number;
  /** Status job terakhir. */
  status: "running" | "done" | "failed";
  startedAt: number;
  error?: string | undefined;
  /** Keterangan tambahan per indeks tahap selama berjalan. */
  runningMessages?: Partial<Record<number, string>> | undefined;
  doneMessage: string;
  /** Pesan bila job terlalu lama di satu tahap (mis. worker tidak berjalan). */
  stale?: { step: number; afterMs: number; message: string } | undefined;
  result?: readonly JobResultItem[] | undefined;
  onRetry?: (() => void) | undefined;
  onDismiss: () => void;
}

export function JobProgressDialog({
  icon,
  titles,
  subtitle,
  steps,
  current: reportedStep,
  status: reportedStatus,
  startedAt,
  error,
  runningMessages,
  doneMessage,
  stale,
  result,
  onRetry,
  onDismiss,
}: JobProgressDialogProps) {
  const current = useSteppedIndex(reportedStep);
  // Hasil akhir baru tampil setelah jejaknya sampai di tahap tersebut.
  const status = current < reportedStep ? "running" : reportedStatus;
  const running = status === "running";
  const failed = status === "failed";
  const complete = status === "done";
  // Berhenti berdetak begitu job selesai: jam membeku di durasi akhirnya.
  const now = useNow(running);
  const elapsed = now - startedAt;
  const isStale =
    running &&
    stale !== undefined &&
    current === stale.step &&
    elapsed > stale.afterMs;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // Pop-up hidup selama komponen terpasang; fokus kembali ke pemicunya.
  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    if (!dialog) return;
    if (!dialog.open && typeof dialog.showModal === "function")
      dialog.showModal();
    dialog.focus();
    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, []);
  // Selama berjalan tidak ada tombol; begitu selesai, fokus ke aksi utama.
  useEffect(() => {
    if (!running) primaryRef.current?.focus();
  }, [running]);

  return (
    <dialog
      ref={dialogRef}
      className="job-progress"
      data-tone={status}
      aria-labelledby={titleId}
      aria-busy={running}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        if (!running) onDismiss();
      }}
    >
      <header className="job-progress-head">
        <span className="job-progress-emblem" aria-hidden="true">
          {failed ? (
            <IconAlert />
          ) : complete ? (
            <IconCheck />
          ) : icon === "sync" ? (
            <IconSync />
          ) : (
            <IconCalculate />
          )}
        </span>
        <div className="job-progress-title">
          <h2 id={titleId}>{titles[status]}</h2>
          <p>{subtitle}</p>
        </div>
        <p className="job-progress-clock" aria-label="Waktu berjalan">
          <IconClock />
          <span>{formatElapsed(elapsed)}</span>
        </p>
        {!running ? (
          <button
            type="button"
            className="job-progress-close"
            aria-label="Tutup pop-up"
            onClick={onDismiss}
          >
            <IconClose />
          </button>
        ) : null}
      </header>

      <ol className="job-progress-track">
        {steps.map((step, index) => {
          const stepState =
            index < current || (complete && index === current)
              ? "done"
              : index === current
                ? failed
                  ? "failed"
                  : "active"
                : "todo";
          return (
            <li
              key={step.label}
              data-state={stepState}
              aria-current={index === current && running ? "step" : undefined}
            >
              <span className="job-progress-rail" aria-hidden="true" />
              <span className="job-progress-node" aria-hidden="true">
                {stepState === "done" ? (
                  <IconCheck />
                ) : stepState === "failed" ? (
                  <IconClose />
                ) : (
                  <span className="job-progress-dot" />
                )}
              </span>
              <span className="job-progress-step-label">{step.label}</span>
              <span className="job-progress-step-hint">{step.hint}</span>
            </li>
          );
        })}
      </ol>

      {complete && result && result.length > 0 ? (
        <dl className="job-progress-result">
          {result.map((item) => (
            <div key={item.label} data-attention={item.attention || undefined}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="job-progress-foot">
        <p role="status" aria-live="polite">
          {failed
            ? error
            : complete
              ? doneMessage
              : isStale
                ? stale.message
                : runningMessages?.[current]
                  ? `Tahap ${current + 1} dari ${steps.length} · ${runningMessages[current]}`
                  : `Tahap ${current + 1} dari ${steps.length} · pop-up bisa ditutup setelah proses selesai.`}
        </p>
        {failed && onRetry ? (
          <>
            <button
              type="button"
              className="job-progress-btn"
              onClick={onDismiss}
            >
              Tutup
            </button>
            <button
              ref={primaryRef}
              type="button"
              className="job-progress-btn job-progress-btn-primary"
              onClick={onRetry}
            >
              <IconSync />
              Coba lagi
            </button>
          </>
        ) : !running ? (
          <button
            ref={primaryRef}
            type="button"
            className="job-progress-btn job-progress-btn-primary"
            onClick={onDismiss}
          >
            {complete ? "Selesai" : "Tutup"}
          </button>
        ) : null}
      </div>
    </dialog>
  );
}

/** Waktu minimum tiap tahap terlihat aktif sebelum jejak maju ke berikutnya. */
const STEP_DWELL_MS = 550;

/**
 * Mengejar `target` satu tahap per `STEP_DWELL_MS`; tidak pernah turun, jadi
 * job yang kembali ke antrean (percobaan ulang) tidak memundurkan jejak.
 */
function useSteppedIndex(target: number) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= target) return;
    const timer = window.setTimeout(
      () => setShown((index) => Math.min(index + 1, target)),
      STEP_DWELL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [shown, target]);
  return shown;
}

function useNow(ticking: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [ticking]);
  return now;
}

function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

function IconSync() {
  return (
    <Svg>
      <path d="M13.5 6.5A5.6 5.6 0 0 0 3.2 4.6" />
      <path d="M2.6 2.2v2.9h2.9" />
      <path d="M2.5 9.5a5.6 5.6 0 0 0 10.3 1.9" />
      <path d="M13.4 13.8v-2.9h-2.9" />
    </Svg>
  );
}

function IconCheck() {
  return (
    <Svg>
      <path d="m3.5 8.4 3 3 6-6.6" />
    </Svg>
  );
}

function IconClose() {
  return (
    <Svg>
      <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
    </Svg>
  );
}

function IconAlert() {
  return (
    <Svg>
      <path d="M8 2.2 14.2 13H1.8L8 2.2Z" />
      <path d="M8 6.5v2.8M8 11.3v.1" />
    </Svg>
  );
}

function IconCalculate() {
  return (
    <Svg>
      <rect x="3" y="1.8" width="10" height="12.4" rx="1.6" />
      <path d="M5.6 4.6h4.8" />
      <path d="M5.6 7.8h.1M8 7.8h.1M10.4 7.8h.1M5.6 10.6h.1M8 10.6h.1M10.4 10.6h.1" />
    </Svg>
  );
}

function IconClock() {
  return (
    <Svg>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.8V8l2.2 1.4" />
    </Svg>
  );
}

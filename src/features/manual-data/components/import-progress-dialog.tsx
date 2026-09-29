import { useEffect, useId, useRef } from "react";

/**
 * Progres impor file sebagai modal.
 *
 * Modal, bukan strip status: selama impor berjalan grid sedang ditulis, dan
 * klik ke sheet atau ke tombol lain di tengah proses hanya menghasilkan
 * keadaan setengah jadi. Modal sekaligus menjawab "apakah aplikasinya macet?"
 * pada file besar, di mana beberapa langkah memang memakan detik.
 *
 * Tahapan dilaporkan apa adanya. Hanya impor langsung ke server yang punya
 * persentase sungguhan (byte file yang sudah terbaca); tahap lain memakai
 * `<progress>` tanpa nilai — indikator "sedang bekerja" bawaan browser —
 * daripada angka karangan.
 */
export type ImportStage = "read" | "parse" | "resolve" | "write" | "upload";

const STAGE_ORDER: readonly ImportStage[] = [
  "read",
  "parse",
  "resolve",
  "write",
];

const STAGE_LABEL: Record<ImportStage, string> = {
  read: "Membaca file",
  parse: "Membaca baris",
  resolve: "Mencocokkan karyawan ke HRIS",
  write: "Menulis ke grid dan memvalidasi",
  upload: "Mengirim ke server",
};

export interface ImportProgressState {
  fileName: string;
  stage: ImportStage;
  /** 0..1 bila memang terukur. */
  fraction?: number | undefined;
  /** Keterangan tambahan, mis. "12.000 baris terkirim". */
  detail?: string | undefined;
  /** Ada = proses ini bisa dihentikan sekarang. */
  onCancel?: (() => void) | undefined;
  cancelLabel?: string | undefined;
}

export function ImportProgressDialog({
  state,
}: {
  state: ImportProgressState | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const open = state !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open && typeof dialog.showModal === "function")
      dialog.showModal();
    if (!open && dialog.open && typeof dialog.close === "function")
      dialog.close();
  }, [open]);

  const steps = state?.stage === "upload" ? (["upload"] as const) : STAGE_ORDER;
  const current = state ? steps.indexOf(state.stage) : -1;
  const percent =
    state?.fraction === undefined
      ? undefined
      : Math.round(Math.min(1, Math.max(0, state.fraction)) * 100);

  return (
    <dialog
      ref={dialogRef}
      className="manual-dialog manual-import-progress"
      aria-labelledby={titleId}
      aria-busy={open}
      // Escape menutup modal tanpa menghentikan pekerjaannya — yang terburuk
      // dari dua pilihan. Menutup hanya lewat tombol Hentikan, bila ada.
      onCancel={(event) => {
        event.preventDefault();
        state?.onCancel?.();
      }}
    >
      {state && (
        <div className="manual-import-progress-body">
          <h2 id={titleId}>Mengimpor {state.fileName}</h2>
          <ol className="manual-import-steps">
            {steps.map((step, index) => (
              <li
                key={step}
                aria-current={index === current ? "step" : undefined}
                data-state={
                  index < current
                    ? "done"
                    : index === current
                      ? "active"
                      : "todo"
                }
              >
                {STAGE_LABEL[step]}
              </li>
            ))}
          </ol>
          <progress
            className="manual-import-bar"
            aria-label={STAGE_LABEL[state.stage]}
            {...(percent === undefined ? {} : { max: 100, value: percent })}
          />
          <p role="status">
            {STAGE_LABEL[state.stage]}
            {percent === undefined ? "…" : ` · ${percent}%`}
            {state.detail ? ` · ${state.detail}` : ""}
          </p>
          <p>Jangan tutup tab selama impor berjalan.</p>
          {state.onCancel && (
            <div className="manual-dialog-actions">
              <button
                type="button"
                className="manual-btn manual-danger"
                onClick={state.onCancel}
              >
                {state.cancelLabel ?? "Hentikan impor"}
              </button>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

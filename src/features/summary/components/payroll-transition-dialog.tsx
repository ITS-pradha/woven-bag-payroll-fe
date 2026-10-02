import { useEffect, useRef, useState } from "react";
import type { PayrollRun } from "../api/summary-api";

export function PayrollTransitionDialog({
  mode,
  run,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  mode: "review" | "lock";
  run: PayrollRun;
  pending: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    if (!dialog) return;
    dialog.showModal();
    closeRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, []);
  const locking = mode === "lock";
  // Sama dengan batas backend: catatan ini yang disimpan di audit trail.
  const missing = Math.max(0, NOTE_MIN_LENGTH - note.trim().length);
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="transition-title"
      className="fixed inset-0 m-auto w-[calc(100%_-_1.5rem)] max-w-md border border-border bg-surface p-0 text-foreground shadow-panel backdrop:bg-black/35"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            "textarea:not([disabled]), button:not([disabled])",
          ),
        ];
        const first = controls[0];
        const last = controls.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id="transition-title" className="text-sm font-bold">
          {locking ? "Kunci payroll periode ini?" : "Tandai sudah direview?"}
        </h2>
        <p className="mt-1 text-xs text-muted">
          {locking
            ? "Summary dan override menjadi immutable. Koreksi berikutnya harus memakai adjustment."
            : "Pastikan nominal, attendance, dan exception sudah diperiksa."}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 border-b border-border px-4 py-3 text-xs">
        <div>
          <dt className="text-muted">Karyawan</dt>
          <dd className="font-bold">{run.pinCount} PIN</dd>
        </div>
        <div>
          <dt className="text-muted">Blocking</dt>
          <dd className="font-bold">{run.blockingExceptionCount} exception</dd>
        </div>
      </dl>
      <div className="p-4">
        <label className="text-xs font-semibold">
          Catatan {locking ? "penguncian" : "review"}
          <textarea
            aria-label={locking ? "Catatan penguncian" : "Catatan review"}
            rows={3}
            className="mt-1 w-full resize-y border border-border-strong px-2 py-1.5 text-xs focus:outline-2 focus:outline-focus"
            aria-describedby="transition-note-hint"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <p
          id="transition-note-hint"
          className={`mt-1 text-[0.6875rem] ${missing > 0 ? "text-warning-strong" : "text-muted"}`}
        >
          {missing > 0
            ? `Minimal ${NOTE_MIN_LENGTH} karakter untuk audit trail · kurang ${missing} lagi.`
            : `Catatan tersimpan di audit trail.`}
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-border bg-surface-muted px-4 py-2">
        <button
          ref={closeRef}
          type="button"
          className="min-h-8 border border-border-strong px-3 text-xs font-semibold"
          disabled={pending}
          onClick={onClose}
        >
          Batal
        </button>
        <button
          type="button"
          className="min-h-8 rounded bg-brand px-3 text-xs font-bold text-white disabled:bg-brand-disabled"
          disabled={
            pending ||
            missing > 0 ||
            (locking && run.blockingExceptionCount > 0)
          }
          onClick={() => onConfirm(note.trim())}
        >
          {pending ? "Memproses…" : locking ? "Kunci payroll" : "Simpan review"}
        </button>
      </div>
    </dialog>
  );
}

const NOTE_MIN_LENGTH = 5;

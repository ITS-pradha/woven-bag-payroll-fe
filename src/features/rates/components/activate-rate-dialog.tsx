import { useEffect, useRef, useState } from "react";

interface ActivateRateDialogProps {
  versionCode: string;
  effectiveFrom: string;
  rangeCount: number;
  isPending: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (approvalNote: string) => void;
}

export function ActivateRateDialog({
  versionCode,
  effectiveFrom,
  rangeCount,
  isPending,
  error,
  onClose,
  onConfirm,
}: ActivateRateDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [approvalNote, setApprovalNote] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (approvalNote.trim().length < 5) {
      setLocalError("Catatan persetujuan minimal 5 karakter.");
      return;
    }
    setLocalError("");
    onConfirm(approvalNote.trim());
  }

  return (
    <dialog
      ref={dialog}
      className="m-auto w-[min(28rem,calc(100%-2rem))] border border-border bg-surface p-0 text-foreground shadow-panel backdrop:bg-foreground/30"
      aria-labelledby="activate-rate-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isPending) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="border-b border-border px-4 py-3">
          <h2 id="activate-rate-title" className="text-base font-bold">
            Aktifkan versi harga?
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            Versi aktif sebelumnya menjadi histori. Payroll yang sudah terkunci
            tidak berubah.
          </p>
        </div>
        <dl className="grid grid-cols-3 border-b border-border text-xs">
          <div className="border-r border-border p-3">
            <dt className="text-muted">Versi</dt>
            <dd className="mt-1 truncate font-bold">{versionCode}</dd>
          </div>
          <div className="border-r border-border p-3">
            <dt className="text-muted">Mulai</dt>
            <dd className="mt-1 font-bold">{effectiveFrom}</dd>
          </div>
          <div className="p-3">
            <dt className="text-muted">Validasi</dt>
            <dd className="mt-1 font-bold">{rangeCount} range valid</dd>
          </div>
        </dl>
        <div className="p-4">
          <label className="text-xs font-semibold" htmlFor="approval-note">
            Catatan persetujuan
          </label>
          <textarea
            id="approval-note"
            autoFocus
            rows={3}
            className="mt-1 w-full resize-y border border-border-strong px-2 py-1.5 text-sm focus:outline-2 focus:outline-focus"
            value={approvalNote}
            onChange={(event) => setApprovalNote(event.target.value)}
            disabled={isPending}
          />
          {localError || error ? (
            <p role="alert" className="mt-1 text-xs font-semibold text-danger">
              {localError || error}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-surface-muted px-4 py-3">
          <button
            type="button"
            className="min-h-8 border border-border-strong bg-surface px-3 text-xs font-semibold"
            disabled={isPending}
            onClick={onClose}
          >
            Batal
          </button>
          <button
            type="submit"
            className="min-h-8 rounded bg-brand px-3 text-xs font-bold text-white hover:bg-brand-strong disabled:bg-brand-disabled"
            disabled={isPending}
          >
            {isPending ? "Mengaktifkan…" : "Aktifkan harga"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

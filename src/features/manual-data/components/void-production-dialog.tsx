import { useEffect, useRef, useState } from "react";
import { toJakartaInput, type Baseline } from "../model/rows";

interface VoidProductionDialogProps {
  entry: Baseline | null;
  employeeName: string;
  pending: boolean;
  mustRetry: boolean;
  error: string;
  onCancel(): void;
  /**
   * Closes after an unknown outcome. The caller reloads from the server: the
   * void may or may not have landed, and only a fresh read can tell.
   */
  onAbandon(): void;
  onConfirm(reason: string): void;
}

export function VoidProductionDialog({
  entry,
  employeeName,
  pending,
  mustRetry,
  error,
  onCancel,
  onAbandon,
  onConfirm,
}: VoidProductionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!entry) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    const frame = requestAnimationFrame(() => reasonRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [entry]);

  const valid = reason.trim().length >= 5 && reason.trim().length <= 500;

  return (
    <dialog
      ref={dialogRef}
      className="manual-dialog"
      aria-labelledby="void-dialog-title"
      onCancel={(event) => {
        if (pending || mustRetry) event.preventDefault();
        else onCancel();
      }}
      onClose={() => {
        setReason("");
        if (entry && !pending && !mustRetry) onCancel();
      }}
    >
      {entry && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !pending) onConfirm(reason.trim());
          }}
        >
          <h2 id="void-dialog-title">Batalkan data produksi</h2>
          <p>
            Mesin {entry.stationNo} · {toJakartaInput(entry.shiftStart)} sampai{" "}
            {toJakartaInput(entry.shiftEnd)} · {employeeName}
          </p>
          <p>
            Data akan hilang dari daftar aktif dan tidak dipakai dalam payroll,
            tetapi histori audit tetap disimpan.
          </p>
          <label>
            Alasan pembatalan
            <textarea
              ref={reasonRef}
              rows={3}
              minLength={5}
              maxLength={500}
              required
              value={reason}
              disabled={pending || mustRetry}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Contoh: hasil produksi salah dicatat"
            />
          </label>
          <small>
            {reason.trim().length}/500 karakter · minimal 5 karakter
          </small>
          {error && <p role="alert">{error}</p>}
          {mustRetry && (
            <p>
              Hasil permintaan belum pasti. Ulangi dengan data yang sama agar
              server tidak membatalkan dua kali — atau tutup, lalu data dimuat
              ulang untuk melihat apakah baris ini sudah dibatalkan.
            </p>
          )}
          <div className="manual-dialog-actions">
            <button
              type="button"
              className="manual-btn"
              disabled={pending}
              onClick={mustRetry ? onAbandon : onCancel}
            >
              {mustRetry ? "Tutup & muat ulang" : "Kembali"}
            </button>
            <button
              type="submit"
              className="manual-btn manual-danger"
              disabled={!valid || pending}
            >
              {pending
                ? "Membatalkan…"
                : mustRetry
                  ? "Ulangi pembatalan"
                  : "Ya, batalkan data"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

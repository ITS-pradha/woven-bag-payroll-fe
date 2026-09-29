interface LiveEditConfirmProps {
  versionCode: string;
  subject: string;
  /** Kalimat dampak; default untuk harga. */
  impact?: string;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Konfirmasi sebelum menyimpan ke versi ACTIVE/RETIRED. Menyebut objek dan
 * dampaknya: payroll yang belum dikunci pada masa berlaku versi ini ditandai
 * gagal oleh server dan harus di-generate ulang.
 */
export function LiveEditConfirm({
  versionCode,
  subject,
  impact = "Harga baru langsung dipakai. Payroll yang belum dikunci pada masa berlaku versi ini ditandai gagal dan harus di-generate ulang.",
  isPending,
  onConfirm,
  onCancel,
}: LiveEditConfirmProps) {
  return (
    <div
      role="alertdialog"
      aria-labelledby="live-edit-confirm-title"
      aria-describedby="live-edit-confirm-body"
      className="flex flex-wrap items-center gap-2 border-t border-warning-border bg-warning-soft px-3 py-2 text-xs text-warning-strong"
    >
      <p className="mr-auto min-w-0">
        <strong id="live-edit-confirm-title">
          Simpan {subject} ke versi aktif {versionCode}?
        </strong>{" "}
        <span id="live-edit-confirm-body">{impact}</span>
      </p>
      <button
        type="button"
        className="min-h-8 border border-border-strong bg-surface px-3 font-semibold"
        disabled={isPending}
        onClick={onCancel}
      >
        Batal
      </button>
      <button
        type="button"
        className="min-h-8 rounded bg-brand px-3 font-bold text-white hover:bg-brand-strong disabled:bg-brand-disabled"
        disabled={isPending}
        onClick={onConfirm}
        autoFocus
      >
        {isPending ? "Menyimpan…" : "Simpan ke versi aktif"}
      </button>
    </div>
  );
}

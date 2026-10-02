import { useCallback, useEffect, useRef, useState } from "react";
import type { PayrollPeriod } from "../api/manual-data-api";
import type { PeriodDraft } from "../model/period-book";

/**
 * Pengelolaan buku periode: buat, ubah, dan tutup.
 *
 * Batas buku adalah data master dan keputusan manusia — layar ini hanya
 * menyarankan bulan berikutnya, tidak pernah membuat buku sendiri. Departemen
 * tidak bisa diisi: ia dipaku dari konfigurasi supaya buku yang dibuat di
 * sini selalu buku yang dipakai backend untuk menilai baris Manual Data.
 */
function useModal(open: boolean, focus: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    const frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [open, focus]);
  return ref;
}

export function CreatePeriodDialog({
  initial,
  departmentCode,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  /** null = dialog tertutup. */
  initial: PeriodDraft | null;
  departmentCode: string;
  pending: boolean;
  error: string;
  onCancel(): void;
  onConfirm(draft: PeriodDraft): void;
}) {
  const codeRef = useRef<HTMLInputElement>(null);
  const focusCode = useCallback(() => codeRef.current?.focus(), []);
  const dialogRef = useModal(initial !== null, focusCode);

  return (
    <dialog
      ref={dialogRef}
      className="manual-dialog"
      aria-labelledby="create-period-title"
      onCancel={(event) => {
        if (pending) event.preventDefault();
        else onCancel();
      }}
    >
      {initial && (
        // Remount per pembukaan: isian selalu mulai dari saran terbaru, bukan
        // sisa ketikan dari pembukaan sebelumnya.
        <PeriodForm
          key={`${initial.code}-${initial.periodStart}`}
          mode="create"
          initial={initial}
          departmentCode={departmentCode}
          pending={pending}
          error={error}
          codeRef={codeRef}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      )}
    </dialog>
  );
}

/**
 * Ubah kode dan rentang buku OPEN. Server menolak perubahan tanggal bila buku
 * sudah punya payroll run, atau bila rentang baru meninggalkan baris produksi
 * tanpa buku; pesan penolakannya ditampilkan apa adanya di dialog.
 */
export function EditPeriodDialog({
  period,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  /** null = dialog tertutup. */
  period: PayrollPeriod | null;
  pending: boolean;
  error: string;
  onCancel(): void;
  onConfirm(draft: PeriodDraft): void;
}) {
  const codeRef = useRef<HTMLInputElement>(null);
  const focusCode = useCallback(() => codeRef.current?.focus(), []);
  const dialogRef = useModal(period !== null, focusCode);

  return (
    <dialog
      ref={dialogRef}
      className="manual-dialog"
      aria-labelledby="edit-period-title"
      onCancel={(event) => {
        if (pending) event.preventDefault();
        else onCancel();
      }}
    >
      {period && (
        <PeriodForm
          key={`${period.id}-${period.rowVersion}`}
          mode="edit"
          initial={{
            code: period.code,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
          }}
          departmentCode={period.departmentCode}
          pending={pending}
          error={error}
          codeRef={codeRef}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      )}
    </dialog>
  );
}

function PeriodForm({
  mode,
  initial,
  departmentCode,
  pending,
  error,
  codeRef,
  onCancel,
  onConfirm,
}: {
  mode: "create" | "edit";
  initial: PeriodDraft;
  departmentCode: string;
  pending: boolean;
  error: string;
  codeRef: React.RefObject<HTMLInputElement | null>;
  onCancel(): void;
  onConfirm(draft: PeriodDraft): void;
}) {
  const [draft, setDraft] = useState(initial);
  const code = draft.code.trim();
  const rangeError =
    draft.periodStart && draft.periodEnd && draft.periodEnd < draft.periodStart
      ? "Tanggal akhir tidak boleh sebelum tanggal mulai."
      : "";
  const changed =
    code !== initial.code ||
    draft.periodStart !== initial.periodStart ||
    draft.periodEnd !== initial.periodEnd;
  const valid =
    code.length > 0 &&
    code.length <= 50 &&
    Boolean(draft.periodStart && draft.periodEnd) &&
    !rangeError &&
    (mode === "create" || changed);
  const editing = mode === "edit";
  const titleId = editing ? "edit-period-title" : "create-period-title";
  const rangeId = editing ? "edit-period-range" : "create-period-range";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !pending) onConfirm({ ...draft, code });
      }}
    >
      <h2 id={titleId}>
        {editing ? `Ubah buku ${initial.code}` : "Buat buku periode"}
      </h2>
      <p>
        Baris produksi masuk ke buku ini bila tanggal Shift Start-nya (WIB)
        berada di antara tanggal mulai dan akhir, termasuk kedua tanggal itu.
        Rentang tidak boleh bertumpuk dengan buku lain.
      </p>
      {editing && (
        <p>
          Tanggal hanya bisa diubah selama buku belum punya payroll run, dan
          rentang baru harus tetap mencakup semua baris produksi di buku ini.
          Kode buku selalu bisa diubah.
        </p>
      )}
      <label>
        Kode buku
        <input
          ref={codeRef}
          required
          maxLength={50}
          value={draft.code}
          disabled={pending}
          onChange={(event) => setDraft({ ...draft, code: event.target.value })}
        />
      </label>
      <label>
        Tanggal mulai
        <input
          type="date"
          required
          value={draft.periodStart}
          disabled={pending}
          onChange={(event) =>
            setDraft({ ...draft, periodStart: event.target.value })
          }
        />
      </label>
      <label>
        Tanggal akhir
        <input
          type="date"
          required
          value={draft.periodEnd}
          disabled={pending}
          aria-invalid={rangeError ? true : undefined}
          aria-describedby={rangeError ? rangeId : undefined}
          onChange={(event) =>
            setDraft({ ...draft, periodEnd: event.target.value })
          }
        />
      </label>
      {rangeError && <small id={rangeId}>{rangeError}</small>}
      <small>Departemen: {departmentCode}</small>
      {error && <p role="alert">{error}</p>}
      <div className="manual-dialog-actions">
        <button
          type="button"
          className="manual-btn"
          disabled={pending}
          onClick={onCancel}
        >
          Kembali
        </button>
        <button
          type="submit"
          className="manual-btn manual-primary"
          disabled={!valid || pending}
        >
          {editing
            ? pending
              ? "Menyimpan…"
              : "Simpan perubahan buku"
            : pending
              ? "Membuat…"
              : "Buat buku"}
        </button>
      </div>
    </form>
  );
}

export function ClosePeriodDialog({
  period,
  hasDraft,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  /** null = dialog tertutup. */
  period: PayrollPeriod | null;
  /** Draft grid yang belum disimpan tidak akan bisa disimpan setelah tutup. */
  hasDraft: boolean;
  pending: boolean;
  error: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  const ackRef = useRef<HTMLInputElement>(null);
  const focusAck = useCallback(() => ackRef.current?.focus(), []);
  const dialogRef = useModal(period !== null, focusAck);
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <dialog
      ref={dialogRef}
      className="manual-dialog"
      aria-labelledby="close-period-title"
      onCancel={(event) => {
        if (pending) event.preventDefault();
        else onCancel();
      }}
      onClose={() => setAcknowledged(false)}
    >
      {period && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (acknowledged && !pending) onConfirm();
          }}
        >
          <h2 id="close-period-title">Tutup buku {period.code}</h2>
          <p>
            {period.periodStart} s/d {period.periodEnd}. Setelah ditutup, semua
            baris produksi di rentang ini tidak bisa disimpan, diedit,
            dibatalkan, atau diimpor lagi. Buku yang sudah tutup{" "}
            <strong>tidak bisa dibuka kembali</strong>; koreksi sesudahnya lewat
            penyesuaian payroll.
          </p>
          {hasDraft && (
            <p role="alert">
              Masih ada draft yang belum disimpan di layar ini. Draft itu tidak
              akan bisa disimpan setelah buku ditutup.
            </p>
          )}
          <label className="manual-dialog-check">
            <input
              ref={ackRef}
              type="checkbox"
              checked={acknowledged}
              disabled={pending}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            Saya mengerti buku {period.code} tidak bisa dibuka kembali.
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="manual-dialog-actions">
            <button
              type="button"
              className="manual-btn"
              disabled={pending}
              onClick={onCancel}
            >
              Kembali
            </button>
            <button
              type="submit"
              className="manual-btn manual-danger"
              disabled={!acknowledged || pending}
            >
              {pending ? "Menutup…" : `Tutup buku ${period.code}`}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

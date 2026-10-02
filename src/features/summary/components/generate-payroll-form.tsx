import type {
  AttendancePeriod,
  PayrollPeriod,
  RateVersionOption,
} from "../api/summary-api";
import { periodBookLabel } from "../model/period-book";
import {
  MACHINE_GROUPS,
  effectiveRangeLabel,
  versionsForGroup,
  type MachineGroup,
  type RateSelection,
} from "../model/rate-selection";

/** Keadaan daftar versi harga, dari sudut pandang tombol Generate. */
export type RatePickerState =
  | { kind: "no-access" }
  | { kind: "loading" }
  | { kind: "error"; message: string; onRetry: () => void }
  | {
      kind: "ready";
      versions: RateVersionOption[];
      selection: RateSelection;
      onChange: (group: MachineGroup, rateVersionId: string) => void;
    };

/** Keadaan daftar buku periode untuk pemilih di form. */
export type PeriodBookState =
  | { kind: "loading" }
  | { kind: "error"; message: string; onRetry: () => void }
  | { kind: "ready"; books: PayrollPeriod[] };

export function GeneratePayrollForm({
  books,
  selectedBook,
  onBookChange,
  attendance,
  attendanceLoading,
  canGenerate,
  generating,
  onGenerate,
  canSync,
  syncing,
  onSync,
  rates,
}: {
  books: PeriodBookState;
  selectedBook: PayrollPeriod | null;
  onBookChange: (bookId: string) => void;
  attendance: AttendancePeriod | undefined;
  attendanceLoading: boolean;
  canGenerate: boolean;
  generating: boolean;
  onGenerate: () => void;
  canSync: boolean;
  syncing: boolean;
  onSync: () => void;
  rates: RatePickerState;
}) {
  const ratesBlocking = rates.kind === "loading" || rates.kind === "error";
  // Backend menolak generate di buku tertutup (PAYROLL_PERIOD_CLOSED).
  const bookClosed = selectedBook?.status === "CLOSED";
  return (
    <section
      aria-label="Parameter generate payroll"
      className="flex flex-wrap items-end gap-2 border border-border bg-surface px-3 py-2"
    >
      <PeriodBookPicker
        books={books}
        selectedBook={selectedBook}
        onChange={onBookChange}
      />
      <div className="min-w-48 flex-1 pb-0.5 text-[0.6875rem]">
        <p className="font-semibold">Attendance HRIS</p>
        <p
          className={attendance ? "text-success-strong" : "text-warning-strong"}
        >
          {attendanceLoading
            ? "Memeriksa konfirmasi HRD…"
            : attendance
              ? `FINAL · Revision ${attendance.hrisRevision}`
              : "Belum ditarik dari HRIS"}
        </p>
      </div>
      {canSync ? (
        <button
          type="button"
          className="min-h-8 border border-border-strong px-3 text-xs font-semibold disabled:text-disabled"
          disabled={syncing || !selectedBook}
          title="Ambil revision FINAL periode ini dari HRIS (menu Absensi → Summary Payroll)."
          onClick={onSync}
        >
          {syncing
            ? "Menarik dari HRIS…"
            : attendance
              ? "Tarik ulang dari HRIS"
              : "Tarik dari HRIS"}
        </button>
      ) : null}
      {canGenerate ? (
        <button
          type="button"
          className="min-h-8 rounded bg-brand px-3 text-xs font-bold text-white hover:bg-brand-strong disabled:bg-brand-disabled"
          disabled={
            generating ||
            !attendance ||
            !selectedBook ||
            bookClosed ||
            ratesBlocking
          }
          title={
            bookClosed
              ? "Buku periode ini sudah ditutup; payroll tidak bisa di-generate lagi."
              : undefined
          }
          onClick={onGenerate}
        >
          {generating ? "Menjadwalkan…" : "Generate payroll"}
        </button>
      ) : null}
      {canGenerate ? <RatePicker rates={rates} /> : null}
    </section>
  );
}

function PeriodBookPicker({
  books,
  selectedBook,
  onChange,
}: {
  books: PeriodBookState;
  selectedBook: PayrollPeriod | null;
  onChange: (bookId: string) => void;
}) {
  const list = books.kind === "ready" ? books.books : [];
  return (
    <div className="min-w-72 text-[0.6875rem]">
      <label className="font-semibold" htmlFor="summary-period-book">
        Buku periode
      </label>
      <div className="mt-1 flex items-center gap-2">
        <select
          id="summary-period-book"
          className="block min-h-8 w-full min-w-0 border border-border-strong bg-surface px-2 text-xs focus:outline-2 focus:outline-focus disabled:text-disabled"
          disabled={list.length === 0}
          value={selectedBook?.id ?? ""}
          onChange={(event) => onChange(event.target.value)}
        >
          {list.length === 0 ? (
            <option value="">
              {books.kind === "loading"
                ? "Memuat buku periode…"
                : books.kind === "error"
                  ? "Buku periode gagal dimuat"
                  : "Belum ada buku periode"}
            </option>
          ) : null}
          {list.map((book) => (
            <option key={book.id} value={book.id}>
              {periodBookLabel(book)}
            </option>
          ))}
        </select>
        {selectedBook ? (
          <span
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[0.625rem] font-bold uppercase ${
              selectedBook.status === "CLOSED"
                ? "border-border-strong bg-surface-muted text-muted"
                : "border-success-border bg-success-soft text-success-strong"
            }`}
          >
            {selectedBook.status === "CLOSED" ? "Tutup" : "Terbuka"}
          </span>
        ) : null}
      </div>
      {books.kind === "error" ? (
        <p className="mt-1 text-danger" role="alert">
          {books.message}{" "}
          <button
            type="button"
            className="font-semibold underline underline-offset-2"
            onClick={books.onRetry}
          >
            Coba lagi
          </button>
        </p>
      ) : books.kind === "ready" && list.length === 0 ? (
        <p className="mt-1 text-warning-strong">
          Buat buku periode di menu Manual Data terlebih dahulu.
        </p>
      ) : selectedBook?.status === "CLOSED" ? (
        <p className="mt-1 text-muted">
          Buku sudah ditutup; generate payroll dinonaktifkan.
        </p>
      ) : null}
    </div>
  );
}

const GROUP_LABEL: Record<MachineGroup, string> = {
  REGULAR: "Regular",
  CS: "CS",
  SP: "SP",
};

/**
 * Versi konfigurasi harga untuk generate, satu per machine group. Default:
 * versi terbaru yang sedang berlaku; versi yang sudah berakhir tetap bisa
 * dipilih untuk menghitung ulang dengan harga lama. Versi terpilih menghargai
 * SEMUA baris periode, apa pun tanggal shift-nya.
 */
function RatePicker({ rates }: { rates: RatePickerState }) {
  if (rates.kind === "no-access")
    return (
      <p className="basis-full text-[0.6875rem] text-muted">
        Versi harga: otomatis per tanggal shift. Akun ini tidak punya akses
        Konfigurasi Harga untuk memilih versi.
      </p>
    );
  if (rates.kind === "loading")
    return (
      <p className="basis-full text-[0.6875rem] text-muted" role="status">
        Memuat versi harga…
      </p>
    );
  if (rates.kind === "error")
    return (
      <p className="basis-full text-[0.6875rem] text-danger" role="alert">
        Versi harga gagal dimuat: {rates.message}{" "}
        <button
          type="button"
          className="font-semibold underline underline-offset-2"
          onClick={rates.onRetry}
        >
          Coba lagi
        </button>
      </p>
    );

  const groups = MACHINE_GROUPS.filter(
    (group) => versionsForGroup(rates.versions, group).length > 0,
  );
  if (groups.length === 0)
    return (
      <p className="basis-full text-[0.6875rem] text-warning-strong">
        Belum ada versi harga yang pernah diaktifkan. Aktifkan versi di
        Konfigurasi Harga sebelum generate.
      </p>
    );

  return (
    <fieldset className="flex basis-full flex-wrap items-end gap-2 border-t border-border pt-2">
      <legend className="sr-only">Versi harga untuk generate</legend>
      <p className="w-full text-[0.6875rem] font-semibold">
        Versi harga{" "}
        <span className="font-normal text-muted">
          · dipakai untuk semua baris periode ini, apa pun tanggal shift-nya
        </span>
      </p>
      {groups.map((group) => (
        <label
          key={group}
          className="min-w-56 flex-1 text-[0.6875rem] font-semibold"
        >
          {GROUP_LABEL[group]}
          <select
            aria-label={`Versi harga ${GROUP_LABEL[group]}`}
            className="mt-1 block min-h-8 w-full border border-border-strong bg-surface px-2 text-xs font-normal focus:outline-2 focus:outline-focus"
            value={rates.selection[group] ?? ""}
            onChange={(event) => rates.onChange(group, event.target.value)}
          >
            {versionsForGroup(rates.versions, group).map((version) => (
              <option key={version.id} value={version.id}>
                {version.code} · {effectiveRangeLabel(version)}
                {version.status === "RETIRED" ? " · Expired" : ""}
              </option>
            ))}
          </select>
        </label>
      ))}
    </fieldset>
  );
}

import { useConfirm } from "../../../components/confirm-dialog/use-confirm";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "react-router-dom";
import { env } from "../../../config/env";
import { ApiClientError } from "../../../api/client/api-result";
import {
  closePeriod,
  createPeriod,
  getEmployee,
  lookupEmployees,
  getProduction,
  listPeriods,
  listProduction,
  periodRange,
  SAVE_BATCH_ROWS,
  saveProduction,
  saveProductionBatched,
  voidProduction,
  type PayrollPeriod,
  type ProductionFilter,
  type SaveAttempt,
  type VoidAttempt,
} from "../api/manual-data-api";
import {
  fileTextChunks,
  IMPORT_BATCH_ROWS,
  importProductionStream,
  rejectionReportCsv,
  ImportAborted,
  type ImportProgress,
  type ImportSummary,
} from "../model/import-stream";
import {
  columns,
  entryCells,
  isChanged,
  MAX_ROWS,
  normalizePastedCells,
  parseClipboard,
  parseImportFile,
  toClipboardText,
  toJakartaInput,
  rowsWithValue,
  validateRows,
  type Baseline,
  type DraftRow,
  type Entry,
  type Employee,
  type RowError,
} from "../model/rows";
import {
  periodWarning,
  periodWarningMessage,
  suggestNextPeriod,
  type PeriodDraft,
} from "../model/period-book";
import { readLastPeriod, writeLastPeriod } from "../model/last-period";
import { isXlsxFile } from "../model/xlsx-file";
import { removeRowsFrom, shiftRows } from "../model/row-structure";
import { DateCellPicker } from "./date-cell-picker";
import { EmployeeCombobox } from "./employee-combobox";
import { EmployeeDirectory } from "./employee-directory";
import { EmployeePicker } from "./employee-picker";
import type {
  AssigneeEditorAnchor,
  DateCellAnchor,
  GridControl,
  GridStatus,
} from "./univer-grid";
import { VoidProductionDialog } from "./void-production-dialog";
import { ClosePeriodDialog, CreatePeriodDialog } from "./period-book-dialogs";
import {
  ImportProgressDialog,
  type ImportProgressState,
  type ImportStage,
} from "./import-progress-dialog";
import "./manual-data.css";

const Grid = lazy(() =>
  import("./univer-grid").then((module) => ({ default: module.UniverGrid })),
);
const today = () => toJakartaInput(new Date().toISOString()).slice(0, 10);

/**
 * Di atas ukuran ini file tidak lagi dibuka di grid.
 *
 * Grid menampung 10.000 baris dan mengirimnya sebagai satu batch. File yang
 * lebih besar dibaca per potongan oleh jalur streaming dan dikirim per batch,
 * tanpa pernah ada seluruhnya di memori. 1 MB kira-kira 10.000 baris produksi,
 * jadi ambangnya jatuh di kapasitas grid.
 */
const GRID_IMPORT_MAX_BYTES = 1_000_000;

/**
 * Lets the progress modal paint before a long synchronous step. Without it
 * the stage label only changes after the step it was meant to announce.
 */
function nextFrame() {
  return new Promise<void>((resolve) =>
    requestAnimationFrame(() => setTimeout(resolve, 0)),
  );
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The number the GRID puts on a row, given the row number this page works in.
 *
 * Univer numbers the frozen header row 1, so draft row N sits under the label
 * N+1. The panel used to print its own number raw: it said "baris 152" for the
 * row whose header reads 153, which is exactly the kind of mismatch that makes
 * someone delete the wrong thing.
 */
function gridRowLabel(row: number) {
  return (row + 1).toLocaleString("id-ID");
}

/** A column plus the exact value in it — the unit a bulk fix applies to. */
function fixKey(field: string, value: string) {
  return `${field}\u0000${value}`;
}

export function ManualDataPage({
  canWrite,
  canCreateBook = false,
  canCloseBook = false,
  userId = "",
  csrfToken,
}: {
  canWrite: boolean;
  /** `payroll.generate` — izin yang sama dengan `POST /payroll-periods`. */
  canCreateBook?: boolean;
  /** `payroll.lock` — tutup buku setara wewenang mengunci payroll. */
  canCloseBook?: boolean;
  /** Pemilik ingatan "buku terakhir dibuka"; kosong = tidak diingat. */
  userId?: string;
  csrfToken: string;
}) {
  const confirm = useConfirm();
  /*
    Rentang tanggal tidak lagi disimpan di sini: ia diturunkan dari buku
    periode yang sedang dipilih. Satu layar = satu buku, jadi dua sumber
    kebenaran untuk "baris mana yang terlihat" akan membuat grid memuat dua
    periode sekaligus — sebagian bisa ditulis, sebagian tidak, tanpa ada yang
    mengatakannya.
  */
  const [filter, setFilter] = useState<PeriodFilter>({
    query: "",
    pageSize: 100,
  });
  /*
    Mulai dari buku yang terakhir dibuka user ini. Id yang sudah tidak ada di
    daftar (buku dihapus, departemen lain) jatuh sendiri ke pilihan bawaan di
    `selectedPeriod`, jadi tidak perlu dibersihkan di sini.
  */
  const [periodId, setPeriodId] = useState<string | null>(() =>
    readLastPeriod(userId, env.VITE_PRODUCTION_DEPARTMENT_CODE),
  );
  const openPeriod = (id: string) => {
    setPeriodId(id);
    writeLastPeriod(userId, env.VITE_PRODUCTION_DEPARTMENT_CODE, id);
  };
  const [cursors, setCursors] = useState<(string | undefined)[]>([]);
  const [generation, setGeneration] = useState(0);
  const [pageNotice, setPageNotice] = useState("");
  const [navigationState, setNavigationState] = useState({
    dirty: false,
    busy: false,
  });
  const periods = useQuery({
    queryKey: ["payroll-periods"],
    queryFn: ({ signal }) => listPeriods(signal),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  /*
    Buku aktif DITURUNKAN, tidak disimpan lewat useEffect.

    Daftarnya datang belakangan, dan buku yang sedang dipilih bisa lenyap dari
    daftar (filter berubah, periode dihapus). Menyimpannya berarti ada satu
    render yang menampilkan buku yang tidak ada lagi, lalu sebuah effect yang
    mengejarnya. Turunan jatuh sendiri ke buku yang mencakup hari ini, lalu ke
    yang terbaru.
  */
  const selectedPeriod = useMemo(() => {
    const list = periods.data?.data ?? [];
    if (list.length === 0) return null;
    if (periodId) {
      const picked = list.find((period) => period.id === periodId);
      if (picked) return picked;
    }
    const now = today();
    return (
      list.find(
        (period) => period.periodStart <= now && now <= period.periodEnd,
      ) ??
      [...list].sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0] ??
      null
    );
  }, [periods.data, periodId]);
  const activeFilter: ProductionFilter | null = useMemo(
    () =>
      selectedPeriod ? { ...filter, ...periodRange(selectedPeriod) } : null,
    [filter, selectedPeriod],
  );
  const production = useQuery({
    queryKey: ["production", activeFilter, generation],
    // Tanpa buku tidak ada rentang, jadi tidak ada yang bisa diminta. Query
    // tetap didefinisikan supaya statusnya ikut alur render yang sama.
    enabled: activeFilter !== null,
    queryFn: ({ signal }) => listProduction(activeFilter!, signal),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  /*
    Buku tutup adalah keadaan, bukan kegagalan — tapi ia mengubah apa yang bisa
    dilakukan seluruh layar, jadi alasannya dihitung satu kali di sini dan
    dipakai bersama oleh gerbang tulis dan pesannya. Dua sumber akan membuat
    tombol nonaktif tanpa penjelasan, atau penjelasan tanpa tombol nonaktif.
  */
  const periodClosed = selectedPeriod?.status === "CLOSED";
  const readOnlyReason = !canWrite
    ? "Mode baca saja. Akun ini tidak memiliki izin mengubah produksi."
    : periodClosed && selectedPeriod
      ? `Buku periode ${selectedPeriod.code} (${selectedPeriod.periodStart} s/d ${selectedPeriod.periodEnd}) sudah tutup. Baris di dalamnya tidak bisa diubah lagi; koreksi setelah tutup buku lewat penyesuaian payroll.`
      : null;
  /*
    Dihitung dari SELURUH daftar, bukan dari buku yang sedang dipilih: admin
    boleh membuka buku lama, tapi yang terblokir besok adalah Simpan untuk
    tanggal hari ini. Hanya untuk penulis — pembaca tidak bisa berbuat apa-apa
    dengan peringatan ini.
  */
  const bookWarning =
    canWrite && periods.data ? periodWarning(periods.data.data, today()) : null;
  const queryClient = useQueryClient();
  /*
    Satu key per upaya logis, dibuat saat dialog dibuka dan dipakai ulang untuk
    setiap klik ulang di dialog yang sama — itu arti Idempotency-Key. Key baru
    per klik akan membuat retry setelah jaringan putus tampak seperti buku
    kedua.
  */
  const [createDraft, setCreateDraft] = useState<{
    key: string;
    initial: PeriodDraft;
  } | null>(null);
  const [closeTarget, setCloseTarget] = useState<PayrollPeriod | null>(null);
  const createBook = useMutation({
    mutationFn: (attempt: { key: string; draft: PeriodDraft }) =>
      createPeriod({ key: attempt.key, body: attempt.draft }, csrfToken),
    onSuccess: async (created) => {
      setCreateDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["payroll-periods"] });
      // Buku baru langsung dibuka — kecuali ada draft yang akan terbuang;
      // membuangnya diam-diam demi buku yang baru dibuat bukan pertukaran
      // yang boleh diputuskan layar ini sendiri.
      if (navigationState.dirty) {
        setPageNotice(
          `Buku ${created.code} dibuat. Simpan draft dulu, lalu pilih bukunya dari daftar.`,
        );
      } else {
        openPeriod(created.id);
        setCursors([]);
        setPageNotice(`Buku ${created.code} dibuat dan dibuka.`);
      }
    },
  });
  const closeBook = useMutation({
    mutationFn: (period: PayrollPeriod) => closePeriod(period.id, csrfToken),
    onSuccess: async (closed) => {
      setCloseTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["payroll-periods"] });
      setPageNotice(`Buku ${closed.code} sudah ditutup.`);
    },
  });
  const openCreate = () => {
    createBook.reset();
    setCreateDraft({
      key: crypto.randomUUID(),
      initial: suggestNextPeriod(
        periods.data?.data ?? [],
        today(),
        env.VITE_PRODUCTION_DEPARTMENT_CODE,
      ),
    });
  };
  const pins = useMemo(
    () => [...new Set(production.data?.data.map((row) => row.pin) ?? [])],
    [production.data],
  );
  const employees = useQuery({
    queryKey: ["production-names", pins],
    enabled: production.isSuccess,
    staleTime: Infinity,
    retry: false,
    queryFn: async ({ signal }) => {
      const names = new Map<string, string>();
      let next = 0;
      // Bounded concurrency; each PIN is separately cached, not a full HRIS directory fetch.
      await Promise.all(
        Array.from({ length: Math.min(8, pins.length) }, async () => {
          while (next < pins.length) {
            const pin = pins[next++];
            if (!pin || signal.aborted) return;
            const employee = await queryClient.fetchQuery({
              queryKey: ["employee", pin],
              queryFn: () => getEmployee(pin, signal),
              staleTime: 300_000,
            });
            names.set(pin, `${employee.fullName} · ${pin}`);
          }
        }),
      );
      return names;
    },
  });
  const workspaceShown = Boolean(production.data && employees.data);
  const pageControls = (
    <div className="manual-page-controls">
      {env.VITE_ENABLE_API_MOCKING && (
        <div className="manual-page-title">
          <span className="manual-mode-badge">Data contoh</span>
        </div>
      )}
      <ManualFilters
        key={`${selectedPeriod?.id ?? "none"}-${JSON.stringify(filter)}`}
        filter={filter}
        periods={periods.data?.data ?? []}
        selectedPeriod={selectedPeriod}
        periodsPending={periods.isPending}
        disabled={navigationState.busy}
        actions={
          (canCreateBook || canCloseBook) && (
            <div className="manual-period-actions">
              {canCreateBook && (
                <button
                  type="button"
                  className="manual-btn"
                  disabled={!periods.isSuccess}
                  onClick={openCreate}
                >
                  Buat buku
                </button>
              )}
              {canCloseBook && selectedPeriod?.status === "OPEN" && (
                <button
                  type="button"
                  className="manual-btn manual-danger-quiet"
                  disabled={navigationState.busy}
                  onClick={() => {
                    closeBook.reset();
                    setCloseTarget(selectedPeriod);
                  }}
                >
                  Tutup buku
                </button>
              )}
            </div>
          )
        }
        onApply={async (next, nextPeriodId) => {
          if (navigationState.busy) return;
          if (
            navigationState.dirty &&
            !(await confirm(
              nextPeriodId === undefined
                ? {
                    title: "Cari dan buang draft?",
                    message:
                      "Draft di layar ini belum disimpan. Menjalankan pencarian akan membuangnya.",
                    confirmLabel: "Buang draft dan cari",
                    tone: "danger",
                  }
                : {
                    title: "Pindah buku dan buang draft?",
                    message:
                      "Draft di layar ini belum disimpan. Pindah buku periode akan membuangnya.",
                    confirmLabel: "Buang draft dan pindah",
                    tone: "danger",
                  },
            ))
          )
            return;
          setFilter(next);
          if (nextPeriodId !== undefined) openPeriod(nextPeriodId);
          setCursors([]);
        }}
      />
    </div>
  );
  return (
    <div className="manual-page">
      <header className="manual-control-bar">
        {/*
          Judul sengaja tidak terlihat: tab navigasi sudah menamai halaman ini,
          jadi mengulangnya cuma memakan tinggi grid. Elemennya tetap ada supaya
          halaman punya satu h1 untuk pembaca layar.
        */}
        <h1 className="manual-page-heading">Manual Data</h1>
        {/*
          With a workspace on screen the same controls sit at the top of its
          right-hand column instead (see `Workspace`); here they are only the
          fallback for the states that have no grid — loading, no book yet,
          a failed load — so the book picker is never out of reach.
        */}
        {!workspaceShown && pageControls}
      </header>
      <CreatePeriodDialog
        initial={createDraft?.initial ?? null}
        departmentCode={env.VITE_PRODUCTION_DEPARTMENT_CODE}
        pending={createBook.isPending}
        error={createBook.error ? periodErrorMessage(createBook.error) : ""}
        onCancel={() => setCreateDraft(null)}
        onConfirm={(draft) =>
          createDraft && createBook.mutate({ key: createDraft.key, draft })
        }
      />
      <ClosePeriodDialog
        period={closeTarget}
        hasDraft={navigationState.dirty}
        pending={closeBook.isPending}
        error={closeBook.error ? periodErrorMessage(closeBook.error) : ""}
        onCancel={() => setCloseTarget(null)}
        onConfirm={() => closeTarget && closeBook.mutate(closeTarget)}
      />
      <div role="status" className="manual-status">
        {pageNotice}
      </div>
      {periods.isError && (
        <div role="alert" className="manual-error">
          <strong>Daftar buku periode belum dapat dimuat.</strong>
          <p>{periods.error.message}</p>
          <button className="manual-btn" onClick={() => void periods.refetch()}>
            Coba lagi
          </button>
        </div>
      )}
      {/*
        Tanpa buku periode tidak ada yang bisa ditampilkan DAN tidak ada yang
        bisa disimpan — backend menolak tiap baris yang tanggalnya tidak
        tercakup buku. Jadi ini bukan "data kosong", ini langkah yang belum
        dikerjakan, dan pesannya menyebut langkahnya.
      */}
      {periods.isSuccess && (periods.data?.data.length ?? 0) === 0 && (
        <div role="alert" className="manual-error">
          <strong>Belum ada buku periode.</strong>
          <p>
            Produksi dicatat per buku periode; sebelum ada buku tidak ada baris
            yang bisa dimuat atau disimpan.{" "}
            {canCreateBook
              ? "Buat buku pertama lewat tombol di bawah."
              : "Minta HRD membuat periodenya dulu."}
          </p>
          {canCreateBook && (
            <button
              type="button"
              className="manual-btn manual-primary"
              onClick={openCreate}
            >
              Buat buku pertama
            </button>
          )}
        </div>
      )}
      {bookWarning && (
        <p role="status" className="manual-period-warning">
          {periodWarningMessage(bookWarning)}
        </p>
      )}
      {activeFilter !== null && production.isPending && (
        <p role="status" className="manual-notice">
          Memuat data produksi…
        </p>
      )}
      {production.isError && (
        <div role="alert" className="manual-error">
          <strong>Data belum dapat dimuat.</strong>
          <p>{production.error.message}</p>
          <button
            className="manual-btn"
            onClick={() => void production.refetch()}
          >
            Coba lagi
          </button>
        </div>
      )}
      {production.isSuccess && employees.isPending && (
        <p role="status">Memuat nama karyawan…</p>
      )}
      {employees.isError && (
        <div role="alert" className="manual-error">
          Nama karyawan belum dapat dimuat. {employees.error.message}{" "}
          <button
            className="manual-btn"
            onClick={() => void employees.refetch()}
          >
            Coba lagi
          </button>
        </div>
      )}
      {production.data && employees.data && (
        <Workspace
          key={`${JSON.stringify(activeFilter)}-${generation}`}
          controls={pageControls}
          entries={production.data.data}
          names={employees.data}
          canWrite={canWrite && !periodClosed}
          readOnlyReason={readOnlyReason}
          csrfToken={csrfToken}
          onNavigationState={setNavigationState}
          onReload={(message) => {
            setPageNotice(message ?? "");
            setGeneration((value) => value + 1);
          }}
          onNext={
            production.data.page.hasNextPage && production.data.page.nextCursor
              ? () => {
                  setCursors((history) => [...history, filter.after]);
                  setFilter({
                    ...filter,
                    after: production.data.page.nextCursor ?? "",
                  });
                }
              : undefined
          }
          onPrevious={
            cursors.length
              ? () => {
                  const previous = cursors.at(-1);
                  setCursors((history) => history.slice(0, -1));
                  const base = { ...filter };
                  delete base.after;
                  setFilter(previous ? { ...base, after: previous } : base);
                }
              : undefined
          }
          pageNumber={cursors.length + 1}
          pageSize={filter.pageSize}
          onPageSize={(pageSize) => {
            setFilter({ query: filter.query, pageSize });
            setCursors([]);
          }}
        />
      )}
    </div>
  );
}

/** Bagian filter yang BUKAN buku periode — rentang tanggalnya diturunkan. */
type PeriodFilter = Omit<ProductionFilter, "startAt" | "endAt">;

/** `2026-09-01` → `1 Sep 2026`, supaya label dropdown terbaca sekali lihat. */
function periodDateLabel(date: string) {
  const [year, month, day] = date.split("-");
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "Mei",
    "Jun",
    "Jul",
    "Agu",
    "Sep",
    "Okt",
    "Nov",
    "Des",
  ];
  const name = months[Number(month) - 1];
  if (!year || !name || !day) return date;
  return `${Number(day)} ${name} ${year}`;
}

/**
 * Pesan penolakan buku dari `code` terstruktur, bukan dari mem-parse
 * `message`. Tumpang tindih menyebut buku mana yang bertabrakan, karena itu
 * satu-satunya hal yang perlu diketahui untuk memperbaiki tanggalnya.
 */
function periodErrorMessage(error: Error) {
  if (!(error instanceof ApiClientError)) return error.message;
  if (error.code === "PAYROLL_PERIOD_OVERLAP") {
    const conflicts = conflictsOf(error.payload);
    return conflicts.length > 0
      ? `Rentang bertumpuk dengan buku ${conflicts
          .map((c) => `${c.code} (${c.periodStart} s/d ${c.periodEnd})`)
          .join(", ")}. Ubah tanggalnya supaya tidak bertumpuk.`
      : "Rentang bertumpuk dengan buku lain. Ubah tanggalnya supaya tidak bertumpuk.";
  }
  if (error.code === "PAYROLL_PERIOD_HAS_UNFINISHED_RUNS")
    return `${error.message}. Selesaikan (kunci atau batalkan) payroll run-nya di Summary dulu.`;
  if (error.code === "PERMISSION_DENIED")
    return "Akun ini tidak berhak melakukan aksi ini pada buku periode.";
  return error.message;
}

function conflictsOf(
  payload: unknown,
): { code: string; periodStart: string; periodEnd: string }[] {
  const details = (payload as { error?: { details?: { conflicts?: unknown } } })
    ?.error?.details;
  return Array.isArray(details?.conflicts)
    ? (details.conflicts as {
        code: string;
        periodStart: string;
        periodEnd: string;
      }[])
    : [];
}

/**
 * Rentang tanpa bagian yang berulang: "24 Agu – 23 Sep 2026", "1–30 Sep 2026".
 * Label penuh tidak muat di kolom kanan (±21rem) dan terpotong tepat di tahun
 * akhir — padahal tahun itulah yang membedakan buku yang satu dari yang lain.
 */
function periodRangeLabel(start: string, end: string) {
  const [startYear, startMonth] = start.split("-");
  const [endYear, endMonth] = end.split("-");
  const full = periodDateLabel(start);
  if (startYear !== endYear) return `${full} – ${periodDateLabel(end)}`;
  const sameMonth = startMonth === endMonth;
  const head = full
    .split(" ")
    .slice(0, sameMonth ? 1 : 2)
    .join(" ");
  return `${head}${sameMonth ? "–" : " – "}${periodDateLabel(end)}`;
}

function periodOptionLabel(period: PayrollPeriod) {
  const range = periodRangeLabel(period.periodStart, period.periodEnd);
  return period.status === "CLOSED"
    ? `${period.code} · ${range} · TUTUP`
    : `${period.code} · ${range}`;
}

function ManualFilters({
  filter,
  periods,
  selectedPeriod,
  periodsPending,
  onApply,
  disabled,
  actions,
}: {
  filter: PeriodFilter;
  periods: PayrollPeriod[];
  selectedPeriod: PayrollPeriod | null;
  periodsPending: boolean;
  /** `periodId` tidak dikirim saat hanya pencarian yang berubah. */
  onApply(value: PeriodFilter, periodId?: string): void;
  disabled: boolean;
  /** Buat/Tutup buku, di baris judul buku yang mereka ubah. */
  actions?: ReactNode;
}) {
  const selectId = useId();
  const searchId = useId();
  return (
    <div className="manual-filters">
      <div className="manual-book">
        <div className="manual-book-head">
          <label htmlFor={selectId}>Buku periode</label>
          {selectedPeriod && (
            <span
              className={
                selectedPeriod.status === "CLOSED"
                  ? "manual-period-badge manual-period-closed"
                  : "manual-period-badge manual-period-open"
              }
            >
              {selectedPeriod.status === "CLOSED" ? "Tutup" : "Terbuka"}
            </span>
          )}
          {actions}
        </div>
        {/*
          Buku periode diterapkan saat dipilih, tidak menunggu tombol: ia bukan
          penyaring di atas data yang sama, ia MENENTUKAN data mana yang ada di
          layar. Menaruhnya di belakang tombol berarti dropdown bisa
          menampilkan satu buku sementara grid masih menampilkan isi buku lain.
        */}
        <select
          id={selectId}
          name="period"
          disabled={disabled || periodsPending || periods.length === 0}
          value={selectedPeriod?.id ?? ""}
          onChange={(event) => {
            const next = event.target.value;
            if (!next || next === selectedPeriod?.id) return;
            onApply({ query: filter.query, pageSize: filter.pageSize }, next);
          }}
        >
          {periods.length === 0 && (
            <option value="">
              {periodsPending ? "Memuat periode…" : "Belum ada buku periode"}
            </option>
          )}
          {periods.map((period) => (
            <option key={period.id} value={period.id}>
              {periodOptionLabel(period)}
            </option>
          ))}
        </select>
      </div>
      {/*
        Ukuran halaman tinggal di paginasi, di samping Sebelumnya/Berikutnya
        yang ia ubah; di sini hanya pencarian, satu kolom isian + satu tombol.
      */}
      <form
        role="search"
        className="manual-search"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onApply({
            query: String(data.get("query")).trim(),
            pageSize: filter.pageSize,
          });
        }}
      >
        <label htmlFor={searchId} className="manual-visually-hidden">
          Cari produksi
        </label>
        <input
          id={searchId}
          type="search"
          name="query"
          placeholder="Cari PIN atau data produksi"
          defaultValue={filter.query}
        />
        <button className="manual-btn" type="submit" disabled={disabled}>
          Cari
        </button>
      </form>
    </div>
  );
}

/*
  The gutter beside the grid holds up to three panels, and 24rem is not enough
  for two of them at once: stacking the employee directory on top of the error
  list pushed the fix fields off screen and gave the page a scrollbar inside a
  scrollbar. One at a time, switched by a tab strip.
*/
type SideTab = "errors" | "directory" | "editor";

interface WorkspaceProps {
  onNavigationState(state: { dirty: boolean; busy: boolean }): void;
  entries: Entry[];
  names: ReadonlyMap<string, string>;
  canWrite: boolean;
  /**
   * Kenapa layar ini read-only, atau null kalau tidak. Dihitung di halaman
   * supaya gerbang tulis dan penjelasannya tidak bisa berbeda pendapat —
   * tombol nonaktif tanpa alasan terbaca seperti aplikasi rusak.
   */
  readOnlyReason: string | null;
  csrfToken: string;
  onReload(message?: string): void;
  onNext: (() => void) | undefined;
  onPrevious: (() => void) | undefined;
  pageNumber: number;
  pageSize: number;
  onPageSize(size: number): void;
  /** Book picker and filters, placed at the top of the right-hand column. */
  controls: ReactNode;
}
function Workspace({
  entries,
  names,
  canWrite,
  readOnlyReason,
  csrfToken,
  onReload,
  onNext,
  onPrevious,
  pageNumber,
  pageSize,
  onPageSize,
  onNavigationState,
  controls,
}: WorkspaceProps) {
  const confirm = useConfirm();
  const [importProgress, setImportProgress] =
    useState<ImportProgressState | null>(null);
  const setImportStage = (
    stage: ImportStage,
    extra: Partial<ImportProgressState> = {},
  ) =>
    setImportProgress((current) =>
      current
        ? {
            ...current,
            stage,
            onCancel: undefined,
            fraction: undefined,
            ...extra,
          }
        : current,
    );
  const [control, setControl] = useState<GridControl | null>(null);
  const [status, setStatus] = useState<GridStatus>({
    active: 1,
    selected: 0,
    populated: entries.length,
    dirty: false,
  });
  const [editorOpen, setEditorOpen] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [sideTab, setSideTab] = useState<SideTab>("errors");
  /**
   * An import has landed in the draft and nothing has been saved since.
   *
   * While that is true the row editor stays out of the way: the side column
   * belongs to the problem list, and editing a single row makes no sense while
   * thousands of freshly imported ones are still waiting to be checked.
   */
  const [importedUnsaved, setImportedUnsaved] = useState(false);
  /** Replacement typed for each distinct bad value, keyed by column + value. */
  const [fixes, setFixes] = useState<Record<string, string>>({});
  const [assigneeAnchor, setAssigneeAnchor] =
    useState<AssigneeEditorAnchor | null>(null);
  const [dateAnchor, setDateAnchor] = useState<DateCellAnchor | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [notice, setNoticeText] = useState("");
  /**
   * Whether the standing message is a failure.
   *
   * A failed import used to look exactly like "12 baris ditempel ke draft" —
   * same grey strip, same weight — so the one message the admin had to act on
   * was the easiest to miss. `setNotice` clears the flag, so an ordinary
   * message can never inherit the alarm from the one before it, and only the
   * handful of real failures call `failNotice`.
   */
  const [noticeFailed, setNoticeFailed] = useState(false);
  const setNotice = (message: string) => {
    setNoticeText(message);
    setNoticeFailed(false);
  };
  const failNotice = (message: string) => {
    setNoticeText(message);
    setNoticeFailed(true);
  };
  const [errors, setErrors] = useState<RowError[]>([]);
  const [clipboard, setClipboard] = useState<string | null>(null);
  /** Nama file ketika isi preview datang dari impor, bukan dari clipboard. */
  const importInput = useRef<HTMLInputElement>(null);
  /** Impor langsung ke server untuk file yang tidak muat di workspace. */
  const [bulkImport, setBulkImport] = useState<{
    file: File;
    running: boolean;
    progress: ImportProgress | null;
    summary: ImportSummary | null;
    error: string;
  } | null>(null);
  const bulkAbort = useRef<AbortController | null>(null);
  const [pasteTarget, setPasteTarget] = useState({ row: 1, column: 1 });
  const [attempt, setAttempt] = useState<SaveAttempt | null>(null);
  const [voidTarget, setVoidTarget] = useState<Baseline | null>(null);
  const [voidAttempt, setVoidAttempt] = useState<VoidAttempt | null>(null);
  const [voidError, setVoidError] = useState("");
  const [resolvingPaste, setResolvingPaste] = useState(false);
  const pasteAbort = useRef<AbortController | null>(null);
  useEffect(() => () => pasteAbort.current?.abort(), []);
  const employeeCache = useQueryClient();
  const [comparison, setComparison] = useState<{
    local: DraftRow;
    server: Entry;
  } | null>(null);
  const labels = useRef(new Map<string, string>());
  useEffect(() => {
    labels.current = new Map([...names].map(([pin, name]) => [name, pin]));
  }, [names]);
  const mutation = useMutation({
    mutationFn: (pending: SaveAttempt) =>
      saveProductionBatched(pending, csrfToken, (sent, total) =>
        setNotice(
          `Menyimpan… ${sent.toLocaleString("id-ID")} dari ${total.toLocaleString("id-ID")} baris terkirim.`,
        ),
      ),
  });
  const voidMutation = useMutation({
    mutationFn: (pending: VoidAttempt) => voidProduction(pending, csrfToken),
  });
  const blocker = useBlocker(
    status.dirty ||
      attempt !== null ||
      resolvingPaste ||
      voidAttempt !== null ||
      voidMutation.isPending,
  );
  /*
    Satu pertanyaan per navigasi yang terblokir. Selama modal terbuka blocker
    tetap "blocked" dan efek ini bisa jalan lagi; tanpa penjaga, pertanyaan
    yang sama menumpuk di antrean dan harus dijawab berkali-kali.
  */
  const askingToLeave = useRef(false);
  useEffect(() => {
    if (blocker.state !== "blocked" || askingToLeave.current) return;
    askingToLeave.current = true;
    void confirm({
      title: "Tinggalkan halaman?",
      message:
        "Ada draft yang belum disimpan. Meninggalkan halaman akan membuang draft tersebut.",
      confirmLabel: "Buang draft dan tinggalkan",
      tone: "danger",
    }).then((leave) => {
      askingToLeave.current = false;
      if (leave) blocker.proceed();
      else blocker.reset();
    });
  }, [blocker, confirm]);
  useEffect(() => {
    if (!status.dirty && !attempt && !voidAttempt && !voidMutation.isPending)
      return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [status.dirty, attempt, voidAttempt, voidMutation.isPending]);
  const busy =
    mutation.isPending ||
    attempt !== null ||
    resolvingPaste ||
    voidMutation.isPending ||
    voidAttempt !== null;
  const canEdit = canWrite && !busy;
  useEffect(() => {
    onNavigationState({ dirty: status.dirty, busy });
  }, [status.dirty, busy, onNavigationState]);
  const requestAssignee = useCallback((anchor: AssigneeEditorAnchor | null) => {
    setAssigneeAnchor(anchor);
    if (anchor) setFocusRequest((value) => value + 1);
  }, []);
  const requestDateCell = useCallback(
    (anchor: DateCellAnchor | null) => setDateAnchor(anchor),
    [],
  );
  /**
   * Writes the picked timestamp back through the same path the row editor
   * uses: re-read the row first, because the grid's status updates are
   * rAF-debounced and a stale snapshot would clobber a neighbouring edit.
   */
  function applyDateCell(value: string) {
    if (!control || !dateAnchor || !canEdit) return;
    const cells = control.readRow(dateAnchor.row)?.cells;
    if (!cells) return;
    const next = [...cells];
    next[dateAnchor.column - 1] = value;
    control.write(dateAnchor.row, next);
    setDateAnchor({ ...dateAnchor, value });
  }
  // The sheet shows WHERE the problems are; the strip and the summary below
  // say WHAT they are. Re-marking on every change also clears stale marks when
  // the list empties.
  useEffect(() => {
    control?.markErrors(
      errors.map((error) => ({
        row: error.row,
        // "Baris" is the whole-row failure the validator reports with no
        // column of its own; it points at the first cell.
        column: Math.max(
          1,
          (columns as readonly string[]).indexOf(error.field) + 1,
        ),
      })),
    );
  }, [control, errors]);
  useEffect(() => {
    if (!status.dirty) setImportedUnsaved(false);
  }, [status.dirty]);
  const showEditor = editorOpen && !importedUnsaved;
  const activeErrors = errors.filter((error) => error.row === status.active);
  /** Distinct problems, so 27,000 cells read as the handful of causes they are. */
  /**
   * Causes, each carrying the distinct values that produced it.
   *
   * One list, not two: a separate summary and a separate fix panel repeated
   * the same counts and the same sentence on every row, which is most of what
   * made the column unreadable. The cause is stated once; under it sit the
   * values an admin can actually correct.
   */
  type FixValue = {
    key: string;
    field: string;
    value: string;
    count: number;
    firstRow: number;
  };
  type ErrorGroup = {
    message: string;
    count: number;
    firstRow: number;
    /** Every row this cause touches, for deleting the whole cause at once. */
    rows: Set<number>;
    values: Map<string, FixValue>;
  };
  const sidePanels: { id: SideTab; label: string }[] = [
    ...(errors.length > 0
      ? [
          {
            id: "errors" as const,
            label: `Masalah (${errors.length.toLocaleString("id-ID")})`,
          },
        ]
      : []),
    ...(directoryOpen
      ? [{ id: "directory" as const, label: "Data karyawan" }]
      : []),
    ...(showEditor ? [{ id: "editor" as const, label: "Editor baris" }] : []),
  ];
  // Derived, not stored: a panel can disappear under the tab that is showing
  // it (errors all fixed, editor hidden by an import), and falling back here
  // means no effect has to chase that and no render shows an empty gutter.
  const activeSide =
    sidePanels.find((panel) => panel.id === sideTab)?.id ?? sidePanels[0]?.id;
  const tabbed = sidePanels.length > 1;
  const panelProps = (id: SideTab) =>
    tabbed
      ? {
          role: "tabpanel",
          "aria-labelledby": `manual-side-tab-${id}`,
          hidden: activeSide !== id,
        }
      : {};
  const errorGroups = [
    ...errors
      .reduce((groups, error) => {
        const found = groups.get(error.message) ?? {
          message: error.message,
          count: 0,
          firstRow: error.row,
          rows: new Set<number>(),
          values: new Map<string, FixValue>(),
        };
        found.count += 1;
        found.rows.add(error.row);
        if (error.value) {
          const key = fixKey(error.field, error.value);
          const seen = found.values.get(key);
          if (seen) seen.count += 1;
          else
            found.values.set(key, {
              key,
              field: error.field,
              value: error.value,
              count: 1,
              firstRow: error.row,
            });
        }
        groups.set(error.message, found);
        return groups;
      }, new Map<string, ErrorGroup>())
      .values(),
  ]
    .map((group) => ({
      ...group,
      values: [...group.values.values()].sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.count - a.count);
  const row = control?.readRow(status.active);
  /**
   * Turns whatever sits in the assignee cells into labels the grid knows.
   *
   * Every unknown value goes upstream in ONE request, which resolves a PIN or
   * an EID against payroll's own store first and only asks HRIS about what it
   * has never seen. Used by paste AND by save: a value reaches a cell by
   * pasting, by importing, or by typing, and "Simpan" must not be the first
   * place that notices an EID was never translated.
   */
  async function resolveAssignees(values: string[], signal: AbortSignal) {
    const resolved = new Map<string, string>();
    const failed = new Map<string, string>();
    const unknown = [
      ...new Set(values.filter((value) => value && !labels.current.has(value))),
    ];
    if (!unknown.length) return { resolved, failed };

    const lookup = await employeeCache.fetchQuery({
      // Sorted so the same set of assignees reuses one cached answer however
      // the rows happened to be ordered.
      queryKey: ["employee-lookup", [...unknown].sort().join("\u0000")],
      queryFn: () => lookupEmployees(unknown, csrfToken, signal),
      staleTime: 300_000,
      retry: false,
    });

    for (const match of lookup.resolved) {
      // Employment status is NOT a gate. Someone who resigned last month still
      // has to be paid for the rolls they wove before leaving, and locked
      // payroll history must stay displayable for them (api-contract §4).
      // The cell may hold an EID, so the returned PIN is allowed to differ
      // from what was written — that IS the resolution. The label shows the
      // real PIN, so the admin sees who each row landed on before saving.
      const label = `${match.fullName} · ${match.pin}`;
      resolved.set(match.ref, label);
      labels.current.set(label, match.pin);
    }
    for (const miss of lookup.unresolved) {
      failed.set(
        miss.ref,
        miss.reason === "AMBIGUOUS"
          ? `EID ini dipakai lebih dari satu karyawan (PIN ${miss.candidatePins?.join(", ") ?? "?"}). Tulis PIN-nya.`
          : "Data karyawan tidak dapat ditemukan di HRIS.",
      );
    }

    return { resolved, failed };
  }
  /** Specific reasons win: the generic message would only bury them. */
  function mergeErrors(specific: RowError[], generic: RowError[]) {
    return [
      ...specific,
      ...generic.filter(
        (error) =>
          !specific.some(
            (found) => found.row === error.row && found.field === error.field,
          ),
      ),
    ];
  }
  /**
   * Resolves every assignee cell, writes the labels back, and recomputes the
   * problem list.
   *
   * Shared by Simpan and by the bulk fix panel so the two can never disagree
   * about what counts as a problem — a bulk fix that thought it had cleared a
   * cell while Simpan still rejected it would be worse than no fix at all.
   */
  async function resolveAndValidate() {
    if (!control) return [] as RowError[];

    const current = control.read();
    const lookup = await resolveAssignees(
      current.map((draft) => draft.cells[3] ?? ""),
      new AbortController().signal,
    );

    current.forEach((draft, index) => {
      const label = lookup.resolved.get(draft.cells[3] ?? "");
      if (!label) return;
      const cells = [...draft.cells];
      cells[3] = label;
      // Row by row, and only where it changed: rewriting the whole range
      // would flatten every untouched cell on every save.
      control.write(index + 1, cells);
    });

    const drafts = control.read();
    const found = mergeErrors(
      drafts.flatMap((draft, index) => {
        const value = draft.cells[3] ?? "";
        const message = lookup.failed.get(value);
        return message
          ? [{ row: index + 1, field: columns[3], value, message }]
          : [];
      }),
      validateRows(drafts, labels.current).errors,
    );
    setErrors(found);

    return found;
  }

  /**
   * Rewrites every cell in one column that holds exactly `from`.
   *
   * 814 bad cells in a real import were six distinct EIDs: the same operator
   * owns a run of rows, so the fix is per value, not per cell. Matching is on
   * the exact trimmed value — never a prefix — so correcting one operator
   * cannot touch another whose identifier merely starts the same.
   */
  /**
   * Drops the rows behind one problem instead of correcting them.
   *
   * The counterpart to `applyBulkFix`: an import carries rows nobody intends
   * to keep — a machine logged against an operator who left, a block of blank
   * results — and forcing a correction on those means inventing data. Deleting
   * is the honest answer, so it sits beside the fix rather than below it.
   *
   * The rows are deleted, not blanked: the rows under them move up, exactly
   * like Delete row in the right-click menu, so a cleaned-up import is not
   * left full of holes.
   *
   * Saved rows are never touched. `removeDrafts` already refuses them, but the
   * count is reported separately: silently deleting 12 of 20 rows and calling
   * it done is worse than saying which 8 need `Batalkan` and an audit trail.
   */
  async function removeProblemRows(
    pick: (drafts: DraftRow[]) => Promise<number[]> | number[],
    what: string,
  ) {
    if (!control || !canEdit) return;
    await control.finish();

    // Targets are derived from the sheet AS IT IS NOW, never from row numbers
    // captured when the panel rendered. `errors` is only recomputed by an
    // explicit validate, so typing into a cell leaves those numbers pointing
    // at rows whose contents have since changed — and deleting by them wipes
    // whatever moved into their place. Same rule `applyBulkFix` follows.
    const targets = [...new Set(await pick(control.read()))].sort(
      (a, b) => a - b,
    );
    const drafts: string[] = [];
    let saved = 0;
    for (const row of targets) {
      const draft = control.readRow(row);
      if (!draft) continue;
      if (draft.original) saved += 1;
      else drafts.push(draft.key);
    }

    if (!drafts.length) {
      failNotice(
        saved
          ? `${saved.toLocaleString("id-ID")} baris sudah tersimpan di server dan tidak dihapus dari sini. Gunakan Batalkan supaya histori audit tetap ada.`
          : "Tidak ada baris draft yang cocok untuk dihapus.",
      );
      return;
    }
    if (
      !(await confirm({
        title: `Hapus ${drafts.length.toLocaleString("id-ID")} baris?`,
        message: `Baris ${what} dihapus dari sheet — baris di bawahnya naik — dan tidak akan disimpan.`,
        confirmLabel: `Hapus ${drafts.length.toLocaleString("id-ID")} baris`,
        tone: "danger",
      }))
    )
      return;

    setResolvingPaste(true);
    try {
      const removed = control.removeDrafts(drafts);
      // Full re-resolve, not just `validateRows`: the assignee failures come
      // from the HRIS lookup, and revalidating without it would blank them for
      // every row that still has one.
      const left = await resolveAndValidate();
      setNotice(
        `${removed.toLocaleString("id-ID")} baris dihapus. ` +
          `${left.length.toLocaleString("id-ID")} sel masih perlu diperbaiki.` +
          (saved
            ? ` ${saved.toLocaleString("id-ID")} baris tersimpan dilewati; gunakan Batalkan.`
            : ""),
      );
    } finally {
      setResolvingPaste(false);
    }
  }
  async function applyBulkFix(field: string, from: string, to: string) {
    const column = (columns as readonly string[]).indexOf(field);
    const next = to.trim();
    if (!control || !canEdit || column < 0 || !next || next === from) return;

    setResolvingPaste(true);
    try {
      await control.finish();
      const drafts = control.read();
      const targets = rowsWithValue(drafts, field, from);
      for (const row of targets) {
        const cells = [...(drafts[row - 1]?.cells ?? [])];
        cells[column] = next;
        control.write(row, cells);
      }
      const changed = targets.length;

      const found = await resolveAndValidate();
      setFixes((current) => {
        const rest = { ...current };
        delete rest[fixKey(field, from)];
        return rest;
      });
      setNotice(
        `${changed.toLocaleString("id-ID")} sel diubah jadi "${next}". ` +
          `${found.length.toLocaleString("id-ID")} sel masih perlu diperbaiki.`,
      );
    } finally {
      setResolvingPaste(false);
    }
  }

  async function save(retry?: SaveAttempt) {
    if (!control || !canWrite || mutation.isPending) return;
    await control.finish();

    // Auto-correct the assignee cells before judging them. Without this, a
    // sheet pasted with EIDs is rejected here with nothing the admin can act
    // on — the value is correct, it just has not been translated yet.
    if (!retry && (await resolveAndValidate()).length) {
      failNotice(
        "Perbaiki baris yang belum valid. Belum ada data yang dikirim.",
      );
      return;
    }

    const drafts = control.read();
    const validation = validateRows(drafts, labels.current);
    const rows = validation.rows.filter((input) =>
      isChanged(
        input,
        drafts.find((draft) => draft.key === input.clientRowId)?.original,
      ),
    );
    const changedKey = rows.some((input) => {
      const old = drafts.find(
        (draft) => draft.key === input.clientRowId,
      )?.original;
      return (
        old &&
        (Date.parse(old.shiftStart) !== Date.parse(input.shiftStart) ||
          Date.parse(old.shiftEnd) !== Date.parse(input.shiftEnd) ||
          old.stationNo !== input.stationNo)
      );
    });
    if (!retry && changedKey) {
      failNotice(
        "Kunci baris tersimpan tidak boleh diubah melalui batch. Koreksi shift/mesin memerlukan alur PATCH terpisah; pulihkan nilai tersebut sebelum simpan.",
      );
      return;
    }
    if (!retry && !rows.length) {
      setNotice("Tidak ada perubahan untuk disimpan.");
      return;
    }
    const pending = retry ?? { key: crypto.randomUUID(), rows };
    setAttempt(pending);
    setErrors([]);
    setNotice(
      pending.rows.length > SAVE_BATCH_ROWS
        ? `Menyimpan ${pending.rows.length.toLocaleString("id-ID")} baris dalam beberapa batch…`
        : "Menyimpan batch…",
    );
    try {
      const result = await mutation.mutateAsync(pending);
      if (
        result.rows.length !== pending.rows.length ||
        new Set(result.rows.map((item) => item.clientRowId)).size !==
          pending.rows.length ||
        result.rows.some(
          (item) =>
            !pending.rows.some(
              (input) => input.clientRowId === item.clientRowId,
            ) ||
            (item.outcome !== "REJECTED" &&
              (!item.productionEntryId || !item.rowVersion)),
        )
      )
        throw new Error(
          "Respons batch tidak lengkap. Ulangi percobaan dengan idempotency key yang sama.",
        );
      control.accept(pending.rows, result);
      setAttempt(null);
      setErrors(
        result.rows.flatMap((item) =>
          item.outcome === "REJECTED"
            ? (item.fieldErrors?.length
                ? item.fieldErrors
                : [{ field: "Baris", message: "Baris ditolak server." }]
              ).map((error) => ({
                row:
                  drafts.findIndex((draft) => draft.key === item.clientRowId) +
                  1,
                field: error.field,
                value: "",
                message: error.message,
              }))
            : [],
        ),
      );
      setNotice(
        `${result.counts.inserted} ditambahkan · ${result.counts.updated} diperbarui · ${result.counts.unchanged} tetap · ${result.counts.rejected} ditolak. Draft baris ditolak tetap tersedia.`,
      );
    } catch (error) {
      failNotice(
        `${error instanceof Error ? error.message : "Simpan gagal."} Draft tetap tersedia.`,
      );
      // Definitive 4xx rejections did not apply the batch. Unknown outcomes retain their key/payload.
      if (
        error instanceof ApiClientError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![408, 429].includes(error.status)
      )
        setAttempt(null);
    }
  }
  async function navigate(action: (() => void) | undefined) {
    if (!action) return;
    if (
      status.dirty &&
      !(await confirm({
        title: "Buang draft dan pindah halaman?",
        message:
          "Draft di halaman ini belum disimpan. Pindah halaman akan membuangnya.",
        confirmLabel: "Buang draft dan pindah",
        tone: "danger",
      }))
    )
      return;
    action();
  }
  async function copyRows() {
    if (!control) return;
    await control.finish();
    const selected = control.selected();
    const text = selected
      .map((draft) =>
        draft.cells
          .map((cell, index) =>
            index === 3 ? (labels.current.get(cell) ?? cell) : cell,
          )
          .join("\t"),
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setNotice(
        `${selected.length} baris disalin. PIN dipakai di clipboard untuk menjaga identitas karyawan.`,
      );
    } catch {
      setClipboard(text);
      setNotice(
        "Clipboard browser tidak tersedia. Salin teks di panel clipboard secara manual.",
      );
    }
  }
  async function removeRows() {
    if (!control || !canEdit) return;
    await control.finish();
    const selected = control.selected();
    const drafts = selected.filter(
      (item) => !item.original && item.cells.some((cell) => cell !== ""),
    );
    const saved = selected.filter((item) => item.original).length;
    if (!drafts.length) {
      setNotice(
        saved
          ? `${saved} data tersimpan tidak dihapus. Gunakan Batalkan agar histori audit tetap aman.`
          : "Baris yang dipilih masih kosong; tidak ada draft yang perlu dihapus.",
      );
      return;
    }
    if (
      !(await confirm({
        title: `Hapus ${drafts.length.toLocaleString("id-ID")} baris draft?`,
        message:
          "Baris draft yang dipilih dihapus dari sheet — baris di bawahnya naik — dan perubahannya hilang.",
        confirmLabel: `Hapus ${drafts.length.toLocaleString("id-ID")} baris`,
        tone: "danger",
      }))
    )
      return;
    const removed = control.removeDrafts(drafts.map((item) => item.key));
    // Full re-resolve, same as the problem panel: `validateRows` alone blanks
    // the assignee failures that only the HRIS lookup can produce.
    await resolveAndValidate();
    setNotice(
      `${removed} baris draft dihapus.${
        saved ? ` ${saved} data tersimpan tidak dihapus; gunakan Batalkan.` : ""
      }`,
    );
  }
  function openPaste(text: string) {
    if (!canEdit || !control) return;
    setPasteTarget(control.activeCell());
    setClipboard(text);
    setErrors([]);
  }

  /**
   * Impor file memakai jalur paste yang sama persis: file diubah jadi TSV,
   * lalu preview, resolusi PIN, validasi, dan Simpan berjalan seperti biasa.
   * Tidak ada jalur tulis kedua yang aturannya bisa menyimpang diam-diam.
   */
  async function importFile(chosen: File) {
    if (!canEdit || !control) return;
    setImportProgress({ fileName: chosen.name, stage: "read" });
    try {
      await nextFrame();
      await importFileSteps(chosen);
    } finally {
      setImportProgress(null);
    }
  }
  async function importFileSteps(chosen: File) {
    if (!canEdit || !control) return;
    setErrors([]);

    /*
      .xlsx diterjemahkan dulu ke teks tab-separated, lalu masuk jalur yang
      sama dengan CSV. Batas grid di bawah dinilai dari ukuran TEKS hasil
      terjemahan, bukan ukuran zip-nya: .xlsx terkompresi sekitar sepersepuluh
      CSV-nya, dan menilai dari ukuran zip akan memasukkan file sejuta baris ke
      grid.
    */
    let file = chosen;
    let sheetLabel = "";
    if (isXlsxFile(chosen)) {
      try {
        setNotice(`Membaca ${chosen.name}…`);
        const { xlsxToText } = await import("../model/xlsx-import");
        const sheet = xlsxToText(new Uint8Array(await chosen.arrayBuffer()));
        file = new File([sheet.text], chosen.name, {
          type: "text/tab-separated-values",
        });
        sheetLabel = ` (sheet ${sheet.sheetName})`;
      } catch (error) {
        failNotice(
          error instanceof Error
            ? error.message
            : `${chosen.name} tidak bisa dibaca.`,
        );
        return;
      }
    }

    // File yang lebih besar dari kapasitas grid tidak lewat grid sama sekali:
    // permukaan edit punya batas, jumlah data yang boleh masuk tidak.
    if (file.size > GRID_IMPORT_MAX_BYTES) {
      setBulkImport({
        file,
        running: false,
        progress: null,
        summary: null,
        error: "",
      });
      setNotice(
        `${file.name} (${formatBytes(file.size)}) terlalu besar untuk workspace. ` +
          "Impor langsung ke server, tanpa lewat grid.",
      );
      return;
    }

    try {
      const content = await file.text();
      setImportStage("parse");
      await nextFrame();
      const parsed = parseImportFile(content);

      await control.finish();
      // Baris draft kosong pertama, bukan baris 1: baris awal workspace biasanya
      // berisi data yang sudah tersimpan, dan menimpanya diam-diam mengubah
      // produksi orang lain lewat jalur yang dikira "menambah".
      const drafts = control.read();
      const start = drafts.findIndex(
        (item) => !item.original && item.cells.every((cell) => !cell),
      );

      const target = start >= 0 ? start : drafts.length;

      if (target + parsed.cells.length > MAX_ROWS) {
        // Muat di file, tidak muat di grid: kirim langsung, jangan suruh orang
        // memecah filenya sendiri.
        setBulkImport({
          file,
          running: false,
          progress: null,
          summary: null,
          error: "",
        });
        setNotice(
          `${parsed.cells.length.toLocaleString("id-ID")} baris tidak muat di sisa workspace. ` +
            "Impor langsung ke server, tanpa lewat grid.",
        );
        return;
      }

      setPasteTarget({ row: target + 1, column: 1 });
      setNotice(
        `${parsed.cells.length.toLocaleString("id-ID")} baris dibaca dari ${file.name}${sheetLabel}` +
          `${parsed.headerDetected ? " (baris judul dikenali)" : " (tanpa baris judul)"}` +
          `${
            parsed.assumedColumns.length
              ? `. Kolom tanpa judul dibaca sebagai ${parsed.assumedColumns.join(", ")}`
              : ""
          }` +
          `${
            parsed.unknownColumns.length
              ? `. Kolom diabaikan: ${parsed.unknownColumns.join(", ")}`
              : ""
          }. Memvalidasi…`,
      );
      // Straight into the sheet: the grid IS the preview. A textarea of raw
      // TSV showed the file back to the person who chose it and told them
      // nothing — the problems only become visible once the rows are in the
      // columns, marked, with the assignees resolved.
      await applyRows({
        text: toClipboardText(parsed.cells),
        target: { row: target + 1, column: 1 },
        source: `${file.name}${sheetLabel}`,
        onStage: async (stage) => {
          setImportStage(
            stage,
            stage === "resolve"
              ? {
                  onCancel: () => pasteAbort.current?.abort(),
                  cancelLabel: "Batalkan impor",
                }
              : {},
          );
          await nextFrame();
        },
      });
    } catch (error) {
      setClipboard(null);
      failNotice(
        error instanceof Error ? error.message : "File impor tidak terbaca.",
      );
    }
  }
  function paste() {
    if (clipboard === null) return Promise.resolve();
    return applyRows({
      text: clipboard,
      target: pasteTarget,
      source: "",
    });
  }
  /**
   * Writes a block of rows into the sheet: normalise, resolve the assignees,
   * write, then mark whatever is wrong.
   *
   * Takes its input explicitly rather than reading the paste state, because a
   * file import applies in the same tick it is read — there is no preview step
   * to wait for, so there is no state to read yet.
   */
  async function applyRows({
    text,
    target: where,
    source,
    onStage,
  }: {
    text: string;
    target: { row: number; column: number };
    source: string;
    /** Import only: reports the slow steps to the progress modal. */
    onStage?: (stage: "resolve" | "write") => Promise<void>;
  }) {
    if (!control || !canEdit) return;
    setResolvingPaste(true);
    const controller = new AbortController();
    pasteAbort.current = controller;
    setNotice("Memvalidasi baris dan identitas karyawan…");
    try {
      await control.finish();
      const raw = parseClipboard(text);
      const parsed = normalizePastedCells(raw, where.column);
      const normalizedDates = raw.reduce(
        (count, row, rowIndex) =>
          count +
          row.reduce(
            (rowCount, value, columnIndex) =>
              rowCount + (value !== parsed[rowIndex]?.[columnIndex] ? 1 : 0),
            0,
          ),
        0,
      );
      const drafts = control.read();
      if (
        where.row + parsed.length - 1 > MAX_ROWS ||
        where.column + (parsed[0]?.length ?? 0) - 1 > 7
      )
        throw new Error(
          `Rentang melewati batas workspace (${MAX_ROWS.toLocaleString("id-ID")} baris / 7 kolom). Ubah tujuan; tidak ada data yang dipangkas.`,
        );
      // `read()` hanya mengembalikan baris yang pernah tersentuh. Menempel ke
      // baris kosong di luar jendela itu sah, jadi barisnya disiapkan di sini —
      // tanpa ini paste besar diam-diam cuma menulis sebagian.
      const needed = where.row - 1 + parsed.length;
      const proposed = Array.from(
        { length: Math.max(drafts.length, needed) },
        (_, index) => {
          const draft = drafts[index];
          return draft
            ? { ...draft, cells: [...draft.cells] }
            : { key: `pending-${index + 1}`, cells: Array<string>(7).fill("") };
        },
      );
      parsed.forEach((values, index) => {
        const target = proposed[where.row - 1 + index];
        if (target)
          values.forEach((value, col) => {
            target.cells[where.column - 1 + col] = value;
          });
      });
      const incoming = proposed.slice(
        where.row - 1,
        where.row - 1 + parsed.length,
      );
      await onStage?.("resolve");
      const { resolved, failed } = await resolveAssignees(
        incoming.map((item) => item.cells[3] ?? ""),
        controller.signal,
      );
      // One unknown assignee must not discard the whole sheet: the resolved
      // rows land in the draft and the failures are named, cell by cell, so
      // the admin fixes those instead of re-pasting everything.
      const lookupErrors: RowError[] = [];
      incoming.forEach((item, index) => {
        const value = item.cells[3] ?? "";
        const label = resolved.get(value);
        if (label) {
          item.cells[3] = label;
          return;
        }
        const message = failed.get(value);
        if (message)
          lookupErrors.push({
            row: where.row + index,
            field: columns[3],
            value,
            message,
          });
      });
      if (controller.signal.aborted) return;
      await onStage?.("write");
      control.writeRange(
        where.row,
        incoming.map((item) => item.cells),
      );
      const errors = mergeErrors(
        lookupErrors,
        validateRows(proposed, labels.current).errors,
      );
      if (errors.length) {
        setErrors(errors);
        setClipboard(null);
        if (source) setImportedUnsaved(true);
        failNotice(
          `${parsed.length.toLocaleString("id-ID")} baris ${source ? `dari ${source} ` : ""}masuk ke draft. ` +
            `${errors.length.toLocaleString("id-ID")} sel perlu diperbaiki sebelum disimpan — sel yang bermasalah ditandai merah di grid.`,
        );
        return;
      }
      setClipboard(null);
      setErrors([]);
      if (source) setImportedUnsaved(true);
      setNotice(
        `${parsed.length.toLocaleString("id-ID")} baris ${source ? `dari ${source} diimpor` : "ditempel"} ke draft.${
          normalizedDates
            ? ` ${normalizedDates} tanggal/jam diformat otomatis.`
            : ""
        } Klik Simpan perubahan untuk mengirim ke server.`,
      );
    } catch (error) {
      if (controller.signal.aborted) {
        setNotice(
          source
            ? "Impor dibatalkan. Draft tidak berubah."
            : "Paste dibatalkan. Draft tidak berubah.",
        );
        return;
      }
      failNotice(
        error instanceof Error ? error.message : "Clipboard tidak valid.",
      );
    } finally {
      setResolvingPaste(false);
    }
  }
  async function runBulkImport() {
    const target = bulkImport?.file;
    if (!target || !canEdit) return;

    const controller = new AbortController();
    bulkAbort.current = controller;
    setBulkImport((state) =>
      state ? { ...state, running: true, error: "", summary: null } : state,
    );

    let charsRead = 0;
    const size = Math.max(1, target.size);
    setImportProgress({
      fileName: target.name,
      stage: "upload",
      fraction: 0,
      onCancel: () => bulkAbort.current?.abort(),
      cancelLabel: "Hentikan impor",
    });
    // Counted as the stream is consumed, so the bar follows what has actually
    // been read and batched — not a timer.
    async function* counted() {
      for await (const chunk of fileTextChunks(target!)) {
        charsRead += chunk.length;
        yield chunk;
      }
    }

    try {
      const summary = await importProductionStream({
        chunks: counted(),
        signal: controller.signal,
        newKey: () => crypto.randomUUID(),
        send: (rows, key) => saveProduction({ key, rows }, csrfToken),
        onProgress: (progress) => {
          setBulkImport((state) => (state ? { ...state, progress } : state));
          setImportProgress((current) =>
            current
              ? {
                  ...current,
                  // Kept below 100% until the last batch has answered: the
                  // text is read ahead of what the server has accepted.
                  fraction: Math.min(0.99, charsRead / size),
                  detail: `${progress.rowsSent.toLocaleString("id-ID")} baris terkirim`,
                }
              : current,
          );
        },
      });

      setBulkImport((state) =>
        state ? { ...state, running: false, summary } : state,
      );
      // Sengaja TIDAK memuat ulang di sini: reload me-remount workspace dan
      // laporan baris ditolak ikut hilang sebelum sempat dibaca. Grid dimuat
      // ulang saat panel ditutup.
    } catch (error) {
      setBulkImport((state) =>
        state
          ? {
              ...state,
              running: false,
              error:
                error instanceof ImportAborted
                  ? error.message
                  : error instanceof Error
                    ? error.message
                    : "Impor gagal.",
            }
          : state,
      );
    } finally {
      bulkAbort.current = null;
      setImportProgress(null);
    }
  }

  function downloadRejections(summary: ImportSummary, name: string) {
    const blob = new Blob([rejectionReportCsv(summary.rejections)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name.replace(/\.[^.]+$/, "")}-ditolak.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function chooseEmployee(employee: Employee) {
    if (!control || !canEdit) return;
    const label = `${employee.fullName} · ${employee.pin}`;
    labels.current.set(label, employee.pin);
    const targetRow = assigneeAnchor?.row ?? status.active;
    const cells = control.readRow(targetRow)?.cells;
    if (cells) {
      const next = [...cells];
      next[3] = label;
      control.write(targetRow, next);
    }
    setAssigneeAnchor(null);
  }
  async function compare() {
    if (!row?.original) return;
    try {
      setComparison({
        local: row,
        server: await getProduction(row.original.id),
      });
    } catch (error) {
      failNotice(
        error instanceof Error
          ? error.message
          : "Versi server tidak dapat dimuat.",
      );
    }
  }
  async function openVoid() {
    if (!control || !canEdit) return;
    await control.finish();
    const selected = control.selected();
    if (selected.length !== 1) {
      setNotice("Pilih tepat satu baris tersimpan untuk dibatalkan.");
      return;
    }
    const original = selected[0]?.original;
    if (!original) {
      setNotice(
        "Baris baru belum tersimpan. Kosongkan baris tersebut jika tidak diperlukan.",
      );
      return;
    }
    setVoidError("");
    setVoidTarget(original);
  }
  async function submitVoid(reason: string) {
    if (!voidTarget || !canWrite || voidMutation.isPending) return;
    const pending = voidAttempt ?? {
      key: crypto.randomUUID(),
      productionEntryId: voidTarget.id,
      body: {
        expectedRowVersion: voidTarget.rowVersion,
        reason,
      },
    };
    setVoidAttempt(pending);
    setVoidError("");
    try {
      const result = await voidMutation.mutateAsync(pending);
      if (result.id !== voidTarget.id)
        throw new Error(
          "Respons pembatalan tidak cocok dengan baris yang dipilih.",
        );
      const machine = voidTarget.stationNo;
      setVoidAttempt(null);
      setVoidTarget(null);
      onReload(
        `Data mesin ${machine} berhasil dibatalkan dan tidak lagi masuk daftar aktif.`,
      );
    } catch (error) {
      setVoidError(
        `${error instanceof Error ? error.message : "Pembatalan gagal."} Data belum diubah di layar.`,
      );
      if (
        error instanceof ApiClientError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![408, 429].includes(error.status)
      )
        setVoidAttempt(null);
    }
  }
  return (
    <section className="manual-workspace" aria-labelledby="workspace-heading">
      {/*
        Grid and problem list side by side: the sheet never uses the full width
        of a desktop window, and the list belongs next to the rows it is about
        — not below a 15,000-row grid nobody will scroll past.
      */}
      <div className="manual-split">
        <div className="manual-split-grid">
          {/*
            The message for the row the cursor is on, right where the eye
            already is. A marked cell says something is wrong; this says what,
            without hunting for the row number in a list.
          */}
          {activeErrors.length > 0 && (
            <div className="manual-row-problem" role="status">
              <strong>Baris {gridRowLabel(status.active)}</strong>
              {activeErrors.map((error) => (
                <span key={`${error.field}-${error.message}`}>
                  <b>{error.field}</b>
                  {error.value ? ` "${error.value}"` : ""} — {error.message}
                </span>
              ))}
            </div>
          )}
          <div inert={busy} className="manual-grid-shell">
            <Suspense
              fallback={
                <p role="status" className="manual-notice">
                  Memuat engine spreadsheet…
                </p>
              }
            >
              <Grid
                entries={entries}
                names={names}
                editable={canWrite}
                onReady={setControl}
                onStatus={setStatus}
                onAssignee={requestAssignee}
                onDateCell={requestDateCell}
                onPaste={openPaste}
                onBlocked={failNotice}
                /*
                  Insert and delete are real spreadsheet actions here, so the
                  row numbers this page remembers move with the sheet. Without
                  this, "baris 9.115" in the problem list would point at
                  whatever slid into that position.
                */
                onRowsShifted={(from, delta) =>
                  setErrors((current) => shiftRows(current, from, delta))
                }
                onRowsRemoved={(rows) =>
                  setErrors((current) => removeRowsFrom(current, rows))
                }
              />
            </Suspense>
            {dateAnchor && canEdit && (
              <DateCellPicker
                // A different cell is a different popover: remounting drops the
                // previous cell's open state without a setState-in-effect.
                key={`${dateAnchor.row}:${dateAnchor.column}`}
                anchor={dateAnchor}
                onApply={applyDateCell}
                onDismiss={() => control?.select(dateAnchor.row)}
              />
            )}
            {assigneeAnchor && canEdit && (
              <div
                className="manual-assignee-popover"
                role="group"
                aria-label={`Pilih assignee baris ${gridRowLabel(assigneeAnchor.row)}`}
                style={{ left: assigneeAnchor.left, top: assigneeAnchor.top }}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget))
                    setAssigneeAnchor(null);
                }}
              >
                <EmployeePicker
                  onSelect={chooseEmployee}
                  focusRequest={focusRequest}
                  disabled={!canEdit || !control}
                  onDismiss={() => setAssigneeAnchor(null)}
                />
              </div>
            )}
          </div>
          <div className="manual-pagination">
            <span>
              Halaman {pageNumber} · {entries.length} baris dari server ·
              kapasitas draft {MAX_ROWS.toLocaleString("id-ID")}
            </span>
            <div>
              <select
                aria-label="Baris per halaman"
                className="manual-page-size"
                value={pageSize}
                disabled={busy}
                onChange={(event) => {
                  const size = Number(event.target.value);
                  void navigate(() => onPageSize(size));
                }}
              >
                {[100, 250, 500].map((size) => (
                  <option key={size} value={size}>
                    {size} / halaman
                  </option>
                ))}
              </select>
              <button
                className="manual-btn"
                disabled={!onPrevious || busy}
                onClick={() => navigate(onPrevious)}
              >
                Sebelumnya
              </button>
              <button
                className="manual-btn"
                disabled={!onNext || busy}
                onClick={() => navigate(onNext)}
              >
                Berikutnya
              </button>
            </div>
          </div>
        </div>
        <div className="manual-split-side">
          <div className="manual-side-controls">
            {controls}
            <div className="manual-workspace-heading">
              <h2 id="workspace-heading">Data produksi</h2>
              <p>
                {status.populated.toLocaleString("id-ID")} baris terisi ·{" "}
                {status.selected.toLocaleString("id-ID")} dipilih ·{" "}
                {status.dirty
                  ? "Ada draft belum disimpan"
                  : "Tidak ada perubahan"}
              </p>
              <button
                className="manual-btn manual-primary"
                aria-label="Simpan perubahan"
                disabled={!canEdit || !control}
                onClick={() => void save()}
              >
                Simpan
              </button>
            </div>
            {readOnlyReason && (
              <p role="status" className="manual-notice manual-readonly">
                {readOnlyReason}
              </p>
            )}
            {/*
              Feedback simpan duduk di atas grid, bukan di bawahnya. Grid mengisi
              seluruh viewport, jadi pesan di bawah grid berarti tombol Simpan
              terlihat seperti tidak melakukan apa-apa.
            */}
            <div
              // A failure is announced, not just displayed: `alert` interrupts a
              // screen reader, `status` waits its turn. Same reason it turns red.
              role={noticeFailed ? "alert" : "status"}
              className={
                noticeFailed
                  ? "manual-status manual-status-failed"
                  : "manual-status"
              }
            >
              {noticeFailed && (
                <span aria-hidden="true" className="manual-status-mark">
                  !
                </span>
              )}
              {notice}
            </div>
            {/*
              Three groups by what the action works on, each on its own line so
              a wrap never splits one family across rows: the rows in the
              grid, data coming in, and what the column below shows.
            */}
            <div className="manual-toolbar">
              <div
                className="manual-toolbar-group"
                role="group"
                aria-label="Baris"
              >
                <label className="manual-checkbox">
                  <input
                    type="checkbox"
                    aria-label="Pilih semua baris terisi di halaman ini"
                    checked={
                      status.populated > 0 &&
                      status.selected === status.populated
                    }
                    disabled={!control || busy}
                    onChange={(event) =>
                      control?.selectAll(event.target.checked)
                    }
                  />
                  Pilih semua
                </label>
                <button
                  className="manual-btn"
                  aria-label="Tambah baris"
                  disabled={!canEdit || !control}
                  onClick={() => {
                    const rows = control?.read() ?? [];
                    const empty = rows.findIndex(
                      (item) =>
                        !item.original && item.cells.every((cell) => !cell),
                    );
                    // `read()` hanya mengembalikan baris yang pernah tersentuh; kalau
                    // semuanya terisi, baris kosong berikutnya ada tepat sesudahnya.
                    const target = empty >= 0 ? empty + 1 : rows.length + 1;

                    if (target > MAX_ROWS) {
                      setNotice(
                        `Workspace penuh (${MAX_ROWS.toLocaleString("id-ID")} baris). Simpan lalu muat ulang.`,
                      );
                      return;
                    }
                    control?.select(target);
                    setNotice(`Isi baris ${target} di grid atau editor baris.`);
                  }}
                >
                  Tambah
                </button>
                <button
                  className="manual-btn"
                  aria-label={`Salin baris (${status.selected})`}
                  disabled={!status.selected}
                  onClick={() => void copyRows()}
                >
                  Salin
                </button>
                <button
                  className="manual-btn"
                  aria-label="Hapus baris"
                  title="Hapus baris draft terpilih. Data tersimpan harus dibatalkan agar histori audit tetap ada."
                  disabled={!canEdit || !control || status.selected === 0}
                  onClick={() => void removeRows()}
                >
                  Hapus
                </button>
                <button
                  className="manual-btn"
                  aria-label="Batalkan data"
                  title={
                    status.dirty
                      ? "Simpan atau buang draft sebelum membatalkan data."
                      : "Batalkan satu data tanpa menghapus histori audit."
                  }
                  disabled={
                    !canEdit ||
                    !control ||
                    status.selected !== 1 ||
                    status.dirty
                  }
                  onClick={() => void openVoid()}
                >
                  Batalkan
                </button>
              </div>
              <div
                className="manual-toolbar-group"
                role="group"
                aria-label="Data masuk"
              >
                <button
                  className="manual-btn"
                  aria-label="Tempel data"
                  disabled={!canEdit || !control}
                  onClick={() => openPaste("")}
                >
                  Tempel
                </button>
                <input
                  ref={importInput}
                  type="file"
                  accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,text/tab-separated-values"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    // Direset supaya memilih file yang sama dua kali tetap memicu
                    // onChange — kasus nyata setelah file diperbaiki di luar aplikasi.
                    event.target.value = "";
                    if (file) void importFile(file);
                  }}
                />
                <button
                  className="manual-btn"
                  aria-label="Impor file"
                  title="Impor Excel (.xlsx), CSV, TSV, atau TXT. Baris masuk sebagai draft dan masih bisa diperiksa sebelum disimpan."
                  disabled={!canEdit || !control}
                  onClick={() => importInput.current?.click()}
                >
                  Impor file
                </button>
                {/*
                  Beside the button that needs them. The links used to live only inside
                  the paste panel and the direct-to-server panel, so the ordinary
                  "Impor file" path never showed a template to anyone.
                */}
                {/* Petunjuk ada di sheet "Cara Pakai" di dalam file yang sama. */}
                <span className="manual-template-links">
                  <a href="/templates/manual-data-template.xlsx" download>
                    Template Excel
                  </a>
                </span>
              </div>
              <div
                className="manual-toolbar-group"
                role="group"
                aria-label="Tampilan"
              >
                <button
                  className="manual-btn"
                  type="button"
                  aria-expanded={showEditor}
                  aria-controls="manual-side-panel-editor"
                  disabled={importedUnsaved}
                  title={
                    importedUnsaved
                      ? "Editor baris tersedia lagi setelah hasil impor disimpan atau dibatalkan."
                      : undefined
                  }
                  onClick={() => {
                    setEditorOpen((open) => !open);
                    setSideTab("editor");
                  }}
                >
                  {showEditor ? "Tutup editor" : "Edit baris"}
                </button>
                {/*
                  Always available, unlike the row editor: looking an employee up is
                  exactly what an admin needs WHILE an unsaved import is still full of
                  unresolved EIDs, which is the one moment the editor is hidden.
                */}
                <button
                  className="manual-btn"
                  type="button"
                  aria-expanded={directoryOpen}
                  aria-controls="manual-side-panel-directory"
                  onClick={() => {
                    setDirectoryOpen(true);
                    setSideTab("directory");
                  }}
                >
                  Data karyawan
                </button>
                <button
                  className="manual-btn"
                  disabled={busy}
                  onClick={() => navigate(onReload)}
                >
                  Muat ulang
                </button>
              </div>
            </div>
            <details className="manual-guide">
              <summary>Cara mengisi</summary>
              <p>
                Klik sel Assignee untuk mencari nama, PIN, atau EID. Klik ikon
                kalender di sel Shift Start atau Shift End untuk memilih tanggal
                dan jam. Klik dua kali pada sel lain untuk mengubahnya. Gunakan
                Salin dan Tempel untuk banyak baris sekaligus. Shift dan mesin
                yang sudah tersimpan tidak dapat diubah.
              </p>
              <p>
                Untuk mengunggah banyak baris sekaligus, isi sheet Data di{" "}
                <a href="/templates/manual-data-template.xlsx" download>
                  template Excel
                </a>{" "}
                lalu impor file .xlsx itu langsung lewat Impor file. Kolom
                Assignee menerima PIN maupun EID. Urutannya: Shift Start, Shift
                End, Station, Assignee, Width, Weft, Result. Petunjuk lengkap
                ada di sheet Cara Pakai di file yang sama.
              </p>
            </details>
          </div>
          {tabbed && (
            <div
              className="manual-split-tabs"
              role="tablist"
              aria-label="Panel samping"
            >
              {sidePanels.map((panel) => (
                <button
                  key={panel.id}
                  type="button"
                  role="tab"
                  id={`manual-side-tab-${panel.id}`}
                  aria-selected={panel.id === activeSide}
                  aria-controls={`manual-side-panel-${panel.id}`}
                  onClick={() => setSideTab(panel.id)}
                >
                  {panel.label}
                </button>
              ))}
            </div>
          )}
          {directoryOpen && (
            <EmployeeDirectory
              onClose={() => setDirectoryOpen(false)}
              {...panelProps("directory")}
            />
          )}
          {errors.length > 0 && (
            <section
              id="manual-side-panel-errors"
              className="manual-errors"
              aria-label="Kesalahan validasi"
              {...panelProps("errors")}
            >
              {canEdit && (
                <p className="manual-hint">
                  Mengganti sebuah nilai menulis ulang semua baris yang isinya{" "}
                  <b>sama persis</b>. Untuk Assignee, tulis PIN atau EID —
                  namanya diisi otomatis.
                </p>
              )}
              <ul className="manual-error-groups">
                {errorGroups.map((group) => (
                  <li key={group.message}>
                    <p className="manual-error-cause">
                      <span>{group.message}</span>
                      <span className="manual-error-count">
                        {group.count.toLocaleString("id-ID")} sel
                      </span>
                    </p>
                    {group.values.length > 0 ? (
                      <ul className="manual-fix-list">
                        {group.values.map((item) => (
                          <li key={item.key}>
                            <div className="manual-fix-head">
                              <code>{item.value}</code>
                              <span className="manual-error-count">
                                {item.count.toLocaleString("id-ID")}
                              </span>
                              <button
                                type="button"
                                className="manual-link"
                                onClick={() => control?.select(item.firstRow)}
                              >
                                baris {gridRowLabel(item.firstRow)}
                              </button>
                              {canEdit && (
                                <button
                                  type="button"
                                  className="manual-link manual-danger"
                                  disabled={busy}
                                  onClick={() =>
                                    void removeProblemRows(
                                      (drafts) =>
                                        rowsWithValue(
                                          drafts,
                                          item.field,
                                          item.value,
                                        ),
                                      `berisi "${item.value}"`,
                                    )
                                  }
                                >
                                  Hapus
                                </button>
                              )}
                            </div>
                            {canEdit && (
                              <form
                                className="manual-fix-form"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  void applyBulkFix(
                                    item.field,
                                    item.value,
                                    fixes[item.key] ?? "",
                                  );
                                }}
                              >
                                {/*
                                    Only the Assignee column gets the search:
                                    the other fixable values are numbers
                                    (an ambiguous weft like "1,902"), and
                                    offering an employee list there would be
                                    noise at best.
                                  */}
                                {item.field === "Assignee" ? (
                                  <EmployeeCombobox
                                    value={fixes[item.key] ?? ""}
                                    label={`Pengganti untuk ${item.value}`}
                                    disabled={busy}
                                    onChange={(next) =>
                                      setFixes((current) => ({
                                        ...current,
                                        [item.key]: next,
                                      }))
                                    }
                                  />
                                ) : (
                                  <input
                                    value={fixes[item.key] ?? ""}
                                    aria-label={`Pengganti untuk ${item.value}`}
                                    placeholder="Ganti dengan…"
                                    disabled={busy}
                                    onChange={(event) =>
                                      setFixes((current) => ({
                                        ...current,
                                        [item.key]: event.target.value,
                                      }))
                                    }
                                  />
                                )}
                                <button
                                  className="manual-btn manual-primary"
                                  disabled={
                                    busy || !(fixes[item.key] ?? "").trim()
                                  }
                                >
                                  Terapkan
                                </button>
                              </form>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {/*
                        Always offered, values or not: "Result kosong" has no
                        value to match on, and deleting those six rows is the
                        only bulk action that makes sense for them.
                      */}
                    <p className="manual-group-actions">
                      <button
                        type="button"
                        className="manual-link"
                        onClick={() => control?.select(group.firstRow)}
                      >
                        Lompat ke baris {gridRowLabel(group.firstRow)}
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          className="manual-link manual-danger"
                          disabled={busy}
                          onClick={() =>
                            void removeProblemRows(
                              async () =>
                                (await resolveAndValidate())
                                  .filter(
                                    (error) => error.message === group.message,
                                  )
                                  .map((error) => error.row),
                              `dengan masalah "${group.message}"`,
                            )
                          }
                        >
                          Hapus {group.rows.size.toLocaleString("id-ID")} baris
                        </button>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {showEditor && (
            <section
              id="manual-side-panel-editor"
              className="manual-editor"
              aria-label="Editor baris"
              {...panelProps("editor")}
            >
              <div className="manual-toolbar">
                <h3>Editor baris</h3>
                <label>
                  Baris aktif
                  <input
                    aria-label="Baris aktif"
                    type="number"
                    min="2"
                    max={MAX_ROWS + 1}
                    value={status.active + 1}
                    disabled={!control || busy}
                    onChange={(event) =>
                      control?.select(Number(event.target.value) - 1)
                    }
                  />
                </label>
                <label className="manual-checkbox">
                  <input
                    type="checkbox"
                    aria-label="Pilih baris aktif"
                    checked={control?.isSelected(status.active) ?? false}
                    disabled={!control || busy}
                    onChange={(event) =>
                      control?.selectRow(status.active, event.target.checked)
                    }
                  />
                  Pilih baris ini
                </label>
              </div>
              <p className="manual-hint">
                Alternatif aksesibel untuk mengedit sel dan mencari karyawan.
                Perubahan masuk ke draft grid.
              </p>
              <div className="manual-editor-fields">
                {columns.map((label, index) => (
                  <label key={label}>
                    {label}
                    <input
                      aria-label={`Edit ${label}`}
                      type={index < 2 ? "datetime-local" : "text"}
                      step={index < 2 ? "1" : undefined}
                      inputMode={index > 3 ? "decimal" : undefined}
                      disabled={
                        !canEdit ||
                        !control ||
                        index === 3 ||
                        (Boolean(row?.original) && index < 3)
                      }
                      value={
                        index < 2
                          ? (row?.cells[index] ?? "").replace(" ", "T")
                          : (row?.cells[index] ?? "")
                      }
                      onChange={(event) => {
                        // Re-read the row instead of reusing the snapshot from the
                        // last render: status updates are rAF-debounced, so two
                        // quick edits (or an assignee pick followed by typing)
                        // would both write an outdated row and clobber each other.
                        const cells = control?.readRow(status.active)?.cells;
                        if (!cells) return;
                        const next = [...cells];
                        next[index] = event.target.value.replace("T", " ");
                        control?.write(status.active, next);
                      }}
                    />
                  </label>
                ))}
              </div>
              <EmployeePicker
                onSelect={chooseEmployee}
                focusRequest={0}
                disabled={!canEdit || !control}
              />
              <button
                className="manual-btn"
                disabled={!row?.original || busy}
                onClick={() => void compare()}
              >
                Bandingkan baris aktif dengan server
              </button>
            </section>
          )}
        </div>
      </div>
      {attempt && !mutation.isPending && (
        <div className="manual-error">
          Hasil simpan belum pasti. Editing ditahan agar retry memakai payload
          dan kunci yang sama.{" "}
          <button className="manual-btn" onClick={() => void save(attempt)}>
            Ulangi simpan yang sama
          </button>
        </div>
      )}
      {bulkImport && (
        <section className="manual-paste" aria-label="Impor langsung ke server">
          <h3>Impor langsung · {bulkImport.file.name}</h3>
          <p>
            {formatBytes(bulkImport.file.size)}. File ini dikirim ke server per{" "}
            {IMPORT_BATCH_ROWS.toLocaleString("id-ID")} baris tanpa melewati
            grid, jadi jumlah barisnya tidak dibatasi kapasitas workspace. Baris
            yang tidak valid dilewati dan dilaporkan; sisanya tetap masuk.{" "}
            <a href="/templates/manual-data-template.xlsx" download>
              Unduh template Excel
            </a>
          </p>
          {bulkImport.progress && (
            <p role="status">
              {bulkImport.progress.rowsRead.toLocaleString("id-ID")} baris
              dibaca · {bulkImport.progress.rowsSent.toLocaleString("id-ID")}{" "}
              terkirim dalam {bulkImport.progress.batches} batch ·{" "}
              {bulkImport.progress.inserted.toLocaleString("id-ID")} ditambahkan
              · {bulkImport.progress.updated.toLocaleString("id-ID")} diperbarui
              · {bulkImport.progress.rejected.toLocaleString("id-ID")} ditolak
            </p>
          )}
          {bulkImport.error && <p role="alert">{bulkImport.error}</p>}
          {bulkImport.summary && (
            <>
              <p role="status">
                Selesai. {bulkImport.summary.inserted.toLocaleString("id-ID")}{" "}
                ditambahkan ·{" "}
                {bulkImport.summary.updated.toLocaleString("id-ID")} diperbarui
                · {bulkImport.summary.unchanged.toLocaleString("id-ID")} tetap ·{" "}
                {bulkImport.summary.rejected.toLocaleString("id-ID")} ditolak
                dari {bulkImport.summary.rowsRead.toLocaleString("id-ID")}{" "}
                baris.
                {bulkImport.summary.unknownColumns.length
                  ? ` Kolom diabaikan: ${bulkImport.summary.unknownColumns.join(", ")}.`
                  : ""}
              </p>
              {bulkImport.summary.rejections.length > 0 && (
                <>
                  <ul className="manual-errors">
                    {bulkImport.summary.rejections.slice(0, 20).map((item) => (
                      <li key={`${item.row}-${item.field}-${item.message}`}>
                        Baris {gridRowLabel(item.row)} · {item.field}:{" "}
                        {item.message}
                      </li>
                    ))}
                  </ul>
                  <button
                    className="manual-btn"
                    onClick={() =>
                      downloadRejections(
                        bulkImport.summary!,
                        bulkImport.file.name,
                      )
                    }
                  >
                    Unduh laporan baris ditolak (
                    {bulkImport.summary.rejections.length.toLocaleString(
                      "id-ID",
                    )}
                    {bulkImport.summary.rejectionsTruncated ? "+" : ""})
                  </button>{" "}
                </>
              )}
            </>
          )}
          {!bulkImport.summary && (
            <button
              className="manual-btn manual-primary"
              disabled={!canEdit || bulkImport.running}
              onClick={() => void runBulkImport()}
            >
              {bulkImport.running ? "Mengimpor…" : "Kirim ke server"}
            </button>
          )}{" "}
          <button
            className="manual-btn"
            onClick={() => {
              if (bulkImport.running) {
                bulkAbort.current?.abort();
                return;
              }
              const imported = bulkImport.summary?.rowsSent ?? 0;
              setBulkImport(null);
              // Baris yang baru masuk harus terlihat sebagai data tersimpan,
              // bukan draft — itu baru benar setelah dimuat ulang dari server.
              if (imported > 0) navigate(onReload);
            }}
          >
            {bulkImport.running ? "Hentikan" : "Tutup"}
          </button>
        </section>
      )}
      {clipboard !== null && (
        <section className="manual-paste" aria-label="Preview clipboard">
          {/*
            Paste keeps this step; a file import no longer has one. Pasting a
            block into the middle of an existing sheet needs a target row and
            column, and getting that wrong overwrites somebody's saved work. A
            file import always starts at the first empty draft row, so there is
            nothing to choose and nothing worth pausing for.
          */}
          <h3>Preview paste</h3>
          <p>
            Urutan: Shift Start, Shift End, Station, PIN, Width, Weft, Result.
            Format waktu YYYY-MM-DD HH:mm; serial tanggal dari spreadsheet akan
            dirapikan otomatis. Desimal memakai titik. Maksimal{" "}
            {MAX_ROWS.toLocaleString("id-ID")} baris; lebih dari itu pakai Impor
            file, yang langsung masuk ke grid.{" "}
            <a href="/templates/manual-data-template.xlsx" download>
              Unduh template Excel
            </a>
          </p>
          <div className="manual-toolbar">
            <label>
              Baris tujuan
              <input
                type="number"
                min="1"
                max={MAX_ROWS}
                value={pasteTarget.row}
                onChange={(event) =>
                  setPasteTarget({
                    ...pasteTarget,
                    row: Math.min(
                      MAX_ROWS,
                      Math.max(1, Number(event.target.value)),
                    ),
                  })
                }
              />
            </label>
            <label>
              Kolom awal
              <select
                value={pasteTarget.column}
                onChange={(event) =>
                  setPasteTarget({
                    ...pasteTarget,
                    column: Number(event.target.value),
                  })
                }
              >
                {columns.map((label, index) => (
                  <option key={label} value={index + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Isi clipboard (TSV)
            <textarea
              value={clipboard}
              onChange={(event) => setClipboard(event.target.value)}
              rows={6}
            />
          </label>
          <button
            className="manual-btn manual-primary"
            disabled={!canEdit}
            onClick={() => void paste()}
          >
            Validasi & terapkan ke draft
          </button>{" "}
          <button
            className="manual-btn"
            onClick={() => {
              pasteAbort.current?.abort();
              setClipboard(null);
              setErrors([]);
            }}
          >
            Batal paste
          </button>
        </section>
      )}
      {comparison && (
        <section className="manual-errors" aria-label="Perbandingan versi">
          <h3>Draft lokal vs versi server ({comparison.server.rowVersion})</h3>
          <p>
            Perbandingan tidak menimpa draft. Salin pekerjaan yang perlu
            dipertahankan sebelum memuat ulang.
          </p>
          <div className="manual-error-list">
            <table>
              <thead>
                <tr>
                  <th>Kolom</th>
                  <th>Draft lokal</th>
                  <th>Server</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((label, index) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td>{comparison.local.cells[index]}</td>
                    <td>
                      {
                        entryCells(
                          comparison.server,
                          names.get(comparison.server.pin),
                        )[index]
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="manual-btn" onClick={() => setComparison(null)}>
            Tutup perbandingan
          </button>
        </section>
      )}
      <ImportProgressDialog state={importProgress} />
      <VoidProductionDialog
        entry={voidTarget}
        employeeName={
          voidTarget
            ? (names.get(voidTarget.pin) ?? voidTarget.pin)
            : "Karyawan"
        }
        pending={voidMutation.isPending}
        mustRetry={voidAttempt !== null && !voidMutation.isPending}
        error={voidError}
        onCancel={() => {
          setVoidTarget(null);
          setVoidAttempt(null);
          setVoidError("");
        }}
        onConfirm={(reason) => void submitVoid(reason)}
      />
    </section>
  );
}

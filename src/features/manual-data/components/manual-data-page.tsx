import { useToast } from "../../../components/toast/use-toast";
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
  BatchResponseShapeError,
  PartialSaveError,
  closePeriod,
  updatePeriod,
  createPeriod,
  getEmployee,
  lookupEmployees,
  getProduction,
  listPeriods,
  listProduction,
  patchProduction,
  periodRange,
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
  ASSIGNEE_INVALID_MESSAGE,
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
  uniqueKeyOf,
  DUPLICATE_KEY_MESSAGE,
  type Baseline,
  type DraftRow,
  type Entry,
  type Employee,
  type RowError,
  ROW_FIELD,
  serverFieldColumn,
} from "../model/rows";
import {
  periodWarning,
  periodWarningMessage,
  rowsOutsideBook,
  suggestNextPeriod,
  type PeriodDraft,
} from "../model/period-book";
import { readLastPeriod, writeLastPeriod } from "../model/last-period";
import { isXlsxFile } from "../model/xlsx-file";
import { removeRowsFrom, shiftRows } from "../model/row-structure";
import {
  EmptyState,
  GhostTable,
} from "../../../components/empty-state/empty-state";
import { AssigneeCellTrigger } from "./assignee-cell-trigger";
import { DateCellPicker } from "./date-cell-picker";
import { EmployeeCombobox } from "./employee-combobox";
import { EmployeeDirectory } from "./employee-directory";
import { EmployeePicker } from "./employee-picker";
import type {
  AssigneeEditorAnchor,
  CellAnchor,
  EditedRows,
  GridControl,
  GridStatus,
} from "./univer-grid";
import { VoidProductionDialog } from "./void-production-dialog";
import {
  ClosePeriodDialog,
  CreatePeriodDialog,
  EditPeriodDialog,
} from "./period-book-dialogs";
import { ToolbarMenu } from "./toolbar-menu";
import {
  ImportProgressDialog,
  type ImportProgressState,
  type ImportStage,
} from "./import-progress-dialog";
import {
  GridSkeleton,
  WorkspaceSkeleton,
  type LoadStage,
} from "./workspace-skeleton";
import { SaveProgress, type SaveRun } from "./save-progress";
import { formatSaveTime } from "../model/save-time";
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

/**
 * Rows handled per slice of a long paste or import, between yields to the
 * browser. Measured: one 100.000-row paste done in a single task blocked the
 * tab for 4,4 s; at 5.000 rows a slice of validation or reading stays within
 * a few tens of milliseconds.
 */
const SLICE_ROWS = 5_000;

/**
 * Gives the browser a turn between slices: input, paint, the progress bar.
 * `scheduler.yield` where the browser has it, otherwise a message-channel
 * task — not `setTimeout(0)`, which nested calls clamp to 4 ms each.
 */
function yieldToMain(): Promise<void> {
  const scheduler: { yield?: () => Promise<void> } | undefined = Reflect.get(
    globalThis,
    "scheduler",
  );
  if (typeof scheduler?.yield === "function") return scheduler.yield();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
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

/**
 * The save receipt's "first rejected row" after rows moved under it, so its
 * jump button keeps pointing at the row that was rejected.
 */
function moveRejectedRow(
  run: SaveRun | null,
  move: (rows: { row: number }[]) => { row: number }[],
): SaveRun | null {
  if (run?.phase !== "done" || run.firstRejectedRow === null) return run;
  const row = move([{ row: run.firstRejectedRow }])[0]?.row ?? null;
  return row === run.firstRejectedRow ? run : { ...run, firstRejectedRow: row };
}

/**
 * Whether a failed write may still have been applied — the request has to
 * be repeated with the same key, never re-sent as a new one.
 *
 * Network failures and 5xx, 408 and 429 never said no. IMPORT_IN_PROGRESS is
 * a 409 that means "still running", not "refused". A response that answered
 * but broke the contract is definitive: replaying the key replays the same
 * broken body.
 */
function isUnknownOutcome(error: unknown) {
  if (error instanceof BatchResponseShapeError) return false;
  if (!(error instanceof ApiClientError)) return true;
  if (error.code === "IMPORT_IN_PROGRESS") return true;
  return error.status >= 500 || [408, 429].includes(error.status);
}

/** Stable empty list, so a row without problems never looks "changed". */
const NO_ERRORS: readonly RowError[] = [];

/**
 * Distinct values listed under one cause, most frequent first. 10.000
 * different bad timestamps rendered 10.000 fix forms; past the first few
 * the list stops being a tool and is only paint.
 */
const FIX_VALUES_SHOWN = 20;

/**
 * Above this many edited rows a prune re-validates the whole sheet in one
 * pass instead of row by row (a fill or a cleared column).
 */
const PRUNE_ROWS_ONE_BY_ONE = 2_000;

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
  const toast = useToast();
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
  /*
    Buku turunan DIPAKU begitu terpilih. Tanpa itu, "Buat buku" yang
    menyegarkan daftar bisa membuat turunannya pindah ke buku baru yang
    mencakup hari ini — kunci Workspace berubah, grid di-remount, dan draft
    yang belum disimpan hilang tanpa satu pertanyaan pun. Disetel saat render
    (bukan effect) supaya tidak ada satu render pun dengan buku yang salah.
    Tidak ditulis ke ingatan "buku terakhir": itu hanya untuk pilihan user.
  */
  if (selectedPeriod && periodId !== selectedPeriod.id)
    setPeriodId(selectedPeriod.id);
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
    // Dibuang begitu tidak ada yang menampilkannya. `generation` mulai dari 0
    // lagi setiap halaman ini dibuka, jadi kunci ["production", buku, 0] yang
    // tersisa di cache adalah isi server SEBELUM Simpan: admin menyimpan,
    // pindah ke Detail, kembali, dan grid kosong sampai halaman di-refresh.
    // Staleness tak terbatas tetap berlaku selama halaman terbuka — grid yang
    // sedang diedit tidak boleh tergantikan diam-diam oleh refetch.
    gcTime: 0,
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
  const [editTarget, setEditTarget] = useState<PayrollPeriod | null>(null);
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
        toast({
          tone: "info",
          title: `Buku ${created.code} dibuat`,
          message: "Simpan draft dulu, lalu pilih bukunya dari daftar.",
        });
      } else {
        openPeriod(created.id);
        setCursors([]);
        toast({ message: `Buku ${created.code} dibuat dan dibuka.` });
      }
    },
  });
  const editBook = useMutation({
    mutationFn: ({
      period,
      draft,
    }: {
      period: PayrollPeriod;
      draft: PeriodDraft;
    }) =>
      updatePeriod(
        period.id,
        { expectedRowVersion: period.rowVersion, ...draft },
        csrfToken,
      ),
    onSuccess: async (updated) => {
      setEditTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["payroll-periods"] });
      toast({
        title: `Buku ${updated.code} diperbarui`,
        message: `Rentang ${periodRangeLabel(updated.periodStart, updated.periodEnd)}.`,
      });
    },
    onError: (error) => {
      // Versi di layar sudah usang: segarkan daftar supaya percobaan
      // berikutnya memakai versi terbaru, bukan menimpa perubahan orang lain.
      if (
        error instanceof ApiClientError &&
        error.code === "ROW_VERSION_CONFLICT"
      )
        void queryClient.invalidateQueries({ queryKey: ["payroll-periods"] });
    },
  });
  const closeBook = useMutation({
    mutationFn: (period: PayrollPeriod) => closePeriod(period.id, csrfToken),
    onSuccess: async (closed) => {
      setCloseTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["payroll-periods"] });
      toast({ message: `Buku ${closed.code} sudah ditutup.` });
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
            // One PIN HRIS cannot answer for (resigned, not synced, a
            // timeout) must not hold the whole workspace hostage: that row
            // shows its raw PIN — `entryCells` falls back to it — and still
            // saves, because the server resolves PINs itself.
            try {
              const employee = await queryClient.fetchQuery({
                queryKey: ["employee", pin],
                queryFn: () => getEmployee(pin, signal),
                staleTime: 300_000,
              });
              names.set(pin, `${employee.fullName} · ${pin}`);
            } catch (error) {
              if (signal.aborted) throw error;
            }
          }
        }),
      );
      return names;
    },
  });
  const workspaceShown = Boolean(production.data && employees.data);
  const noBooks = periods.isSuccess && (periods.data?.data.length ?? 0) === 0;
  /** Tahap yang sedang ditunggu sebelum grid bisa tampil; null = tidak memuat. */
  const loadStage: LoadStage | null = periods.isPending
    ? "periods"
    : activeFilter !== null && production.isPending
      ? "production"
      : production.isSuccess && employees.isPending
        ? "employees"
        : null;
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
              {canCreateBook && selectedPeriod?.status === "OPEN" && (
                <button
                  type="button"
                  className="manual-btn"
                  // Rentang baru memuat ulang grid; draft yang belum disimpan
                  // akan hilang bersama rentang lama.
                  disabled={navigationState.busy || navigationState.dirty}
                  title={
                    navigationState.dirty
                      ? "Simpan atau batalkan draft dulu sebelum mengubah buku."
                      : undefined
                  }
                  onClick={() => {
                    editBook.reset();
                    setEditTarget(selectedPeriod);
                  }}
                >
                  Ubah buku
                </button>
              )}
              {canCloseBook && selectedPeriod?.status === "OPEN" && (
                <button
                  type="button"
                  // Set apart from Buat/Ubah: closing a book cannot be undone.
                  className="manual-btn manual-danger-quiet manual-period-close"
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
        {/* Tanpa buku, pemilih kosong dan kolom cari tidak punya apa pun
            untuk dicari; satu-satunya langkah ada di empty state di bawah. */}
        {!workspaceShown && !loadStage && !noBooks && pageControls}
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
      <EditPeriodDialog
        period={editTarget}
        pending={editBook.isPending}
        error={editBook.error ? periodErrorMessage(editBook.error) : ""}
        onCancel={() => setEditTarget(null)}
        onConfirm={(draft) =>
          editTarget && editBook.mutate({ period: editTarget, draft })
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
      {noBooks && (
        <EmptyState
          id="manual-first-book"
          icon="book"
          title="Belum ada buku periode"
          description="Produksi dicatat per buku periode; sebelum ada buku tidak ada baris yang bisa dimuat atau disimpan."
          action={
            canCreateBook ? (
              <button
                type="button"
                className="empty-state-primary"
                onClick={openCreate}
              >
                Buat buku pertama
              </button>
            ) : (
              <span className="empty-state-note">
                Minta HRD membuat periodenya dulu.
              </span>
            )
          }
          // The sheet it will become: row numbers down the side and the
          // real column titles along the top.
          backdrop={
            <GhostTable
              columns={[4, 16, 16, 6, 20, 8, 8, 8]}
              head={["Pilih", ...columns]}
              gutter
              rows={24}
            />
          }
          fill
        />
      )}
      {bookWarning && (
        <p role="status" className="manual-period-warning">
          {periodWarningMessage(bookWarning)}
        </p>
      )}
      {loadStage && (
        <WorkspaceSkeleton stage={loadStage} controls={pageControls} />
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
          book={selectedPeriod}
          entries={production.data.data}
          names={employees.data}
          canWrite={canWrite && !periodClosed}
          readOnlyReason={readOnlyReason}
          csrfToken={csrfToken}
          onNavigationState={setNavigationState}
          onReload={(message) => {
            if (message) toast({ message });
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
  if (error.code === "ROW_VERSION_CONFLICT")
    return "Buku ini baru saja diubah pengguna lain. Tutup dialog ini lalu buka Ubah buku lagi untuk melihat versi terbaru.";
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
type SideTab = "errors" | "directory" | "editor" | "paste";

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
  /** Buku yang sedang dibuka; baris bertanggal di luarnya diberi tanda kuning. */
  book: PayrollPeriod | null;
}
function Workspace({
  book,
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
  /**
   * Impor file terakhir yang belum disimpan, cukup untuk mengembalikan rentang
   * yang ditimpanya. Impor menulis mulai baris draft kosong pertama, tapi
   * rentangnya bisa melewati baris yang sudah berisi (draft atau tersimpan),
   * jadi yang dicatat adalah isi SEBELUM impor, bukan sekadar "hapus baris".
   * Dibuang begitu posisinya tidak lagi bisa dipercaya: baris disisipkan atau
   * dihapus di atas/di dalam rentang, atau draft sudah disimpan semua.
   */
  const [lastImport, setLastImport] = useState<ImportUndo | null>(null);
  /** Replacement typed for each distinct bad value, keyed by column + value. */
  const [fixes, setFixes] = useState<Record<string, string>>({});
  const [assigneeAnchor, setAssigneeAnchor] =
    useState<AssigneeEditorAnchor | null>(null);
  const [cellAnchor, setCellAnchor] = useState<CellAnchor | null>(null);
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
  /**
   * A failure that is about the red cells, worded from how many are left.
   *
   * "1 sel perlu diperbaiki" used to be frozen text: the admin fixed the cell,
   * the red mark and the problem list went, and the banner kept shouting. Tied
   * to the live error count, it counts down with each fix and turns into the
   * next step once none are left.
   */
  const [cellNotice, setCellNotice] = useState<{
    build: (count: number) => string;
    /**
     * `info`: rows landed and only some cells need work (an import, a paste)
     * — said plainly, with the count in the "perlu diperbaiki" strip below.
     * `danger`: something was refused (Simpan) and nothing was sent.
     */
    tone: "info" | "danger";
  } | null>(null);
  /**
   * The save in progress, or the receipt of the last one. It takes the
   * notice's place: any other message replaces it, the same as any message
   * replaces the one before.
   */
  const [saveRun, setSaveRun] = useState<SaveRun | null>(null);
  /** When the last Simpan landed, for the draft status once nothing is pending. */
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const setNotice = (message: string) => {
    setNoticeText(message);
    setNoticeFailed(false);
    setCellNotice(null);
    setSaveRun(null);
  };
  const failNotice = (message: string) => {
    setNoticeText(message);
    setNoticeFailed(true);
    setCellNotice(null);
    setSaveRun(null);
  };
  const failCellNotice = (
    build: (count: number) => string,
    tone: "info" | "danger" = "danger",
  ) => {
    setNoticeText("");
    setNoticeFailed(tone === "danger");
    setCellNotice({ build, tone });
    setSaveRun(null);
  };
  const showSaveRun = (run: SaveRun) => {
    setNotice("");
    setSaveRun(run);
  };
  const [errors, setErrors] = useState<RowError[]>([]);
  /**
   * Rows whose Shift Start falls outside the open book. A warning, not an
   * error: the server books each row by its own date, so these save into the
   * book that covers them — or are refused when none is open. Either way the
   * admin should see it before Simpan, since a mistyped month otherwise looks
   * like ordinary data.
   */
  const [outside, setOutside] = useState<{ row: number; date: string }[]>([]);
  /** Replaces the list, keeping the same array when nothing moved. */
  const showOutside = useCallback(
    (next: { row: number; date: string }[]) =>
      setOutside((current) =>
        current.length === next.length &&
        current.every(
          (item, index) =>
            item.row === next[index]!.row && item.date === next[index]!.date,
        )
          ? current
          : next,
      ),
    [],
  );
  const refreshOutside = useCallback(() => {
    if (!control || !book) return;
    showOutside(rowsOutsideBook(control.read(), book));
  }, [control, book, showOutside]);
  useEffect(refreshOutside, [refreshOutside]);
  /**
   * Re-checks only these sheet rows. A typed cell used to re-read all
   * 100.000 rows for this one warning.
   */
  function refreshOutsideRows(rows: readonly number[]) {
    if (!control || !book || !rows.length) return;
    const edited = new Set(rows);
    const found = rows.flatMap((sheetRow) => {
      const draft = control.readRow(sheetRow);
      return draft
        ? rowsOutsideBook([draft], book).map((item) => ({
            ...item,
            row: sheetRow,
          }))
        : [];
    });
    setOutside((current) => {
      const kept = current.filter((item) => !edited.has(item.row));
      if (kept.length === current.length && !found.length) return current;
      return [...kept, ...found].sort((a, b) => a.row - b.row);
    });
  }
  const shownNotice = cellNotice
    ? errors.length
      ? cellNotice.build(errors.length)
      : "Semua sel yang bermasalah sudah diperbaiki. Klik Simpan untuk mengirim ke server."
    : notice;
  const shownFailed = cellNotice
    ? cellNotice.tone === "danger" && errors.length > 0
    : noticeFailed;
  const [clipboard, setClipboard] = useState<string | null>(null);
  /** Nama file ketika isi preview datang dari impor, bukan dari clipboard. */
  const importInput = useRef<HTMLInputElement>(null);
  /** Impor langsung ke server untuk file yang tidak muat di workspace. */
  const [bulkImport, setBulkImport] = useState<{
    file: File;
    /**
     * Satu kunci per file yang dipilih, dipakai ulang oleh setiap "Mulai"
     * berikutnya: batch yang sudah tersimpan diputar ulang server, bukan
     * ditulis dua kali (`importProductionStream` menurunkan kunci batch).
     */
    key: string;
    running: boolean;
    progress: ImportProgress | null;
    summary: ImportSummary | null;
    error: string;
  } | null>(null);
  const bulkAbort = useRef<AbortController | null>(null);
  const [pasteTarget, setPasteTarget] = useState({ row: 1, column: 1 });
  /** "Tambah [1000] baris lagi di bawah", as in a spreadsheet. */
  const [addRowCount, setAddRowCount] = useState(1000);
  /** Simpan is sending the saved rows whose shift moved, one PATCH each. */
  const [movingShifts, setMovingShifts] = useState(false);
  const pastePanel = useRef<HTMLElement>(null);
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
        setSaveRun((run) =>
          run?.phase === "running"
            ? { ...run, step: "send", sent, total }
            : run,
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
  const saving = saveRun?.phase === "running";
  // `saving` covers the check before anything is sent: the HRIS lookup writes
  // the resolved names back into the sheet, and an edit typed meanwhile would
  // race it.
  const busy =
    saving ||
    mutation.isPending ||
    attempt !== null ||
    resolvingPaste ||
    voidMutation.isPending ||
    voidAttempt !== null ||
    movingShifts;
  const canEdit = canWrite && !busy;
  const draftState = status.dirty
    ? "Ada draft belum disimpan"
    : saving
      ? "Menyimpan…"
      : lastSavedAt
        ? `Tersimpan pukul ${formatSaveTime(lastSavedAt)}`
        : "Tidak ada perubahan";
  useEffect(() => {
    onNavigationState({ dirty: status.dirty, busy });
  }, [status.dirty, busy, onNavigationState]);
  const requestAssignee = useCallback((anchor: AssigneeEditorAnchor | null) => {
    setAssigneeAnchor(anchor);
    if (anchor) setFocusRequest((value) => value + 1);
  }, []);
  const gridShell = useRef<HTMLDivElement>(null);
  /**
   * The list opened from the in-cell button hangs under that cell, its right
   * edge on the button — kept inside the grid so it never runs off the pane.
   */
  function assigneeBelow(anchor: CellAnchor): AssigneeEditorAnchor {
    const width = gridShell.current?.clientWidth ?? 0;
    const height = gridShell.current?.clientHeight ?? 0;
    const popoverWidth = 356;
    const popoverHeight = 320;
    const below = anchor.top + anchor.height + 4;
    return {
      row: anchor.row,
      left: Math.max(
        4,
        Math.min(anchor.left - popoverWidth, width - popoverWidth),
      ),
      top:
        height && below + popoverHeight > height
          ? Math.max(4, anchor.top - popoverHeight - 4)
          : below,
    };
  }
  const requestCellTrigger = useCallback(
    (anchor: CellAnchor | null) => setCellAnchor(anchor),
    [],
  );
  /**
   * Writes the picked timestamp back through the same path the row editor
   * uses: re-read the row first, because the grid's status updates are
   * rAF-debounced and a stale snapshot would clobber a neighbouring edit.
   */
  function applyDateCell(value: string) {
    if (!control || !cellAnchor || !canEdit) return;
    const cells = control.readRow(cellAnchor.row)?.cells;
    if (!cells) return;
    const next = [...cells];
    next[cellAnchor.column - 1] = value;
    control.write(cellAnchor.row, next);
    setCellAnchor({ ...cellAnchor, value });
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
      outside.map((item) => ({ row: item.row, column: 1 })),
    );
  }, [control, errors, outside]);
  useEffect(() => {
    if (status.dirty) return;
    setImportedUnsaved(false);
    setLastImport(null);
  }, [status.dirty]);
  const showEditor = editorOpen && !importedUnsaved;
  /**
   * The problems per row. Every derivation below used to be recomputed from
   * the whole list on each render — and the status line re-renders the page
   * on every cursor move: with 10.000 problems that was a scan of all of
   * them per arrow key. Now it is one pass per change of the list.
   */
  const errorsByRow = useMemo(() => {
    const byRow = new Map<number, RowError[]>();
    for (const error of errors) {
      const list = byRow.get(error.row);
      if (list) list.push(error);
      else byRow.set(error.row, [error]);
    }
    return byRow;
  }, [errors]);
  const activeErrors = errorsByRow.get(status.active) ?? NO_ERRORS;
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
    /** Column of the first error with this cause, to name it in the list. */
    field: string;
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
    ...(clipboard !== null
      ? [{ id: "paste" as const, label: "Preview paste" }]
      : []),
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
  const errorGroups = useMemo(
    () =>
      [
        ...errors
          .reduce((groups, error) => {
            const found = groups.get(error.message) ?? {
              message: error.message,
              field: error.field,
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
        .sort((a, b) => b.count - a.count),
    [errors],
  );
  const row = control?.readRow(status.active);
  /** Rows with at least one problem, in sheet order, for ‹ › stepping. */
  const errorRows = useMemo(
    () => [...errorsByRow.keys()].sort((a, b) => a - b),
    [errorsByRow],
  );
  const [errorCursor, setErrorCursor] = useState(0);
  const cursorAt = Math.min(errorCursor, Math.max(0, errorRows.length - 1));
  const cursorRow = errorRows[cursorAt];
  const cursorError =
    cursorRow === undefined ? undefined : errorsByRow.get(cursorRow)?.[0];
  const stepError = (delta: number) => {
    if (!errorRows.length) return;
    const next = (cursorAt + delta + errorRows.length) % errorRows.length;
    setErrorCursor(next);
    const target = errorRows[next];
    if (target !== undefined) control?.select(target);
  };
  /** "ST 51 · Operator Contoh · 8954": who to ask about a row. */
  const rowContext = (sheetRow: number) => {
    const cells = control?.readRow(sheetRow)?.cells;
    if (!cells) return "";
    return [cells[2] ? `ST ${cells[2]}` : "", cells[3] ?? ""]
      .filter(Boolean)
      .join(" · ");
  };
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
    // A set, not `some` per error: two 10.000-error lists were a hundred
    // million comparisons.
    const taken = new Set(
      specific.map((found) => `${found.row}|${found.field}`),
    );
    return [
      ...specific,
      ...generic.filter((error) => !taken.has(`${error.row}|${error.field}`)),
    ];
  }
  /**
   * Drops the problems an edit has fixed, a moment after the typing stops —
   * the red cell and its line in the problem list go as soon as the value is
   * right, not at the next Simpan.
   *
   * Only ever REMOVES: a half-typed value is not a problem worth shouting
   * about, and new problems keep surfacing where they always have, at Simpan.
   * Local rules are re-run for the whole sheet because some span rows — a
   * duplicate shift is fixed by editing the OTHER row. An HRIS lookup failure
   * cannot be re-checked locally, so it stays while its cell still holds the
   * value that failed.
   */
  const pruneTimer = useRef(0);
  /**
   * Sheet rows edited since the last prune; `all` after a change that moved
   * rows around, or touched too many to be worth re-checking one by one.
   */
  const pendingEdits = useRef<{ all: boolean; rows: Set<number> }>({
    all: false,
    rows: new Set(),
  });
  /**
   * Every row's unique key and the rows holding each key, kept between
   * prunes so a duplicate can be re-checked from the edited rows alone. Only
   * built when a duplicate is actually on the list; dropped whenever rows
   * move or an edit goes unrecorded, and rebuilt on the next need.
   */
  const keyIndex = useRef<{
    keys: (string | null)[];
    buckets: Map<string, number[]>;
  } | null>(null);
  /** The list the last render showed; the prune works from it, not inside a state updater. */
  const errorsRef = useRef(errors);
  useEffect(() => {
    errorsRef.current = errors;
  }, [errors]);
  // A remounted sheet (Simpan, Muat ulang) holds other rows.
  useEffect(() => {
    keyIndex.current = null;
  }, [control]);
  function scheduleErrorPrune(rows?: readonly EditedRows[]) {
    const pending = pendingEdits.current;
    if (!rows) pending.all = true;
    else
      for (const range of rows) {
        if (
          pending.all ||
          range.end - range.start + 1 > PRUNE_ROWS_ONE_BY_ONE
        ) {
          pending.all = true;
          break;
        }
        for (let row = range.start; row <= range.end; row++)
          pending.rows.add(row);
      }
    if (pending.rows.size > PRUNE_ROWS_ONE_BY_ONE) pending.all = true;
    window.clearTimeout(pruneTimer.current);
    pruneTimer.current = window.setTimeout(pruneFixedErrors, 250);
  }
  useEffect(() => () => window.clearTimeout(pruneTimer.current), []);
  /** Rows → their bucket, built from one read of the sheet. */
  function buildKeyIndex(drafts: readonly DraftRow[]) {
    const keys = drafts.map((draft) => uniqueKeyOf(draft.cells));
    const buckets = new Map<string, number[]>();
    keys.forEach((key, index) => {
      if (!key) return;
      const rows = buckets.get(key);
      if (rows) rows.push(index + 1);
      else buckets.set(key, [index + 1]);
    });
    return { keys, buckets };
  }
  /**
   * What the prune keeps of `current`, given the fresh local result for the
   * rows it re-checked (`checked`; every row when omitted).
   */
  function keepUnfixed(
    current: RowError[],
    fresh: ReadonlyMap<string, RowError>,
    cellAt: (row: number, column: number) => string,
    checked?: ReadonlySet<number>,
  ) {
    const next = current.flatMap((error) => {
      if (checked && !checked.has(error.row)) return [error];
      const now = fresh.get(`${error.row}|${error.field}`);
      const column = (columns as readonly string[]).indexOf(error.field);
      // A server rejection names fields the grid has no column for; only
      // the next Simpan can say whether it still stands.
      if (column < 0) return [error];
      const value = cellAt(error.row, column).trim();
      // The validator cannot see an HRIS failure; the cell still holding
      // the value that failed means it still fails.
      const lookupFailure =
        column === 3 && error.message !== ASSIGNEE_INVALID_MESSAGE;
      if ((lookupFailure || error.server) && value === error.value.trim())
        return [error];
      if (!now) return [];
      // Same problem, same object: no re-render while nothing changed.
      return [now.message === error.message ? error : now];
    });
    const unchanged =
      next.length === current.length &&
      next.every((error, index) => error === current[index]);
    return unchanged ? current : next;
  }
  /**
   * Re-checks only the edited rows that carry a problem, plus — when a
   * duplicate is on the list — the rows sharing a key with an edited row.
   * Measured at 100.000 rows, the full validate + read it replaces was most
   * of a 450-700 ms freeze after each typed cell.
   */
  function pruneEditedRows(current: RowError[], edited: ReadonlySet<number>) {
    if (!control) return current;
    const cells = new Map<number, DraftRow | undefined>();
    const draftAt = (row: number) => {
      if (!cells.has(row)) cells.set(row, control.readRow(row));
      return cells.get(row);
    };
    const checked = new Set(
      current
        .filter((error) => edited.has(error.row))
        .map((error) => error.row),
    );
    const duplicates =
      current.some((error) => error.message === DUPLICATE_KEY_MESSAGE) ||
      current.some(
        (error) => checked.has(error.row) && error.field === columns[2],
      );
    let index = keyIndex.current;
    if (duplicates) {
      if (!index) index = buildKeyIndex(control.read());
      else {
        const affected = new Set<string>();
        for (const row of edited) {
          const before = index.keys[row - 1] ?? null;
          const draft = draftAt(row);
          const after = draft ? uniqueKeyOf(draft.cells) : null;
          if (before === after) continue;
          index.keys[row - 1] = after;
          if (before) {
            affected.add(before);
            const rows = index.buckets
              .get(before)
              ?.filter((item) => item !== row);
            if (rows?.length) index.buckets.set(before, rows);
            else index.buckets.delete(before);
          }
          if (after) {
            affected.add(after);
            const rows = [...(index.buckets.get(after) ?? []), row].sort(
              (a, b) => a - b,
            );
            index.buckets.set(after, rows);
          }
        }
        // A duplicate is fixed by editing the OTHER row too.
        for (const error of current)
          if (
            error.message === DUPLICATE_KEY_MESSAGE &&
            affected.has(index.keys[error.row - 1] ?? "")
          )
            checked.add(error.row);
      }
      if (keyIndex.current !== index) {
        // Built from the sheet as it is now: every row counts as checked.
        keyIndex.current = index;
        for (const error of current)
          if (error.message === DUPLICATE_KEY_MESSAGE) checked.add(error.row);
      }
    } else keyIndex.current = null;

    const fresh = new Map<string, RowError>();
    for (const row of checked) {
      const draft = draftAt(row);
      if (!draft) continue;
      const found = validateRows([draft], labels.current, new Set(), {
        rowOffset: row - 1,
      }).errors;
      const key = index ? (index.keys[row - 1] ?? null) : null;
      // The first row holding a key claims it; every later one is the duplicate.
      if (key && (index?.buckets.get(key)?.[0] ?? row) < row)
        found.push({
          row,
          field: columns[2],
          value: (draft.cells[2] ?? "").trim(),
          message: DUPLICATE_KEY_MESSAGE,
        });
      for (const error of found)
        fresh.set(`${error.row}|${error.field}`, error);
    }
    return keepUnfixed(
      current,
      fresh,
      (row, column) => draftAt(row)?.cells[column] ?? "",
      checked,
    );
  }
  function pruneFixedErrors() {
    const edits = pendingEdits.current;
    pendingEdits.current = { all: false, rows: new Set() };
    if (!control) return;
    if (edits.all) refreshOutside();
    else refreshOutsideRows([...edits.rows]);

    const current = errorsRef.current;
    if (!current.length) {
      // Edits go unrecorded while there is nothing to prune.
      keyIndex.current = null;
      return;
    }
    let next: RowError[];
    if (edits.all) {
      keyIndex.current = null;
      const drafts = control.read();
      const fresh = new Map(
        validateRows(drafts, labels.current).errors.map((error) => [
          `${error.row}|${error.field}`,
          error,
        ]),
      );
      next = keepUnfixed(
        current,
        fresh,
        (row, column) => drafts[row - 1]?.cells[column] ?? "",
      );
    } else next = pruneEditedRows(current, edits.rows);
    if (next === current) return;
    // Applied only over the list it was computed from: anything that
    // replaced the list meanwhile (a paste, a Simpan) validated afresh.
    setErrors((latest) => (latest === current ? next : latest));
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
   * Mengembalikan rentang impor terakhir ke isinya sebelum impor: baris yang
   * tadinya kosong dihapus dari sheet, baris yang tadinya berisi (draft atau
   * tersimpan) mendapat isinya kembali. Tidak ada yang dikirim ke server.
   *
   * Ditolak, bukan ditebak, bila barisnya sudah bukan baris impor itu lagi
   * (kuncinya berbeda) atau sebagian sudah tersimpan sejak impor — menimpa
   * baris tersimpan dengan isi lama akan menjadi perubahan baru di server.
   */
  async function undoImport() {
    const undo = lastImport;
    if (!control || !canEdit || !undo) return;
    await control.finish();

    const now = undo.keys.map((_, index) => control.readRow(undo.row + index));
    const moved = now.some((row, index) => row?.key !== undo.keys[index]);
    const savedSince = now.some(
      (row, index) =>
        JSON.stringify(row?.original ?? null) !==
        JSON.stringify(undo.before[index]?.original ?? null),
    );
    if (moved || savedSince) {
      setLastImport(null);
      failNotice(
        savedSince
          ? `Sebagian baris dari ${undo.source} sudah tersimpan, jadi impornya tidak bisa dibatalkan sekaligus. Batalkan baris tersimpan satu per satu supaya histori audit tetap ada.`
          : `Susunan baris sudah berubah sejak ${undo.source} diimpor. Hapus baris draftnya lewat Pilih + Hapus.`,
      );
      return;
    }

    const count = undo.keys.length;
    const edited = now.filter(
      (row, index) => row?.cells.join("\t") !== undo.written[index]?.join("\t"),
    ).length;
    const overwritten = undo.before.filter(
      (row) => row.original || row.cells.some(Boolean),
    ).length;
    if (
      !(await confirm({
        title: `Batalkan impor ${undo.source}?`,
        message:
          `${count.toLocaleString("id-ID")} baris dari impor ini dikembalikan seperti sebelum impor` +
          (overwritten
            ? `; ${overwritten.toLocaleString("id-ID")} baris yang tertimpa mendapat isinya kembali`
            : "") +
          (edited
            ? `. ${edited.toLocaleString("id-ID")} baris sudah Anda ubah setelah impor dan perubahannya ikut hilang`
            : "") +
          ". Data yang sudah tersimpan di server tidak berubah.",
        confirmLabel: "Batalkan impor",
        cancelLabel: "Kembali",
        tone: "danger",
      }))
    )
      return;

    setResolvingPaste(true);
    try {
      // Tulis dulu selagi posisinya masih utuh, baru hapus baris yang tadinya
      // kosong — penghapusan memakai kunci, jadi tidak terpengaruh geseran.
      undo.before.forEach((row, index) => {
        if (row.original || row.cells.some(Boolean))
          control.write(undo.row + index, row.cells);
      });
      control.removeDrafts(
        undo.keys.filter((_, index) => {
          const row = undo.before[index];
          return row && !row.original && !row.cells.some(Boolean);
        }),
      );
      setLastImport(null);
      setImportedUnsaved(false);
      refreshOutside();
      await resolveAndValidate();
      setNotice(
        `Impor ${undo.source} dibatalkan: ${count.toLocaleString("id-ID")} baris dikembalikan seperti sebelum impor.`,
      );
    } finally {
      setResolvingPaste(false);
    }
  }
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

  /**
   * Sends one saved row whose shift moved as an inline edit, then adopts the
   * server's version into the grid so the row reads as saved again. Returns
   * true, or the reason the server gave for refusing it.
   */
  async function moveSavedShift(
    input: SaveAttempt["rows"][number],
    old: DraftRow["original"],
  ): Promise<true | string> {
    if (!control || !old) return "Baris asal tidak ditemukan.";
    const changes = {
      shiftStart: input.shiftStart,
      shiftEnd: input.shiftEnd,
      pin: input.pin,
      widthCm: input.widthCm,
      weftDensity: input.weftDensity,
      resultMeter: input.resultMeter,
    };
    try {
      const saved = await patchProduction(
        old.id,
        { expectedRowVersion: old.rowVersion, ...changes },
        csrfToken,
      );
      control.accept([input], {
        batchId: saved.id,
        sourceRevision: "",
        counts: { inserted: 0, updated: 1, unchanged: 0, rejected: 0 },
        rows: [
          {
            clientRowId: input.clientRowId,
            outcome: "UPDATED",
            productionEntryId: saved.id,
            rowVersion: saved.rowVersion,
          },
        ],
      });
      return true;
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.code === "ROW_VERSION_CONFLICT")
          return "Baris ini sudah diubah orang lain. Muat ulang untuk melihat versi terbaru.";
        if (error.code === "UNIQUE_KEY_CONFLICT")
          return "Sudah ada baris lain dengan shift dan station yang sama.";
        return error.message;
      }
      return error instanceof Error ? error.message : "Shift gagal diperbarui.";
    }
  }

  async function save(retry?: SaveAttempt) {
    // Checked here, not only in runSave: the `finally` below must never clear
    // the stepper of a save that is still in flight.
    if (!control || !canWrite || mutation.isPending || saving) return;
    try {
      await runSave(retry);
    } catch (error) {
      failNotice(
        `${error instanceof Error ? error.message : "Simpan gagal."} Draft tetap tersedia.`,
      );
    } finally {
      // Whatever path ended the save, the stepper never stays "running".
      setSaveRun((run) => (run?.phase === "running" ? null : run));
    }
  }
  async function runSave(retry?: SaveAttempt) {
    if (!control) return;
    // Shown before the first await: on a large draft the HRIS lookup below is
    // the slow part, and a Simpan that looks idle for seconds gets pressed
    // again.
    showSaveRun({
      phase: "running",
      step: "check",
      total: 0,
      sent: 0,
      withShift: false,
    });
    await control.finish();

    // Auto-correct the assignee cells before judging them. Without this, a
    // sheet pasted with EIDs is rejected here with nothing the admin can act
    // on — the value is correct, it just has not been translated yet.
    if (!retry && (await resolveAndValidate()).length) {
      failCellNotice(
        (count) =>
          `${count.toLocaleString("id-ID")} sel belum valid. Perbaiki sel yang ditandai merah; belum ada data yang dikirim.`,
      );
      return;
    }

    const drafts = control.read();
    const byKey = new Map(drafts.map((draft) => [draft.key, draft]));
    // Once, not `findIndex` per moved row or per rejected field error: a
    // 10.000-row rejection made that a hundred million comparisons.
    const indexByKey = new Map(
      drafts.map((draft, index) => [draft.key, index]),
    );
    const rowOf = (key: string) => (indexByKey.get(key) ?? -1) + 1;
    const validation = validateRows(drafts, labels.current);
    const changed = validation.rows.filter((input) =>
      isChanged(input, byKey.get(input.clientRowId)?.original),
    );
    const stationChanged = changed.some((input) => {
      const old = byKey.get(input.clientRowId)?.original;
      return old && old.stationNo !== input.stationNo;
    });
    const changedKeys = new Set(changed.map((input) => input.clientRowId));
    // Recomputed from the sheet as it is now: the `outside` state is
    // refreshed on a timer and after inserts, so it can lag a just-typed date.
    const leaving = (book ? rowsOutsideBook(drafts, book) : []).filter((item) =>
      changedKeys.has(drafts[item.row - 1]?.key ?? ""),
    );
    if (
      !retry &&
      book &&
      leaving.length &&
      !(await confirm({
        title: `${leaving.length.toLocaleString("id-ID")} baris di luar buku ${book.code}`,
        message:
          `Shift Start-nya di luar ${book.periodStart} s/d ${book.periodEnd} (ditandai kuning). ` +
          "Tiap baris akan masuk ke buku yang mencakup tanggalnya, atau ditolak bila buku itu belum ada atau sudah tutup. " +
          "Kalau tanggalnya salah ketik, perbaiki dulu.",
        confirmLabel: "Tetap simpan",
        cancelLabel: "Periksa dulu",
      }))
    ) {
      setSaveRun(null);
      return;
    }
    if (!retry && stationChanged) {
      failNotice(
        "Station pada baris tersimpan tidak dapat diubah. Kembalikan nilainya, atau Batalkan baris itu lalu isi sebagai baris baru.",
      );
      return;
    }
    if (!retry && !changed.length) {
      setNotice("Tidak ada perubahan untuk disimpan.");
      return;
    }
    // Saved rows whose shift moved cannot ride the batch: it matches rows by
    // shift + station, so they would land as new rows beside the old ones.
    const moved = retry
      ? []
      : changed.filter((input) => {
          const old = byKey.get(input.clientRowId)?.original;
          return (
            old &&
            (Date.parse(old.shiftStart) !== Date.parse(input.shiftStart) ||
              Date.parse(old.shiftEnd) !== Date.parse(input.shiftEnd))
          );
        });
    const movedKeys = new Set(moved.map((input) => input.clientRowId));
    const rows = changed.filter((input) => !movedKeys.has(input.clientRowId));
    /*
      Only the rows this save is about lose their marks. A blanket
      `setErrors([])` also dropped server rejections and HRIS failures on rows
      nobody touched — the red cells went, the problems did not, and the next
      Simpan was the first place they showed up again.
    */
    const sending = retry ?? { key: "", rows };
    const affected = new Set(
      [...moved, ...sending.rows].map((input) => rowOf(input.clientRowId)),
    );
    const keepUnaffected = (current: RowError[]) =>
      current.filter((error) => !affected.has(error.row));
    let movedSaved = 0;
    const movedErrors: RowError[] = [];
    if (moved.length) {
      setErrors(keepUnaffected);
      setMovingShifts(true);
      showSaveRun({
        phase: "running",
        step: "shift",
        total: 0,
        sent: 0,
        withShift: true,
      });
      try {
        for (const input of moved) {
          const outcome = await moveSavedShift(
            input,
            byKey.get(input.clientRowId)?.original,
          );
          if (outcome === true) movedSaved += 1;
          else
            movedErrors.push({
              row: rowOf(input.clientRowId),
              field: columns[0],
              value: input.shiftStart,
              message: outcome,
            });
        }
      } finally {
        setMovingShifts(false);
      }
    }
    const movedSummary = moved.length
      ? `${movedSaved.toLocaleString("id-ID")} baris tersimpan dipindah shift-nya${
          movedErrors.length
            ? `, ${movedErrors.length.toLocaleString("id-ID")} ditolak`
            : ""
        }.`
      : "";
    if (!rows.length && !retry) {
      setErrors((current) => [...keepUnaffected(current), ...movedErrors]);
      if (movedErrors.length)
        failNotice(`${movedSummary} Draft baris yang ditolak tetap tersedia.`);
      else {
        const at = new Date();
        setLastSavedAt(at);
        invalidateProduction();
        showSaveRun({
          phase: "done",
          counts: { inserted: 0, updated: 0, unchanged: 0, rejected: 0 },
          moved: movedSaved,
          at,
          firstRejectedRow: null,
        });
      }
      return;
    }
    const pending = retry ?? { key: crypto.randomUUID(), rows };
    setAttempt(pending);
    setErrors(keepUnaffected);
    showSaveRun({
      phase: "running",
      step: "send",
      total: pending.rows.length,
      sent: 0,
      withShift: moved.length > 0,
    });
    /** Takes in what the server committed and reports it, row by row. */
    const applyResult = (
      result: Awaited<ReturnType<typeof saveProductionBatched>>,
      unsent?: { rows: number; reason: string },
    ) => {
      control.accept(pending.rows, result);
      const rejectedErrors: RowError[] = [
        ...movedErrors,
        ...result.rows.flatMap((item) =>
          item.outcome === "REJECTED"
            ? (item.fieldErrors?.length
                ? item.fieldErrors
                : [{ field: ROW_FIELD, message: "Baris ditolak server." }]
              ).map((error) => {
                const index = rowOf(item.clientRowId) - 1;
                const field = serverFieldColumn(error.field);
                const column = (columns as readonly string[]).indexOf(field);
                return {
                  row: index + 1,
                  field,
                  value: column < 0 ? "" : (drafts[index]?.cells[column] ?? ""),
                  message: error.message,
                  server: true,
                };
              })
            : [],
        ),
      ];
      setErrors((current) => [...keepUnaffected(current), ...rejectedErrors]);
      const at = new Date();
      if (result.counts.inserted + result.counts.updated + movedSaved > 0) {
        setLastSavedAt(at);
        invalidateProduction();
      }
      const rejectedRows = rejectedErrors
        .map((error) => error.row)
        .filter((row) => row > 0);
      showSaveRun({
        phase: "done",
        counts: {
          ...result.counts,
          rejected: result.counts.rejected + movedErrors.length,
        },
        moved: movedSaved,
        at,
        // A loop, not Math.min(...rows): a 100.000-row rejection would
        // overflow the argument list.
        firstRejectedRow: rejectedRows.reduce<number | null>(
          (first, row) => (first === null || row < first ? row : first),
          null,
        ),
        ...(unsent ? { unsent } : {}),
      });
    };
    try {
      const result = await mutation.mutateAsync(pending);
      const sent = new Set(pending.rows.map((input) => input.clientRowId));
      if (
        result.rows.length !== pending.rows.length ||
        new Set(result.rows.map((item) => item.clientRowId)).size !==
          pending.rows.length ||
        result.rows.some(
          (item) =>
            !sent.has(item.clientRowId) ||
            (item.outcome !== "REJECTED" &&
              (!item.productionEntryId || !item.rowVersion)),
        )
      )
        // Definitive, not "retry the same key": a replay returns this same
        // body, and the grid would stay locked behind it forever.
        throw new BatchResponseShapeError();
      setAttempt(null);
      applyResult(result);
    } catch (error) {
      if (error instanceof PartialSaveError) {
        // The committed chunks are real rows now. Taking them in gives them
        // their ids and versions, so the next Simpan sends only the rest —
        // with a fresh key, because the remainder is a new payload.
        setAttempt(null);
        const committed = new Set(
          error.completed.rows.map((item) => item.clientRowId),
        );
        applyResult(error.completed, {
          rows: pending.rows.filter(
            (input) => !committed.has(input.clientRowId),
          ).length,
          reason:
            error.cause instanceof Error
              ? error.cause.message
              : "batch berikutnya gagal.",
        });
        return;
      }
      if (isUnknownOutcome(error)) {
        failNotice(
          error instanceof ApiClientError && error.code === "IMPORT_IN_PROGRESS"
            ? "Simpan yang sama masih diproses server. Tunggu sebentar lalu klik Ulangi simpan yang sama."
            : `${error instanceof Error ? error.message : "Simpan gagal."} Hasilnya belum pasti; draft tetap tersedia.`,
        );
        return;
      }
      setAttempt(null);
      failNotice(
        `${error instanceof Error ? error.message : "Simpan gagal."} Draft tetap tersedia.`,
      );
    }
  }
  /**
   * The production lists other mounts would read are stale after a save.
   * Marked only — `refetchType: "none"` — because refetching the list this
   * workspace was built from would remount the grid and throw away the rows
   * the server just rejected.
   */
  function invalidateProduction() {
    void employeeCache.invalidateQueries({
      queryKey: ["production"],
      refetchType: "none",
    });
  }
  /**
   * Abandons an attempt whose outcome is unknown and reloads from the
   * server, which is the only place that knows what landed. Without it the
   * grid stayed inert until the same request finally succeeded.
   */
  async function discardAttempt() {
    if (
      !(await confirm({
        title: "Buang percobaan dan muat ulang?",
        message:
          "Hasil simpan terakhir belum pasti: sebagian atau semua baris mungkin sudah tersimpan. Data akan dimuat ulang dari server dan draft yang belum tersimpan di layar ini hilang.",
        confirmLabel: "Buang & muat ulang",
        tone: "danger",
      }))
    )
      return;
    setAttempt(null);
    onReload("Percobaan simpan dibuang. Data dimuat ulang dari server.");
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
  /**
   * Ctrl+V, klik kanan → Paste, dan tombol Tempel menulis langsung ke sel
   * mulai dari sel aktif, seperti spreadsheet. Jalurnya tetap `applyRows`:
   * tanggal/desimal dirapikan, EID jadi PIN, lalu sel yang salah ditandai —
   * tidak ada jalur tulis kedua yang aturannya bisa menyimpang.
   */
  function pasteIntoGrid(text: string) {
    if (!canEdit || !control || !text) return;
    void applyRows({ text, target: control.activeCell(), source: "" });
  }
  /**
   * Tombol Tempel membaca clipboard sendiri. Bila browser menolak, panel
   * preview terbuka supaya teksnya bisa ditempel manual di sana.
   */
  function pasteFromButton() {
    if (!canEdit || !control) return;
    navigator.clipboard.readText().then(
      (text) => (text ? pasteIntoGrid(text) : openPaste("")),
      () => openPaste(""),
    );
  }
  function openPaste(text: string) {
    if (!canEdit || !control) return;
    setPasteTarget(control.activeCell());
    setClipboard(text);
    setSideTab("paste");
    requestAnimationFrame(() =>
      pastePanel.current?.scrollIntoView({ block: "nearest" }),
    );
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
        key: crypto.randomUUID(),
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
      // Sesudah baris terakhir yang berisi, bukan di baris kosong pertama:
      // celah kosong di tengah data membuat impor mulai di sana dan menimpa
      // baris tersimpan di bawahnya — perubahan produksi lewat jalur yang
      // dikira "menambah".
      const drafts = control.read();
      let target = drafts.length;
      while (
        target > 0 &&
        !drafts[target - 1]!.original &&
        drafts[target - 1]!.cells.every((cell) => !cell)
      )
        target -= 1;
      const overlapsSaved = drafts
        .slice(target, target + parsed.cells.length)
        .some((item) => item.original);
      if (overlapsSaved) {
        failNotice(
          "Rentang tujuan impor berisi baris tersimpan. Tidak ada yang ditulis; muat ulang lalu coba lagi.",
        );
        return;
      }

      if (target + parsed.cells.length > MAX_ROWS) {
        // Muat di file, tidak muat di grid: kirim langsung, jangan suruh orang
        // memecah filenya sendiri.
        setBulkImport({
          file,
          key: crypto.randomUUID(),
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
            parsed.skippedBeforeHeader
              ? `. ${parsed.skippedBeforeHeader} baris di atas judul kolom dilewati`
              : ""
          }` +
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
        // Kolom lebih pada file tanpa judul: barisnya tetap masuk, masalahnya
        // ditandai di baris itu dengan nomor baris filenya.
        extraErrors: parsed.problems.map((problem) => ({
          row: target + 1 + problem.index,
          field: ROW_FIELD,
          value: "",
          message: `Baris file ${parsed.fileRows[problem.index]?.toLocaleString("id-ID") ?? "?"}: ${problem.message}`,
        })),
        onProgress: (written, total) =>
          setImportProgress((current) =>
            current
              ? {
                  ...current,
                  fraction: written / total,
                  detail: `${written.toLocaleString("id-ID")} dari ${total.toLocaleString("id-ID")} baris`,
                }
              : current,
          ),
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
    onProgress,
    extraErrors = [],
  }: {
    text: string;
    target: { row: number; column: number };
    source: string;
    /** Problems found before the cells were written (import only). */
    extraErrors?: RowError[];
    /** Import only: reports the slow steps to the progress modal. */
    onStage?: (stage: "resolve" | "write") => Promise<void>;
    /** Import only: rows written to the grid so far, of `total`. */
    onProgress?: (written: number, total: number) => void;
  }) {
    if (!control || !canEdit) return;
    setResolvingPaste(true);
    const controller = new AbortController();
    pasteAbort.current = controller;
    setNotice("Memvalidasi baris dan identitas karyawan…");
    /*
      Long pastes run in slices of SLICE_ROWS with a yield in between, so the
      tab keeps painting (and the progress keeps moving) instead of freezing
      for seconds. The order is unchanged and so is what a cancel means:
      everything up to the HRIS lookup only reads the sheet, the cancel point
      is still before the first cell is written, and once writing starts it
      runs to the end. The grid is inert meanwhile (`busy`), so nothing else
      writes between slices.
    */
    const slices = async (
      length: number,
      run: (from: number, to: number) => void,
    ) => {
      for (let from = 0; from < length; from += SLICE_ROWS) {
        if (controller.signal.aborted) return false;
        run(from, Math.min(length, from + SLICE_ROWS));
        if (from + SLICE_ROWS < length) await yieldToMain();
      }
      return !controller.signal.aborted;
    };
    try {
      await control.finish();
      const raw = parseClipboard(text);
      if (
        where.row + raw.length - 1 > MAX_ROWS ||
        where.column + (raw[0]?.length ?? 0) - 1 > 7
      )
        throw new Error(
          `Rentang melewati batas workspace (${MAX_ROWS.toLocaleString("id-ID")} baris / 7 kolom). Ubah tujuan; tidak ada data yang dipangkas.`,
        );
      await yieldToMain();
      const parsed: string[][] = [];
      let normalizedDates = 0;
      await slices(raw.length, (from, to) => {
        const part = normalizePastedCells(raw.slice(from, to), where.column);
        part.forEach((row, offset) => {
          const before = raw[from + offset];
          row.forEach((value, columnIndex) => {
            if (value !== before?.[columnIndex]) normalizedDates += 1;
          });
          parsed.push(row);
        });
      });
      // `read()` hanya mengembalikan baris yang pernah tersentuh — dibaca per
      // potongan supaya 100.000 baris tidak dibaca dalam satu tugas.
      const drafts: DraftRow[] = [];
      for (let row = 1; ; row += SLICE_ROWS) {
        const part = control.readRange(row, SLICE_ROWS);
        for (const draft of part) drafts.push(draft);
        if (part.length < SLICE_ROWS || controller.signal.aborted) break;
        await yieldToMain();
      }
      // Menempel ke baris kosong di luar jendela itu sah, jadi barisnya
      // disiapkan di sini — tanpa ini paste besar diam-diam cuma menulis
      // sebagian.
      const needed = where.row - 1 + parsed.length;
      const proposed: DraftRow[] = [];
      await slices(Math.max(drafts.length, needed), (from, to) => {
        for (let index = from; index < to; index++) {
          const draft = drafts[index];
          proposed.push(
            draft
              ? { ...draft, cells: [...draft.cells] }
              : {
                  key: `pending-${index + 1}`,
                  cells: Array<string>(7).fill(""),
                },
          );
        }
      });
      // Isi rentang SEBELUM ditimpa, untuk "Batalkan impor".
      const before = parsed.map((_, index) => {
        const draft = drafts[where.row - 1 + index];
        return {
          cells: draft ? [...draft.cells] : Array<string>(7).fill(""),
          original: draft?.original,
        };
      });
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
      if (controller.signal.aborted) {
        // The lookup came back after the cancel: nothing was written, so the
        // "Memvalidasi…" line must not stay up as if something still runs.
        setNotice(
          source
            ? "Impor dibatalkan. Draft tidak berubah."
            : "Paste dibatalkan. Draft tidak berubah.",
        );
        return;
      }
      await onStage?.("write");
      control.reserveRows(where.row + incoming.length - 1);
      const written = await slices(incoming.length, (from, to) => {
        control.writeRange(
          where.row + from,
          incoming.slice(from, to).map((item) => item.cells),
        );
        onProgress?.(to, incoming.length);
        if (!source && incoming.length > SLICE_ROWS)
          setNoticeText(
            `Menulis ke grid… ${to.toLocaleString("id-ID")} dari ${incoming.length.toLocaleString("id-ID")} baris.`,
          );
      });
      // Only an unmount aborts past this point; the page is gone.
      if (!written) return;
      // The writes above report no edits; whatever the key index knew is stale.
      keyIndex.current = null;
      if (source) {
        const keys: string[] = [];
        await slices(incoming.length, (from, to) => {
          for (const draft of control.readRange(where.row + from, to - from))
            keys.push(draft.key);
        });
        setLastImport({
          source,
          row: where.row,
          before,
          written: incoming.map((item) => [...item.cells]),
          keys,
        });
      }
      // `proposed` IS the sheet now; no second read for the warnings.
      if (book) showOutside(rowsOutsideBook(proposed, book));
      const writtenEnd = where.row + parsed.length;
      /*
        Rows outside the range just written keep the problems only a server
        or HRIS can report — `validateRows` below cannot reproduce them, and
        replacing the list with its result alone made them vanish while the
        rows still fail.
      */
      const keptRemote = (current: RowError[]) =>
        current.filter(
          (error) =>
            (error.row < where.row || error.row >= writtenEnd) &&
            (error.server ||
              (error.field === columns[3] &&
                error.message !== ASSIGNEE_INVALID_MESSAGE)),
        );
      // Sliced with one shared key set: the same result as one call over
      // every row, duplicates across slices included.
      const localErrors: RowError[] = [];
      const seenKeys = new Set<string>();
      await slices(proposed.length, (from, to) => {
        for (const error of validateRows(
          proposed.slice(from, to),
          labels.current,
          seenKeys,
          { rowOffset: from },
        ).errors)
          localErrors.push(error);
      });
      const errors = mergeErrors(
        [...extraErrors, ...lookupErrors],
        localErrors,
      );
      if (errors.length) {
        setErrors((current) => mergeErrors(errors, keptRemote(current)));
        setClipboard(null);
        if (source) setImportedUnsaved(true);
        // Most of the rows landed: say so plainly. The cells that still need
        // work get their own strip (count, stepping) right under this line,
        // instead of turning a near-success into a red alarm.
        const landed = `${parsed.length.toLocaleString("id-ID")} baris ${source ? `dari ${source} ` : ""}masuk ke draft.`;
        failCellNotice(() => landed, "info");
        return;
      }
      setClipboard(null);
      setErrors(keptRemote);
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
        importKey: bulkImport.key,
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
      invalidateProduction();
      onReload(
        `Data mesin ${machine} berhasil dibatalkan dan tidak lagi masuk daftar aktif.`,
      );
    } catch (error) {
      setVoidError(
        `${error instanceof Error ? error.message : "Pembatalan gagal."} Data belum diubah di layar.`,
      );
      if (!isUnknownOutcome(error)) setVoidAttempt(null);
    }
  }
  /**
   * Leaves a void whose outcome is unknown. The dialog used to refuse to
   * close until the same request succeeded; now it closes and the rows are
   * reloaded, since only the server knows whether the row is VOID.
   */
  async function abandonVoid() {
    const machine = voidTarget?.stationNo;
    setVoidTarget(null);
    setVoidAttempt(null);
    setVoidError("");
    if (
      status.dirty &&
      !(await confirm({
        title: "Muat ulang dan buang draft?",
        message:
          "Status pembatalan belum pasti dan hanya bisa dipastikan dengan memuat ulang data. Draft yang belum disimpan di layar ini akan hilang.",
        confirmLabel: "Buang draft & muat ulang",
        tone: "danger",
      }))
    ) {
      failNotice(
        `Hasil pembatalan mesin ${machine ?? ""} belum pasti. Muat ulang untuk melihat statusnya di server.`,
      );
      return;
    }
    invalidateProduction();
    onReload(
      `Hasil pembatalan mesin ${machine ?? ""} belum pasti; data dimuat ulang dari server.`,
    );
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
          <div inert={busy} ref={gridShell} className="manual-grid-shell">
            <Suspense fallback={<GridSkeleton stage="engine" />}>
              <Grid
                entries={entries}
                names={names}
                editable={canWrite}
                onReady={setControl}
                onStatus={setStatus}
                onAssignee={requestAssignee}
                onCellTrigger={requestCellTrigger}
                onPaste={pasteIntoGrid}
                onBlocked={failNotice}
                /*
                  Insert and delete are real spreadsheet actions here, so the
                  row numbers this page remembers move with the sheet. Without
                  this, "baris 9.115" in the problem list would point at
                  whatever slid into that position.
                */
                onRowsShifted={(from, delta) => {
                  setErrors((current) => shiftRows(current, from, delta));
                  setOutside((current) => shiftRows(current, from, delta));
                  setSaveRun((run) =>
                    moveRejectedRow(run, (rows) =>
                      shiftRows(rows, from, delta),
                    ),
                  );
                  setLastImport((current) =>
                    current && from <= importEnd(current) ? null : current,
                  );
                  scheduleErrorPrune();
                }}
                onRowsRemoved={(rows) => {
                  setErrors((current) => removeRowsFrom(current, rows));
                  setOutside((current) => removeRowsFrom(current, rows));
                  setSaveRun((run) =>
                    moveRejectedRow(run, (items) =>
                      removeRowsFrom(items, rows),
                    ),
                  );
                  setLastImport((current) =>
                    current && rows.some((row) => row <= importEnd(current))
                      ? null
                      : current,
                  );
                  scheduleErrorPrune();
                }}
                onEdited={scheduleErrorPrune}
              />
            </Suspense>
            {cellAnchor && canEdit && cellAnchor.column === 4 && (
              <AssigneeCellTrigger
                anchor={cellAnchor}
                open={assigneeAnchor?.row === cellAnchor.row}
                onToggle={() =>
                  requestAssignee(
                    assigneeAnchor?.row === cellAnchor.row
                      ? null
                      : assigneeBelow(cellAnchor),
                  )
                }
              />
            )}
            {cellAnchor && canEdit && cellAnchor.column !== 4 && (
              <DateCellPicker
                // A different cell is a different popover: remounting drops the
                // previous cell's open state without a setState-in-effect.
                key={`${cellAnchor.row}:${cellAnchor.column}`}
                anchor={cellAnchor}
                onApply={applyDateCell}
                onDismiss={() => control?.select(cellAnchor.row)}
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
        </div>
        <div className="manual-split-side">
          <div className="manual-side-controls">
            {controls}
            <div className="manual-workspace-heading">
              <h2 id="workspace-heading">Data produksi</h2>
              {/*
                Draft state first: it is the one part that decides whether
                leaving the page loses work, so it is the part that must
                survive when a narrow window clips this line.
              */}
              <p
                className="manual-draft-status"
                title={`${draftState} · ${status.selected.toLocaleString("id-ID")} dipilih · ${status.populated.toLocaleString("id-ID")} baris terisi`}
              >
                <span
                  className={`manual-draft-state${status.dirty ? " manual-draft-dirty" : !saving && lastSavedAt ? " manual-draft-saved" : ""}`}
                >
                  {draftState}
                </span>
                <span>
                  {" "}
                  · {status.selected.toLocaleString("id-ID")} dipilih
                </span>
                <span className="manual-draft-filled">
                  {" "}
                  · {status.populated.toLocaleString("id-ID")} baris terisi
                </span>
              </p>
              <button
                className="manual-btn manual-primary manual-save-button"
                aria-label="Simpan perubahan"
                aria-busy={saving}
                disabled={!canEdit || !control}
                onClick={() => void save()}
              >
                {saving && (
                  <span className="manual-save-spinner" aria-hidden="true" />
                )}
                {saving ? "Menyimpan" : "Simpan"}
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
              role={shownFailed ? "alert" : "status"}
              className={
                shownFailed
                  ? "manual-status manual-status-failed"
                  : "manual-status"
              }
            >
              {shownFailed && (
                <span aria-hidden="true" className="manual-status-mark">
                  !
                </span>
              )}
              {shownNotice}
            </div>
            {saveRun && (
              <SaveProgress
                run={saveRun}
                onShowRow={(row) => control?.select(row)}
                rowLabel={gridRowLabel}
              />
            )}
            {/*
              Three groups by what the action works on, each labelled and on
              its own line: the rows in the grid, data coming in, and the
              panels beside it. At most four controls each; the rare row
              actions (copy, void a saved row) sit in "Lainnya".
            */}
            <div className="manual-toolbar">
              <div
                className="manual-toolbar-group"
                role="group"
                aria-labelledby="manual-toolbar-rows"
              >
                <span id="manual-toolbar-rows" className="manual-toolbar-label">
                  Baris
                </span>
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
                  Semua
                </label>
                <button
                  className="manual-btn"
                  title="Pilih baris kosong berikutnya untuk diisi."
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
                    setNotice(
                      `Isi baris ${gridRowLabel(target)} di grid atau editor baris.`,
                    );
                  }}
                >
                  Baris baru
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
                <ToolbarMenu
                  label="Lainnya"
                  items={[
                    {
                      label: `Salin baris terpilih (${status.selected.toLocaleString("id-ID")})`,
                      ariaLabel: `Salin baris (${status.selected})`,
                      disabled: !status.selected,
                      reason: "Pilih baris dulu lewat kotak centang.",
                      onSelect: () => void copyRows(),
                    },
                    {
                      label: "Batalkan data tersimpan…",
                      ariaLabel: "Batalkan data",
                      tone: "danger",
                      disabled:
                        !canEdit ||
                        !control ||
                        status.selected !== 1 ||
                        status.dirty,
                      reason: status.dirty
                        ? "Simpan atau buang draft dulu."
                        : "Pilih tepat satu baris tersimpan. Histori audit tetap ada.",
                      onSelect: () => void openVoid(),
                    },
                  ]}
                />
              </div>
              <div
                className="manual-toolbar-group"
                role="group"
                aria-labelledby="manual-toolbar-incoming"
              >
                <span
                  id="manual-toolbar-incoming"
                  className="manual-toolbar-label"
                >
                  Masuk
                </span>
                <button
                  className="manual-btn"
                  aria-label="Tempel data"
                  disabled={!canEdit || !control}
                  onClick={pasteFromButton}
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
                {lastImport && (
                  <button
                    className="manual-btn manual-danger-quiet"
                    aria-label={`Batalkan impor ${lastImport.source}`}
                    title="Kembalikan baris yang diimpor terakhir ke keadaan sebelum impor. Hanya draft; data tersimpan tidak berubah."
                    disabled={!canEdit || !control || busy}
                    onClick={() => void undoImport()}
                  >
                    Batalkan impor
                  </button>
                )}
                {/* Petunjuk ada di sheet "Cara Pakai" di dalam file yang sama. */}
                <a
                  className="manual-toolbar-link"
                  href="/templates/manual-data-template.xlsx"
                  download
                >
                  Template Excel
                </a>
              </div>
              <div
                className="manual-toolbar-group"
                role="group"
                aria-labelledby="manual-toolbar-panels"
              >
                <span
                  id="manual-toolbar-panels"
                  className="manual-toolbar-label"
                >
                  Panel
                </span>
                <button
                  className="manual-btn"
                  type="button"
                  aria-expanded={showEditor}
                  aria-controls="manual-side-panel-editor"
                  aria-describedby={
                    importedUnsaved ? "manual-editor-locked" : undefined
                  }
                  disabled={importedUnsaved}
                  title={
                    importedUnsaved
                      ? "Edit baris aktif lagi setelah impor disimpan atau dibatalkan."
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
              {importedUnsaved && (
                <p id="manual-editor-locked" className="manual-toolbar-note">
                  Edit baris aktif lagi setelah impor disimpan atau dibatalkan.
                </p>
              )}
            </div>
            {/*
              What still needs work sits under the actions, so the buttons
              keep one place on screen; the save feedback above stays right
              beside Simpan, where a click is looked for.
            */}
            {errors.length > 0 && cursorRow !== undefined && (
              <div
                className="manual-fix-strip"
                role="group"
                aria-label="Sel yang perlu diperbaiki"
              >
                <p className="manual-fix-strip-count">
                  <strong>
                    {errors.length.toLocaleString("id-ID")} sel perlu diperbaiki
                  </strong>{" "}
                  sebelum disimpan
                  {errorRows.length > 1
                    ? ` · ${errorRows.length.toLocaleString("id-ID")} baris`
                    : ""}
                </p>
                <div className="manual-fix-strip-nav">
                  <button
                    type="button"
                    className="manual-btn"
                    aria-label="Baris bermasalah sebelumnya"
                    disabled={errorRows.length < 2}
                    onClick={() => stepError(-1)}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="manual-fix-strip-current"
                    onClick={() => control?.select(cursorRow)}
                  >
                    <span className="manual-fix-strip-pos">
                      {(cursorAt + 1).toLocaleString("id-ID")}/
                      {errorRows.length.toLocaleString("id-ID")}
                    </span>
                    <span>
                      Baris {gridRowLabel(cursorRow)}
                      {cursorError ? ` · ${cursorError.field}` : ""}
                      {rowContext(cursorRow)
                        ? ` · ${rowContext(cursorRow)}`
                        : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="manual-btn"
                    aria-label="Baris bermasalah berikutnya"
                    disabled={errorRows.length < 2}
                    onClick={() => stepError(1)}
                  >
                    ›
                  </button>
                </div>
              </div>
            )}
            {book && outside.length > 0 && (
              <p role="status" className="manual-outside-book">
                <span>
                  <strong>
                    {outside.length.toLocaleString("id-ID")} baris di luar buku{" "}
                    {book.code}
                  </strong>{" "}
                  ({periodRangeLabel(book.periodStart, book.periodEnd)}),
                  ditandai kuning. Saat disimpan, baris masuk ke buku sesuai
                  tanggalnya, atau ditolak bila buku itu belum ada atau tutup.
                </span>
                <button
                  type="button"
                  className="manual-link-button"
                  onClick={() => control?.select(outside[0]!.row)}
                >
                  Lihat baris {gridRowLabel(outside[0]!.row)} (
                  {periodDateLabel(outside[0]!.date)})
                </button>
              </p>
            )}
            <details className="manual-guide">
              <summary>
                <span className="manual-guide-label">Cara mengisi</span>
              </summary>
              <div className="manual-guide-body">
                <p>
                  Klik sel Assignee untuk mencari nama, PIN, atau EID. Klik ikon
                  kalender di sel Shift Start atau Shift End untuk memilih
                  tanggal dan jam. Klik dua kali pada sel lain untuk
                  mengubahnya. Gunakan Salin dan Tempel untuk banyak baris
                  sekaligus. Station pada baris tersimpan tidak dapat diubah;
                  tanggal dan jam shift-nya boleh dikoreksi.
                </p>
                <p>
                  Untuk mengunggah banyak baris sekaligus, isi sheet Data di{" "}
                  <a href="/templates/manual-data-template.xlsx" download>
                    template Excel
                  </a>{" "}
                  lalu impor file .xlsx itu langsung lewat Impor file. Kolom
                  Assignee menerima PIN maupun EID. Urutannya: Shift Start,
                  Shift End, Station, Assignee, Width, Weft, Result. Petunjuk
                  lengkap ada di sheet Cara Pakai di file yang sama.
                </p>
              </div>
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
              <h3 className="manual-errors-title">
                Perlu diperbaiki
                <span className="manual-error-count">
                  {errors.length.toLocaleString("id-ID")} sel
                </span>
              </h3>
              <ul className="manual-error-groups">
                {errorGroups.map((group) => (
                  <li key={group.message}>
                    <p className="manual-error-cause">
                      <span className="manual-error-field">{group.field}</span>
                      <span className="manual-error-count">
                        {group.count.toLocaleString("id-ID")} sel
                      </span>
                    </p>
                    <p className="manual-error-message">{group.message}</p>
                    {group.values.length > 0 && canEdit && (
                      <p className="manual-hint manual-error-hint">
                        Isi pengganti menulis ulang semua sel {group.field} yang
                        isinya <b>sama persis</b>
                        {group.field === "Assignee"
                          ? " — tulis PIN atau EID, namanya diisi otomatis."
                          : "."}
                      </p>
                    )}
                    {group.values.length > 0 ? (
                      <ul className="manual-fix-list">
                        {group.values.slice(0, FIX_VALUES_SHOWN).map((item) => (
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
                        {group.values.length > FIX_VALUES_SHOWN && (
                          <li className="manual-hint">
                            +
                            {(
                              group.values.length - FIX_VALUES_SHOWN
                            ).toLocaleString("id-ID")}{" "}
                            nilai lagi. Perbaiki yang di atas dulu; daftar ini
                            diperbarui setelahnya.
                          </li>
                        )}
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
                      {rowContext(group.firstRow) && (
                        <span className="manual-group-context">
                          {rowContext(group.firstRow)}
                        </span>
                      )}
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
                          Hapus {group.rows.size.toLocaleString("id-ID")} baris…
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
                        (Boolean(row?.original) && index === 2)
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
          {clipboard !== null && (
            <section
              id="manual-side-panel-paste"
              ref={pastePanel}
              className="manual-paste"
              aria-label="Preview clipboard"
              {...panelProps("paste")}
            >
              {/*
                Paste keeps this step; a file import no longer has one. Pasting a
                block into the middle of an existing sheet needs a target row and
                column, and getting that wrong overwrites somebody's saved work. A
                file import always starts at the first empty draft row, so there is
                nothing to choose and nothing worth pausing for.
              */}
              <h3>Preview paste</h3>
              <p>
                Urutan: Shift Start, Shift End, Station, PIN, Width, Weft,
                Result. Format waktu YYYY-MM-DD HH:mm; serial tanggal dari
                spreadsheet akan dirapikan otomatis. Desimal memakai titik.
                Maksimal {MAX_ROWS.toLocaleString("id-ID")} baris; lebih dari
                itu pakai Impor file, yang langsung masuk ke grid.{" "}
                <a href="/templates/manual-data-template.xlsx" download>
                  Unduh template Excel
                </a>
              </p>
              <div className="manual-toolbar">
                <label>
                  Baris tujuan
                  {/* Numbered like the grid gutter (data row 1 sits under
                      gutter 2), so the number typed is the number seen. */}
                  <input
                    type="number"
                    min="2"
                    max={MAX_ROWS + 1}
                    value={pasteTarget.row + 1}
                    onChange={(event) =>
                      setPasteTarget({
                        ...pasteTarget,
                        row: Math.min(
                          MAX_ROWS,
                          Math.max(1, Number(event.target.value) - 1),
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
                }}
              >
                Batal paste
              </button>
            </section>
          )}
          {/*
            Where the page ends and how much room is left: paging, the rows
            the sheet can still take, and "Tambah [1000] baris". It sat under
            the grid, eating two bars of sheet height, while this column was
            half empty. Pinned to the bottom of the column, so an open panel
            above it scrolls and this stays put.
          */}
          <footer
            className="manual-side-footer"
            aria-label="Halaman dan kapasitas"
          >
            <div className="manual-capacity">
              <div className="manual-capacity-label">
                <span className="manual-capacity-title">
                  Kapasitas draft
                  {/*
                    What to do when the workspace is full, next to the number
                    that says so — not only in the refusal that shows up once
                    it is already too late.
                  */}
                  <details className="manual-capacity-tip">
                    <summary>
                      <span aria-hidden="true">i</span>
                      <span className="manual-visually-hidden">
                        Tips saat kapasitas draft penuh
                      </span>
                    </summary>
                    <div className="manual-capacity-tip-body">
                      <strong>Kalau kapasitas draft penuh</strong>
                      <p>
                        Workspace menampung paling banyak{" "}
                        {MAX_ROWS.toLocaleString("id-ID")} baris sekaligus.
                        Kosongkan lagi dengan langkah ini:
                      </p>
                      <ol>
                        <li>
                          <b>Perbaiki sel merah</b>, lalu klik <b>Simpan</b>.
                          Simpan ditolak selama masih ada sel yang salah.
                        </li>
                        <li>
                          Klik <b>Muat ulang</b>. Workspace dibuka lagi hanya
                          dengan satu halaman data tersimpan, jadi kapasitasnya
                          kosong kembali. Data lama tetap bisa dibuka lewat
                          Sebelumnya dan Berikutnya.
                        </li>
                        <li>
                          Datanya sangat banyak? Pakai <b>Impor file</b>. File
                          yang tidak muat di workspace otomatis dikirim langsung
                          ke server per batch, tanpa batas baris.
                        </li>
                      </ol>
                    </div>
                  </details>
                </span>
                <span>
                  {status.populated.toLocaleString("id-ID")} /{" "}
                  {MAX_ROWS.toLocaleString("id-ID")} baris
                </span>
              </div>
              <meter
                className="manual-capacity-meter"
                aria-label="Baris terisi dari kapasitas draft"
                min={0}
                max={MAX_ROWS}
                high={MAX_ROWS * 0.9}
                value={status.populated}
              />
              {status.populated >= MAX_ROWS * 0.9 && (
                <p className="manual-capacity-warning" role="status">
                  Hampir penuh. Simpan lalu muat ulang sebelum menambah data —
                  lihat tips (i).
                </p>
              )}
            </div>
            <div className="manual-side-footer-head">
              <span>
                Halaman {pageNumber} · {entries.length.toLocaleString("id-ID")}{" "}
                baris tersimpan
              </span>
            </div>
            <div className="manual-pager">
              <button
                className="manual-btn"
                disabled={!onPrevious || busy}
                onClick={() => navigate(onPrevious)}
              >
                <span aria-hidden="true">‹ </span>Sebelumnya
              </button>
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
                disabled={!onNext || busy}
                onClick={() => navigate(onNext)}
              >
                Berikutnya<span aria-hidden="true"> ›</span>
              </button>
            </div>
            {canWrite && (
              <form
                className="manual-add-rows"
                aria-label="Tambah baris kosong di bawah"
                // Our own message for 0 or blank, not the browser's bubble.
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!control || !canEdit) return;
                  const wanted = Math.floor(addRowCount);
                  if (!Number.isFinite(wanted) || wanted < 1) {
                    failNotice("Isi jumlah baris minimal 1.");
                    return;
                  }
                  const added = control.appendRows(wanted);
                  if (added === 0)
                    failNotice(
                      `Workspace sudah mencapai kapasitas ${MAX_ROWS.toLocaleString("id-ID")} baris. Simpan lalu muat ulang.`,
                    );
                  else
                    setNotice(
                      added < wanted
                        ? `${added.toLocaleString("id-ID")} baris ditambahkan — kapasitas ${MAX_ROWS.toLocaleString("id-ID")} baris tercapai.`
                        : `${added.toLocaleString("id-ID")} baris kosong ditambahkan di bawah.`,
                    );
                }}
              >
                <button
                  type="submit"
                  className="manual-btn"
                  disabled={!canEdit || !control}
                >
                  Tambah
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label="Jumlah baris yang ditambahkan"
                  // "1.000", like every other count in this column.
                  value={
                    Number.isFinite(addRowCount)
                      ? addRowCount.toLocaleString("id-ID")
                      : ""
                  }
                  disabled={!canEdit || !control}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/\D/g, "");
                    setAddRowCount(
                      digits ? Math.min(MAX_ROWS, Number(digits)) : Number.NaN,
                    );
                  }}
                />
                <span aria-hidden="true">baris kosong</span>
              </form>
            )}
          </footer>
        </div>
      </div>
      {attempt && !mutation.isPending && !saving && (
        <div className="manual-error">
          Hasil simpan belum pasti. Editing ditahan agar retry memakai payload
          dan kunci yang sama.{" "}
          <button className="manual-btn" onClick={() => void save(attempt)}>
            Ulangi simpan yang sama
          </button>{" "}
          <button
            className="manual-btn manual-danger-quiet"
            onClick={() => void discardAttempt()}
          >
            Buang percobaan & muat ulang
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
                {bulkImport.summary.skippedBeforeHeader
                  ? ` ${bulkImport.summary.skippedBeforeHeader} baris di atas judul kolom dilewati.`
                  : ""}
              </p>
              {bulkImport.summary.rejections.length > 0 && (
                <>
                  <ul className="manual-errors">
                    {bulkImport.summary.rejections.slice(0, 20).map((item) => (
                      <li key={`${item.row}-${item.field}-${item.message}`}>
                        {/* Nomor baris FILE, bukan nomor grid: baris ini
                            tidak pernah ada di grid, dan yang dicari orang
                            adalah barisnya di spreadsheet asal. */}
                        Baris file {item.row.toLocaleString("id-ID")} ·{" "}
                        {item.field}: {item.message}
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
        onAbandon={() => void abandonVoid()}
        onConfirm={(reason) => void submitVoid(reason)}
      />
    </section>
  );
}

interface ImportUndo {
  /** Nama file (dan sheet) untuk pesan. */
  source: string;
  /** Baris sheet pertama yang ditulis impor (1-based). */
  row: number;
  /** Isi tiap baris rentang sebelum impor, beserta baseline tersimpannya. */
  before: { cells: string[]; original: DraftRow["original"] }[];
  /** Isi yang ditulis impor, untuk tahu baris mana yang diubah sesudahnya. */
  written: string[][];
  /** Kunci baris grid di rentang itu, saat impor. */
  keys: string[];
}

function importEnd(undo: ImportUndo) {
  return undo.row + undo.keys.length - 1;
}

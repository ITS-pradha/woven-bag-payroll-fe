import { useConfirm } from "../../../components/confirm-dialog/use-confirm";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiClientError } from "../../../api/client/api-result";
import {
  createHrisSync,
  createPayrollPeriod,
  createPayrollRun,
  getHrisSync,
  listPayrollRuns,
  lockPayrollRun,
  reviewPayrollRun,
  type PayrollRun,
} from "../api/summary-api";
import {
  finalAttendanceQueryOptions,
  payrollPeriodsQueryOptions,
  payrollRunQueryOptions,
  payrollRunsQueryKey,
  selectableRateVersionsQueryOptions,
} from "../api/summary-queries";
import {
  defaultRateSelection,
  selectedRateVersionIds,
  type MachineGroup,
  type RateSelection,
} from "../model/rate-selection";
import { defaultPayrollPeriod } from "../model/summary-draft";
import {
  GeneratePayrollForm,
  type RatePickerState,
} from "./generate-payroll-form";
import { PayrollRunSelector } from "./payroll-run-selector";
import { PayrollTransitionDialog } from "./payroll-transition-dialog";
import { SummaryWorkspace } from "./summary-workspace";

interface SummaryPageProps {
  canRead: boolean;
  canGenerate: boolean;
  canOverride: boolean;
  canReview: boolean;
  canLock: boolean;
  canSync: boolean;
  /** Daftar versi harga butuh `rates.read`; tanpanya generate BY_SHIFT_START. */
  canReadRates: boolean;
  csrfToken: string;
}

/**
 * Run yang boleh di-generate ulang. Tidak untuk yang masih QUEUED/CALCULATING
 * (hasilnya belum ada), dan tidak untuk LOCKED: payroll terkunci dikoreksi
 * lewat adjustment, bukan dengan run pengganti di sampingnya.
 */
const REGENERATABLE: ReadonlySet<PayrollRun["status"]> = new Set([
  "GENERATED",
  "REVIEWED",
  "FAILED",
  "CANCELLED",
]);

interface GenerateAttempt {
  periodKey: string;
  runKey: string;
}

export function SummaryPage(props: SummaryPageProps) {
  const confirm = useConfirm();
  const {
    canRead,
    canGenerate,
    canOverride,
    canReview,
    canLock,
    canSync,
    canReadRates,
    csrfToken,
  } = props;
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialPeriod = defaultPayrollPeriod(todayInJakarta());
  const [periodStart, setPeriodStart] = useState(initialPeriod.periodStart);
  const [periodEnd, setPeriodEnd] = useState(initialPeriod.periodEnd);
  const [requestedRunId, setRequestedRunId] = useState(
    searchParams.get("run") ?? "",
  );
  const [generateAttempt, setGenerateAttempt] =
    useState<GenerateAttempt | null>(null);
  /**
   * Satu kunci idempotensi per run sumber, dipakai ulang saat percobaan yang
   * sama diulang (jaringan putus), supaya klik kedua tidak membuat dua run.
   */
  const [regenerateAttempt, setRegenerateAttempt] = useState<{
    sourceRunId: string;
    rateVersionIds: string;
    key: string;
  } | null>(null);
  /** Hanya pilihan yang diubah pengguna; sisanya default dari daftar versi. */
  const [ratePicks, setRatePicks] = useState<RateSelection>({});
  const [transition, setTransition] = useState<"review" | "lock" | null>(null);
  const [transitionError, setTransitionError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [summaryDirty, setSummaryDirty] = useState(false);
  const filter = { periodStart, periodEnd, departmentCode: "LOOM" };
  const payrollPeriods = useQuery({
    ...payrollPeriodsQueryOptions(filter),
    enabled: canRead && validPeriod(periodStart, periodEnd),
  });
  const attendancePeriods = useQuery({
    ...finalAttendanceQueryOptions(filter),
    enabled: canRead && validPeriod(periodStart, periodEnd),
  });
  const attendance = attendancePeriods.data
    ? [...attendancePeriods.data.data].sort(
        (a, b) => b.hrisRevision - a.hrisRevision,
      )[0]
    : undefined;
  const runsQuery = useInfiniteQuery({
    queryKey: payrollRunsQueryKey,
    queryFn: ({ signal, pageParam }) => listPayrollRuns(signal, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.page.nextCursor ?? undefined,
    enabled: canRead,
  });
  const runs = runsQuery.data?.pages.flatMap((page) => page.data) ?? [];
  const selectedRunId = requestedRunId || runs[0]?.id || "";
  const runQuery = useQuery(payrollRunQueryOptions(selectedRunId));
  const selectedRun =
    runQuery.data ?? runs.find((run) => run.id === selectedRunId);

  const rateVersions = useQuery(
    selectableRateVersionsQueryOptions(canGenerate && canReadRates),
  );
  const rateSelection: RateSelection = rateVersions.data
    ? {
        ...defaultRateSelection(rateVersions.data, todayInJakarta()),
        ...ratePicks,
      }
    : {};
  const pickedIds = selectedRateVersionIds(rateSelection);
  /** Tidak dikirim = BY_SHIFT_START, perilaku lama untuk akun tanpa akses harga. */
  const rateVersionIds =
    canReadRates && pickedIds.length > 0 ? pickedIds : undefined;
  const ratePicker: RatePickerState = !canReadRates
    ? { kind: "no-access" }
    : rateVersions.isPending
      ? { kind: "loading" }
      : rateVersions.isError
        ? {
            kind: "error",
            message: apiMessage(rateVersions.error),
            onRetry: () => void rateVersions.refetch(),
          }
        : {
            kind: "ready",
            versions: rateVersions.data,
            selection: rateSelection,
            onChange: (group: MachineGroup, id: string) => {
              setRatePicks((picks) => ({ ...picks, [group]: id }));
              // A retried key would hand back the run made with the old pick.
              setGenerateAttempt(null);
            },
          };

  const generateMutation = useMutation({
    mutationFn: async (attempt: GenerateAttempt) => {
      if (!attendance)
        throw new Error("Attendance periode ini belum dikonfirmasi HRD.");
      const existing = payrollPeriods.data?.data.find(
        (item) =>
          item.periodStart === periodStart && item.periodEnd === periodEnd,
      );
      const period =
        existing ??
        (await createPayrollPeriod(
          {
            key: attempt.periodKey,
            body: {
              code: `LOOM-${periodEnd.slice(0, 7)}`,
              periodStart,
              periodEnd,
              departmentCode: "LOOM",
            },
          },
          csrfToken,
        ));
      return createPayrollRun(
        {
          key: attempt.runKey,
          body: {
            periodId: period.id,
            attendancePeriodId: attendance.id,
            ...(rateVersionIds ? { rateVersionIds } : {}),
          },
        },
        csrfToken,
      );
    },
    onSuccess: (run) => {
      queryClient.setQueryData(payrollRunQueryOptions(run.id).queryKey, run);
      void queryClient.invalidateQueries({
        queryKey: payrollRunsQueryKey,
        exact: true,
      });
      setRequestedRunId(run.id);
      setSearchParams({ run: run.id }, { replace: true });
      setGenerateAttempt(null);
      setMessage("Payroll masuk antrean dan akan diperbarui otomatis.");
      setError("");
    },
    onError: (cause) => {
      setMessage("");
      setError(apiMessage(cause));
    },
  });

  /**
   * Generate ulang = run BARU untuk buku dan attendance yang sama dengan run
   * yang sedang dibuka, dihitung dari data produksi dan tarif saat ini. Run
   * lama tidak diubah dan tetap ada di histori; override-nya tidak ikut.
   */
  const regenerateMutation = useMutation({
    mutationFn: ({
      source,
      key,
      rateVersionIds: ids,
    }: {
      source: PayrollRun;
      key: string;
      rateVersionIds: string[] | undefined;
    }) =>
      createPayrollRun(
        {
          key,
          body: {
            periodId: source.periodId,
            attendancePeriodId: source.attendancePeriodId,
            ...(ids ? { rateVersionIds: ids } : {}),
          },
        },
        csrfToken,
      ),
    onSuccess: (run) => {
      queryClient.setQueryData(payrollRunQueryOptions(run.id).queryKey, run);
      void queryClient.invalidateQueries({
        queryKey: payrollRunsQueryKey,
        exact: true,
      });
      setRequestedRunId(run.id);
      setSearchParams({ run: run.id }, { replace: true });
      setRegenerateAttempt(null);
      setMessage(
        `Run #${run.runNo} masuk antrean dan akan diperbarui otomatis.`,
      );
      setError("");
    },
    onError: (cause) => {
      setMessage("");
      setError(apiMessage(cause));
    },
  });
  const canRegenerate =
    canGenerate &&
    selectedRun !== undefined &&
    REGENERATABLE.has(selectedRun.status);

  const syncMutation = useMutation({
    mutationFn: async () => {
      const started = await createHrisSync(
        { key: crypto.randomUUID(), body: filter },
        csrfToken,
      );
      return waitForHrisSync(started.syncId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance-periods"] });
      setError("");
      setMessage("Attendance FINAL berhasil ditarik dari HRIS.");
    },
    onError: (cause) => {
      setMessage("");
      setError(apiMessage(cause));
    },
  });

  const transitionMutation = useMutation({
    mutationFn: ({
      mode,
      note,
      key,
      run,
    }: {
      mode: "review" | "lock";
      note: string;
      key: string;
      run: PayrollRun;
    }) => {
      const attempt = {
        key,
        body: { expectedRunVersion: run.runVersion, note },
      };
      return mode === "review"
        ? reviewPayrollRun(run.id, attempt, csrfToken)
        : lockPayrollRun(run.id, attempt, csrfToken);
    },
    onSuccess: (run) => {
      queryClient.setQueryData(payrollRunQueryOptions(run.id).queryKey, run);
      void queryClient.invalidateQueries({
        queryKey: payrollRunsQueryKey,
        exact: true,
      });
      setTransition(null);
      setTransitionError("");
      setMessage(
        run.status === "LOCKED"
          ? "Payroll berhasil dikunci."
          : "Payroll berhasil ditandai sudah direview.",
      );
    },
    onError: (cause) => setTransitionError(apiMessage(cause)),
  });

  if (!canRead) return <Forbidden />;
  return (
    <div className="workspace-page space-y-1.5">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <div className="mr-auto min-w-52">
          <p className="text-[0.625rem] font-bold uppercase tracking-wider text-brand-strong">
            Periode payroll
          </p>
          <h1 className="text-base font-bold">Summary</h1>
          <p className="text-[0.6875rem] text-muted">
            Generate, periksa, override, lalu kunci payroll.
          </p>
        </div>
        {canRegenerate && selectedRun ? (
          <button
            type="button"
            className="min-h-8 border border-border-strong px-3 text-xs font-semibold disabled:text-disabled"
            disabled={
              regenerateMutation.isPending ||
              generateMutation.isPending ||
              ratePicker.kind === "loading" ||
              ratePicker.kind === "error"
            }
            title="Hitung ulang dari data produksi terbaru dan versi harga yang dipilih di bawah, sebagai run baru. Run ini tetap tersimpan di histori."
            onClick={async () => {
              const source = selectedRun;
              if (
                !(await confirm({
                  title: `Generate ulang run #${source.runNo}?`,
                  message: (
                    <>
                      <p>
                        Payroll dihitung ulang sebagai run baru untuk periode
                        dan attendance yang sama, memakai data produksi saat
                        ini. Run #{source.runNo} tidak diubah dan tetap ada di
                        histori.
                      </p>
                      <p className="mt-2">
                        Versi harga:{" "}
                        {rateVersionIds
                          ? rateVersionIds
                              .map(
                                (id) =>
                                  rateVersions.data?.find(
                                    (version) => version.id === id,
                                  )?.code ?? id,
                              )
                              .join(", ")
                          : "otomatis per tanggal shift"}
                        .
                      </p>
                      <p className="mt-2">
                        Override base/bonus di run #{source.runNo} tidak ikut
                        dibawa ke run baru.
                        {summaryDirty
                          ? " Perubahan summary yang belum disimpan akan dibuang."
                          : ""}
                      </p>
                    </>
                  ),
                  confirmLabel: "Generate ulang",
                }))
              )
                return;
              setSummaryDirty(false);
              const signature = (rateVersionIds ?? []).join(",");
              const attempt =
                regenerateAttempt?.sourceRunId === source.id &&
                regenerateAttempt.rateVersionIds === signature
                  ? regenerateAttempt
                  : {
                      sourceRunId: source.id,
                      rateVersionIds: signature,
                      key: crypto.randomUUID(),
                    };
              setRegenerateAttempt(attempt);
              regenerateMutation.mutate({
                source,
                key: attempt.key,
                rateVersionIds,
              });
            }}
          >
            {regenerateMutation.isPending ? "Menjadwalkan…" : "Generate ulang"}
          </button>
        ) : null}
        {selectedRun?.status === "GENERATED" && canReview ? (
          <button
            type="button"
            className="min-h-8 border border-border-strong px-3 text-xs font-semibold disabled:text-disabled"
            disabled={summaryDirty}
            title={
              summaryDirty
                ? "Simpan atau batalkan perubahan sebelum review."
                : undefined
            }
            onClick={() => {
              setTransitionError("");
              setTransition("review");
            }}
          >
            Tandai direview
          </button>
        ) : null}
        {selectedRun?.status === "REVIEWED" && canLock ? (
          <button
            type="button"
            className="min-h-8 rounded bg-brand px-3 text-xs font-bold text-white disabled:bg-brand-disabled"
            disabled={selectedRun.blockingExceptionCount > 0}
            title={
              selectedRun.blockingExceptionCount > 0
                ? "Selesaikan exception blocking sebelum lock."
                : undefined
            }
            onClick={() => {
              setTransitionError("");
              setTransition("lock");
            }}
          >
            Kunci payroll
          </button>
        ) : null}
      </header>
      <GeneratePayrollForm
        periodStart={periodStart}
        periodEnd={periodEnd}
        attendance={attendance}
        attendanceLoading={attendancePeriods.isPending}
        canGenerate={canGenerate}
        generating={generateMutation.isPending}
        canSync={canSync}
        rates={ratePicker}
        syncing={syncMutation.isPending}
        onSync={() => {
          setMessage("");
          setError("");
          syncMutation.mutate();
        }}
        onPeriodStartChange={(value) => {
          setPeriodStart(value);
          setGenerateAttempt(null);
        }}
        onPeriodEndChange={(value) => {
          setPeriodEnd(value);
          setGenerateAttempt(null);
        }}
        onGenerate={async () => {
          if (
            summaryDirty &&
            !(await confirm({
              title: "Generate baru dan buang perubahan?",
              message:
                "Perubahan summary belum disimpan. Generate payroll baru akan membuang perubahan tersebut.",
              confirmLabel: "Buang dan generate",
              tone: "danger",
            }))
          )
            return;
          setSummaryDirty(false);
          const attempt = generateAttempt ?? {
            periodKey: crypto.randomUUID(),
            runKey: crypto.randomUUID(),
          };
          setGenerateAttempt(attempt);
          generateMutation.mutate(attempt);
        }}
      />
      {message ? (
        <p
          role="status"
          className="border border-success-border bg-success-soft px-3 py-1.5 text-xs font-semibold text-success-strong"
        >
          {message}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="border border-danger/30 bg-surface px-3 py-1.5 text-xs text-danger"
        >
          {error}
        </p>
      ) : null}
      {runsQuery.isPending ? (
        <div
          aria-busy="true"
          aria-label="Memuat histori payroll"
          className="h-16 animate-pulse border border-border bg-surface-muted"
        />
      ) : null}
      {runsQuery.isError ? (
        <ErrorHistory onRetry={() => void runsQuery.refetch()} />
      ) : null}
      {runs.length ? (
        <PayrollRunSelector
          runs={runs}
          selected={selectedRun}
          onSelect={async (id) => {
            if (
              summaryDirty &&
              !(await confirm({
                title: "Ganti payroll dan buang perubahan?",
                message:
                  "Perubahan summary belum disimpan. Membuka payroll lain akan membuang perubahan tersebut.",
                confirmLabel: "Buang dan ganti payroll",
                tone: "danger",
              }))
            )
              return;
            setSummaryDirty(false);
            setRequestedRunId(id);
            setSearchParams({ run: id }, { replace: true });
          }}
          hasMore={Boolean(runsQuery.hasNextPage)}
          loadingMore={runsQuery.isFetchingNextPage}
          onLoadMore={() => void runsQuery.fetchNextPage()}
        />
      ) : null}
      {!runsQuery.isPending && !runsQuery.isError && !runs.length ? (
        <EmptyRuns />
      ) : null}
      {runQuery.isPending && selectedRunId ? (
        <div
          aria-busy="true"
          aria-label="Memuat payroll run"
          className="h-64 animate-pulse border border-border bg-surface-muted"
        />
      ) : null}
      {runQuery.isError ? (
        <ErrorHistory onRetry={() => void runQuery.refetch()} />
      ) : null}
      {selectedRun ? (
        <SummaryWorkspace
          key={selectedRun.id}
          run={selectedRun}
          canOverride={canOverride}
          csrfToken={csrfToken}
          onDirtyChange={setSummaryDirty}
        />
      ) : null}
      {transition && selectedRun ? (
        <PayrollTransitionDialog
          mode={transition}
          run={selectedRun}
          pending={transitionMutation.isPending}
          error={transitionError}
          onClose={() => {
            if (!transitionMutation.isPending) setTransition(null);
          }}
          onConfirm={(note) =>
            transitionMutation.mutate({
              mode: transition,
              note,
              key: crypto.randomUUID(),
              run: selectedRun,
            })
          }
        />
      ) : null}
    </div>
  );
}

const SYNC_POLL_INTERVAL_MS = 1_500;
const SYNC_POLL_LIMIT_MS = 90_000;

/**
 * The sync runs in the payroll worker, so the request only queues it. A job
 * that never leaves QUEUED almost always means the worker is not running;
 * saying so beats a spinner that never ends.
 */
async function waitForHrisSync(syncId: string) {
  const deadline = Date.now() + SYNC_POLL_LIMIT_MS;
  let lastFailure = "";

  while (Date.now() < deadline) {
    const sync = await getHrisSync(syncId);
    if (sync.status === "COMPLETED") return sync;
    lastFailure = sync.failure?.error.message ?? lastFailure;
    if (sync.status === "FAILED")
      throw new Error(lastFailure || "Sinkronisasi HRIS gagal.");
    await new Promise((resolve) => setTimeout(resolve, SYNC_POLL_INTERVAL_MS));
  }

  throw new Error(
    lastFailure
      ? `Sinkronisasi HRIS belum berhasil: ${lastFailure}`
      : "Sinkronisasi HRIS masih mengantre. Pastikan worker payroll (npm run worker) berjalan, lalu coba lagi.",
  );
}

function todayInJakarta() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function validPeriod(start: string, end: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(start) &&
    /^\d{4}-\d{2}-\d{2}$/.test(end) &&
    start <= end
  );
}
function apiMessage(cause: unknown) {
  if (cause instanceof ApiClientError) {
    if (cause.code === "SYNC_IN_PROGRESS")
      return "Sinkronisasi HRIS periode ini masih berjalan. Tunggu sebentar lalu muat ulang.";
    if (cause.code === "ATTENDANCE_NOT_FINAL")
      return "HRD belum mengonfirmasi attendance periode ini.";
    if (cause.code === "RUN_VERSION_CONFLICT")
      return "Payroll sudah diubah pengguna lain. Muat ulang lalu coba kembali.";
    if (cause.code === "BLOCKING_EXCEPTION_OPEN")
      return "Payroll belum dapat dikunci karena masih ada exception blocking.";
    return cause.message;
  }
  return cause instanceof Error
    ? cause.message
    : "Permintaan belum dapat diproses.";
}
function Forbidden() {
  return (
    <section role="alert" className="border border-border bg-surface p-5">
      <h1 className="text-lg font-bold">Summary</h1>
      <p className="mt-2 text-sm text-muted">
        Akun Anda belum memiliki izin melihat payroll.
      </p>
    </section>
  );
}
function EmptyRuns() {
  return (
    <section className="border border-border bg-surface p-6 text-center">
      <h2 className="text-sm font-bold">Belum ada payroll</h2>
      <p className="mt-1 text-xs text-muted">
        Pilih periode yang sudah difinalisasi HRD di HRIS, tekan Tarik dari
        HRIS, lalu Generate payroll.
      </p>
    </section>
  );
}
function ErrorHistory({ onRetry }: { onRetry: () => void }) {
  return (
    <section
      role="alert"
      className="flex items-center justify-between border border-danger/30 bg-surface p-4 text-xs"
    >
      <p>Data payroll belum dapat dimuat.</p>
      <button
        type="button"
        className="min-h-8 border border-border-strong px-3 font-semibold"
        onClick={onRetry}
      >
        Coba lagi
      </button>
    </section>
  );
}

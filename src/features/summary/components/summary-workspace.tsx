import { useConfirm } from "../../../components/confirm-dialog/use-confirm";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ApiClientError } from "../../../api/client/api-result";
import { savePayrollOverrides, type PayrollRun } from "../api/summary-api";
import {
  payrollRunsQueryKey,
  payrollSummariesQueryOptions,
} from "../api/summary-queries";
import {
  applyOverrideMatrix,
  normalizeMoneyInput,
  parseOverrideMatrix,
  type OverrideField,
} from "../model/summary-draft";
import { SummaryMetrics } from "./summary-metrics";
import { SummaryTable, type SummaryDraftValue } from "./summary-table";
import { SummaryToolbar, type SummaryViewFilter } from "./summary-toolbar";
import {
  MetricsSkeleton,
  TableSkeleton,
} from "../../../components/skeleton/skeleton";
import { SUMMARY_COLUMNS } from "../model/table-layout";

const terminalStatuses = new Set(["GENERATED", "REVIEWED", "LOCKED"]);

export function SummaryWorkspace({
  run,
  canOverride,
  csrfToken,
  onDirtyChange,
}: {
  run: PayrollRun;
  canOverride: boolean;
  csrfToken: string;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<SummaryViewFilter>("ALL");
  const [filter, setFilter] = useState({
    query: "",
    view: "ALL" as SummaryViewFilter,
  });
  const [pageSize, setPageSize] = useState(100);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState(new Set<string>());
  const [drafts, setDrafts] = useState(new Map<string, SummaryDraftValue>());
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [attemptKey, setAttemptKey] = useState<string | null>(null);
  const ready = terminalStatuses.has(run.status);
  const editable = run.status === "GENERATED" && canOverride;
  const summariesQuery = useQuery({
    ...payrollSummariesQueryOptions(run.id, {
      query: filter.query,
      pageSize,
      ...(cursors[pageIndex] ? { after: cursors[pageIndex] } : {}),
      ...(filter.view === "OVERRIDE" ? { hasOverride: true } : {}),
      ...(filter.view === "BLOCKING" ? { hasBlockingException: true } : {}),
    }),
    enabled: ready,
  });
  const rows = summariesQuery.data?.data ?? [];

  useEffect(() => {
    onDirtyChange(drafts.size > 0);
  }, [drafts.size, onDirtyChange]);

  useEffect(() => {
    if (drafts.size === 0) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [drafts.size]);

  const saveMutation = useMutation({
    mutationFn: (key: string) => {
      const payloadRows = rows
        .filter((row) => drafts.has(row.pin))
        .map((row) => {
          const draft = drafts.get(row.pin);
          const basePay = normalizeMoneyInput(draft?.basePay ?? "");
          const bonusPay = normalizeMoneyInput(draft?.bonusPay ?? "");
          if (basePay === null || bonusPay === null)
            throw new Error(`Nominal ${row.employeeName} belum valid.`);
          return {
            clientRowId: `${row.pin}-${row.rowVersion}`,
            pin: row.pin,
            expectedRowVersion: row.rowVersion,
            basePay,
            bonusPay,
            reason: reason.trim(),
          };
        });
      return savePayrollOverrides(
        run.id,
        {
          key,
          body: { expectedRunVersion: run.runVersion, rows: payloadRows },
        },
        csrfToken,
      );
    },
    onSuccess: (result) => {
      const rejected = new Set(
        result.rejected.map((item) => item.clientRowId.split("-")[0]),
      );
      setDrafts(
        (current) => new Map([...current].filter(([pin]) => rejected.has(pin))),
      );
      setAttemptKey(null);
      setMessage(
        result.rejected.length
          ? `${result.updated.length} tersimpan, ${result.rejected.length} perlu diperbaiki.`
          : `${result.updated.length} override berhasil disimpan.`,
      );
      setError("");
      queryClient.setQueryData(
        [...payrollRunsQueryKey, run.id],
        (current: PayrollRun | undefined) =>
          current ? { ...current, runVersion: result.runVersion } : current,
      );
      void queryClient.invalidateQueries({
        queryKey: [...payrollRunsQueryKey, run.id, "summaries"],
      });
    },
    onError: (cause) => {
      setMessage("");
      setError(summaryError(cause));
    },
  });

  function changeValue(pin: string, field: OverrideField, value: string) {
    const baseline = rows.find((row) => row.pin === pin);
    if (!baseline) return;
    setDrafts((current) => {
      const next = new Map(current);
      const previous = next.get(pin) ?? {
        basePay: baseline.basePay,
        bonusPay: baseline.bonusPay,
      };
      next.set(pin, { ...previous, [field]: value });
      return next;
    });
    setAttemptKey(null);
    setMessage("");
  }

  function paste(pin: string, field: OverrideField, text: string) {
    try {
      const source = rows.map((row) => ({
        pin: row.pin,
        basePay: drafts.get(row.pin)?.basePay ?? row.basePay,
        bonusPay: drafts.get(row.pin)?.bonusPay ?? row.bonusPay,
      }));
      const next = applyOverrideMatrix(
        source,
        selected,
        pin,
        parseOverrideMatrix(text),
        field,
      );
      const changed = new Map(drafts);
      next.forEach((row, index) => {
        const old = source[index];
        if (
          !old ||
          (old.basePay === row.basePay && old.bonusPay === row.bonusPay)
        )
          return;
        changed.set(row.pin, { basePay: row.basePay, bonusPay: row.bonusPay });
      });
      setDrafts(changed);
      setAttemptKey(null);
      setError("");
      setMessage(`${changed.size} baris siap disimpan.`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Data clipboard tidak valid.",
      );
    }
  }

  async function copySelected() {
    const text = rows
      .filter((row) => selected.has(row.pin))
      .map((row) => {
        const draft = drafts.get(row.pin);
        return `${draft?.basePay ?? row.basePay}\t${draft?.bonusPay ?? row.bonusPay}`;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`${selected.size} baris disalin.`);
    } catch {
      setError("Clipboard tidak dapat diakses. Salin langsung dari sel tabel.");
    }
  }

  async function pasteSelected() {
    try {
      const first = rows.find((row) => selected.has(row.pin));
      if (!first) return;
      paste(first.pin, "basePay", await navigator.clipboard.readText());
    } catch {
      setError(
        "Clipboard tidak dapat dibaca. Tempel langsung pada kolom Base pay.",
      );
    }
  }

  function discardDrafts() {
    setDrafts(new Map());
    setAttemptKey(null);
    setError("");
    setMessage("Perubahan dibatalkan.");
  }

  async function confirmDiscardDrafts() {
    if (drafts.size === 0) return true;
    const discard = await confirm({
      title: "Buang perubahan?",
      message: `${drafts.size.toLocaleString("id-ID")} perubahan belum disimpan. Lanjutkan dan buang perubahan tersebut?`,
      confirmLabel: "Buang perubahan",
      tone: "danger",
    });
    if (discard) discardDrafts();
    return discard;
  }

  if (!ready) return <RunProgress run={run} />;
  if (summariesQuery.isPending)
    return <SummaryLoading label="Memuat summary" />;
  if (summariesQuery.isError)
    return <ErrorState onRetry={() => void summariesQuery.refetch()} />;

  return (
    <div className="flex min-h-[calc(100vh-21rem)] flex-col gap-1.5">
      {summariesQuery.data ? (
        <SummaryMetrics
          aggregate={summariesQuery.data.aggregate}
          pinCount={run.pinCount}
        />
      ) : null}
      <SummaryToolbar
        query={query}
        view={view}
        reason={reason}
        selectedCount={selected.size}
        dirtyCount={drafts.size}
        editable={editable}
        saving={saveMutation.isPending}
        onQueryChange={setQuery}
        onViewChange={setView}
        onReasonChange={setReason}
        onApplyFilter={async () => {
          if (!(await confirmDiscardDrafts())) return;
          setFilter({ query: query.trim(), view });
          setCursors([undefined]);
          setPageIndex(0);
          setSelected(new Set());
        }}
        onCopy={() => void copySelected()}
        onPaste={() => void pasteSelected()}
        onDiscard={discardDrafts}
        onSave={() => {
          const key = attemptKey ?? crypto.randomUUID();
          setAttemptKey(key);
          saveMutation.mutate(key);
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
      {rows.length ? (
        <SummaryTable
          runId={run.id}
          rows={rows}
          drafts={drafts}
          selected={selected}
          editable={editable}
          onSelect={(pin, checked) =>
            setSelected((current) => {
              const next = new Set(current);
              if (checked) next.add(pin);
              else next.delete(pin);
              return next;
            })
          }
          onSelectAll={(checked) =>
            setSelected(
              checked ? new Set(rows.map((row) => row.pin)) : new Set(),
            )
          }
          onChange={changeValue}
          onPaste={paste}
        />
      ) : (
        <div className="grid min-h-52 place-items-center border border-border bg-surface text-center">
          <div>
            <h2 className="text-sm font-bold">Tidak ada karyawan</h2>
            <p className="mt-1 text-xs text-muted">
              Ubah pencarian atau filter yang digunakan.
            </p>
          </div>
        </div>
      )}
      <Pagination
        pageIndex={pageIndex}
        pageSize={pageSize}
        hasNext={Boolean(summariesQuery.data?.page.hasNextPage)}
        onPageSize={async (size) => {
          if (!(await confirmDiscardDrafts())) return;
          setPageSize(size);
          setCursors([undefined]);
          setPageIndex(0);
        }}
        onPrevious={async () => {
          if (!(await confirmDiscardDrafts())) return;
          setPageIndex((value) => Math.max(0, value - 1));
        }}
        onNext={async () => {
          if (!(await confirmDiscardDrafts())) return;
          const next = summariesQuery.data?.page.nextCursor;
          if (!next) return;
          setCursors((current) => [...current.slice(0, pageIndex + 1), next]);
          setPageIndex((value) => value + 1);
        }}
      />
    </div>
  );
}

function summaryError(cause: unknown) {
  if (cause instanceof ApiClientError) {
    if (cause.code === "RUN_VERSION_CONFLICT")
      return "Payroll sudah diubah pengguna lain. Draft tetap disimpan; muat ulang sebelum mencoba lagi.";
    if (cause.code === "PAYROLL_NOT_EDITABLE")
      return "Payroll sudah direview atau dikunci dan tidak dapat diubah.";
    return cause.message;
  }
  return cause instanceof Error
    ? cause.message
    : "Permintaan belum dapat diproses.";
}

function RunProgress({ run }: { run: PayrollRun }) {
  const content =
    run.status === "FAILED"
      ? {
          title: "Generate payroll gagal",
          detail: "Periksa penyebab kegagalan lalu jalankan generate kembali.",
          tone: "border-danger/30 bg-surface text-danger",
        }
      : run.status === "CANCELLED"
        ? {
            title: "Payroll dibatalkan",
            detail:
              "Run ini tidak menghasilkan summary. Pilih run lain atau generate kembali.",
            tone: "border-warning-border bg-warning-soft text-warning-strong",
          }
        : {
            title: "Payroll sedang dihitung",
            detail:
              "Halaman akan memperbarui status secara otomatis. Anda boleh membuka menu lain.",
            tone: "border-info-border bg-info-soft text-info-strong",
          };
  return (
    <section
      aria-live="polite"
      className={`border p-6 text-center ${content.tone}`}
    >
      <h2 className="text-sm font-bold">{content.title}</h2>
      <p className="mt-1 text-xs">{content.detail}</p>
    </section>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <section
      role="alert"
      className="flex items-center justify-between border border-danger/30 bg-surface p-4 text-xs"
    >
      <p>Summary belum dapat dimuat.</p>
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

function Pagination({
  pageIndex,
  pageSize,
  hasNext,
  onPageSize,
  onPrevious,
  onNext,
}: {
  pageIndex: number;
  pageSize: number;
  hasNext: boolean;
  onPageSize: (size: number) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <footer className="sticky bottom-0 z-10 shadow-[0_-4px_8px_-6px_rgb(15_23_42/0.25)] flex items-center justify-end gap-2 border border-border bg-surface px-2 py-1 text-[0.6875rem]">
      <label>
        Baris{" "}
        <select
          aria-label="Baris per halaman"
          className="h-7 border border-border-strong bg-surface px-1"
          value={pageSize}
          onChange={(event) => onPageSize(Number(event.target.value))}
        >
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="250">250</option>
        </select>
      </label>
      <span>Halaman {pageIndex + 1}</span>
      <button
        type="button"
        className="h-7 border border-border-strong px-2 font-semibold disabled:text-disabled"
        disabled={pageIndex === 0}
        onClick={onPrevious}
      >
        Sebelumnya
      </button>
      <button
        type="button"
        className="h-7 border border-border-strong px-2 font-semibold disabled:text-disabled"
        disabled={!hasNext}
        onClick={onNext}
      >
        Berikutnya
      </button>
    </footer>
  );
}

/** Metrik + tabel Summary dalam bentuk kerangka; datanya muncul di tempat. */
export function SummaryLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <MetricsSkeleton count={5} />
      <TableSkeleton
        label={label}
        height="calc(100vh - 24rem)"
        columns={SUMMARY_COLUMNS}
        align={[
          "center",
          "start",
          "start",
          "end",
          "end",
          "end",
          "end",
          "end",
          "end",
          "start",
          "center",
        ]}
      />
    </div>
  );
}

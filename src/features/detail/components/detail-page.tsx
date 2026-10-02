import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";

import { listDetailPayrollRuns, type PayrollSummary } from "../api/detail-api";
import { DetailSelector } from "./detail-selector";
import { DetailWorkspace, type DetailTab } from "./detail-workspace";
import { SelectorSkeleton } from "../../../components/skeleton/skeleton";
import { EmptyState } from "../../../components/empty-state/empty-state";
import { DetailEmptyBackdrop } from "./detail-empty-backdrop";

export function DetailPage({ canRead }: { canRead: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const runsQuery = useInfiniteQuery({
    queryKey: ["payroll-detail", "runs"],
    queryFn: ({ signal, pageParam }) =>
      listDetailPayrollRuns(signal, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.page.nextCursor ?? undefined,
    enabled: canRead,
  });
  const runs = runsQuery.data?.pages.flatMap((page) => page.data) ?? [];
  const requestedRunId = searchParams.get("run") ?? "";
  const runId = requestedRunId || runs[0]?.id || "";
  const pin = searchParams.get("pin") ?? "";
  const tab: DetailTab =
    searchParams.get("tab") === "attendance" ? "attendance" : "production";

  function setSelection(next: { run?: string; pin?: string; tab?: DetailTab }) {
    const params = new URLSearchParams(searchParams);
    if (next.run !== undefined) params.set("run", next.run);
    if (next.pin !== undefined) {
      if (next.pin) params.set("pin", next.pin);
      else params.delete("pin");
    }
    if (next.tab === "attendance") params.set("tab", "attendance");
    if (next.tab === "production") params.delete("tab");
    setSearchParams(params, { replace: true });
  }

  if (!canRead) return <Forbidden />;
  return (
    <div className="workspace-page space-y-1.5">
      <header className="border-b border-border bg-surface px-3 py-2">
        <p className="text-[0.625rem] font-bold uppercase tracking-wider text-brand-strong">
          Snapshot payroll
        </p>
        <h1 className="text-base font-bold">Detail</h1>
        <p className="text-[0.6875rem] text-muted">
          Telusuri hitungan produksi dan keputusan attendance per karyawan.
        </p>
      </header>
      {runsQuery.isPending ? <LoadingRuns /> : null}
      {runsQuery.isError ? (
        <ErrorRuns onRetry={() => void runsQuery.refetch()} />
      ) : null}
      {runs.length || requestedRunId ? (
        <DetailSelector
          runs={runs}
          runId={runId}
          selectedPin={pin}
          hasMoreRuns={Boolean(runsQuery.hasNextPage)}
          loadingMoreRuns={runsQuery.isFetchingNextPage}
          onRunChange={(nextRun) =>
            setSelection({ run: nextRun, pin: "", tab: "production" })
          }
          onEmployeeSelect={(employee: PayrollSummary) =>
            setSelection({ run: runId, pin: employee.pin, tab: "production" })
          }
          onLoadMoreRuns={() => void runsQuery.fetchNextPage()}
        />
      ) : null}
      {!runsQuery.isPending && !runsQuery.isError && !runs.length ? (
        <EmptyRuns />
      ) : null}
      {runId && pin ? (
        <DetailWorkspace
          key={`${runId}-${pin}`}
          runId={runId}
          pin={pin}
          tab={tab}
          onTabChange={(nextTab) => setSelection({ tab: nextTab })}
        />
      ) : runId ? (
        <PickEmployee />
      ) : null}
    </div>
  );
}

function LoadingRuns() {
  return <SelectorSkeleton label="Memuat histori payroll" />;
}

function ErrorRuns({ onRetry }: { onRetry: () => void }) {
  return (
    <section
      role="alert"
      className="flex items-center justify-between border border-danger/30 bg-surface p-3 text-xs"
    >
      <p>Histori payroll belum dapat dimuat.</p>
      <button
        type="button"
        className="h-7 border border-border-strong px-2 font-semibold"
        onClick={onRetry}
      >
        Coba lagi
      </button>
    </section>
  );
}

function EmptyRuns() {
  return (
    <EmptyState
      id="detail-empty-runs"
      icon="payroll"
      title="Belum ada payroll"
      description="Generate payroll di menu Summary sebelum membuka Detail."
      action={
        <Link to="/summary" className="empty-state-primary">
          Buka Summary
        </Link>
      }
      backdrop={<DetailEmptyBackdrop />}
      fill
    />
  );
}

function PickEmployee() {
  return (
    <EmptyState
      id="detail-pick-employee"
      icon="person"
      title="Pilih karyawan"
      description="Cari nama atau PIN pada kolom di atas untuk melihat rincian payroll."
      backdrop={<DetailEmptyBackdrop />}
      fill
    />
  );
}

function Forbidden() {
  return (
    <section role="alert" className="border border-border bg-surface p-5">
      <h1 className="text-lg font-bold">Detail</h1>
      <p className="mt-2 text-sm text-muted">
        Akun Anda belum memiliki izin melihat payroll.
      </p>
    </section>
  );
}

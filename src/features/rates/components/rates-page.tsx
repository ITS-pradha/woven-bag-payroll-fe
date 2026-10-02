import { useConfirm } from "../../../components/confirm-dialog/use-confirm";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  rateVersionQueryOptions,
  rateVersionsQueryKey,
} from "../api/rates-queries";
import { listRateVersions } from "../api/rates-api";
import { CreateRatePanel } from "./create-rate-panel";
import { CalculationPolicyEditor } from "./calculation-policy-editor";
import { RateEditor } from "./rate-editor";
import { RateVersionList } from "./rate-version-list";
import { StationGroupManager } from "./station-group-manager";
import {
  PanelSkeleton,
  TableSkeleton,
} from "../../../components/skeleton/skeleton";
import { EmptyState } from "../../../components/empty-state/empty-state";
import { RatesEmptyBackdrop } from "./rates-empty-backdrop";

type WorkspaceView = "rates" | "policy" | "stations";

interface RatesPageProps {
  canRead: boolean;
  canWrite: boolean;
  canApprove: boolean;
  csrfToken: string;
}

export function RatesPage({
  canRead,
  canWrite,
  canApprove,
  csrfToken,
}: RatesPageProps) {
  const confirm = useConfirm();
  const [requestedVersionId, setRequestedVersionId] = useState("");
  const [creating, setCreating] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [view, setView] = useState<WorkspaceView>("rates");
  const versionsQuery = useInfiniteQuery({
    queryKey: rateVersionsQueryKey,
    queryFn: ({ signal, pageParam }) => listRateVersions(signal, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.page.nextCursor ?? undefined,
    enabled: canRead,
  });
  const versions = versionsQuery.data?.pages.flatMap((page) => page.data) ?? [];
  const selectedId = requestedVersionId || versions[0]?.id || "";
  const selectedSummary = versions.find((version) => version.id === selectedId);
  const source =
    versions.find((version) => version.status === "ACTIVE") ?? selectedSummary;
  const detailsQuery = useQuery(
    rateVersionQueryOptions(view === "rates" ? selectedId : ""),
  );

  async function selectVersion(id: string) {
    if (id === selectedId) return;
    if (
      editorDirty &&
      !(await confirm({
        title: "Buang perubahan draft?",
        message:
          "Perubahan draft belum disimpan. Pindah versi akan membuang perubahan tersebut.",
        confirmLabel: "Buang dan pindah versi",
        tone: "danger",
      }))
    )
      return;
    setEditorDirty(false);
    setRequestedVersionId(id);
  }

  async function changeView(next: WorkspaceView) {
    if (next === view) return;
    if (
      editorDirty &&
      !(await confirm({
        title: "Buang perubahan?",
        message:
          "Perubahan belum disimpan. Pindah bagian akan membuang perubahan tersebut.",
        confirmLabel: "Buang dan pindah bagian",
        tone: "danger",
      }))
    )
      return;
    setEditorDirty(false);
    setCreating(false);
    setView(next);
  }

  if (!canRead) {
    return (
      <section className="border border-border bg-surface p-5" role="alert">
        <h1 className="text-lg font-bold">Konfigurasi Harga</h1>
        <p className="mt-2 text-sm text-muted">
          Akun Anda belum memiliki izin untuk melihat konfigurasi harga.
        </p>
      </section>
    );
  }

  return (
    <div className="workspace-page space-y-2">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <div className="mr-auto min-w-56">
          <p className="text-[0.625rem] font-bold uppercase tracking-wider text-brand-strong">
            Master data · effective-dated
          </p>
          <h1 className="text-base font-bold">Konfigurasi Harga</h1>
          <p className="text-[0.6875rem] text-muted">
            Kelola harga per width dan anyaman tanpa mengubah payroll lama.
          </p>
        </div>
        {/* Hidden while the list loads: without it the label cannot know whether this is the first version or a new one, and flips. */}
        {/* Without any version the empty state below carries the one
            "first version" button; this stays only to close an open form. */}
        {canWrite &&
        view === "rates" &&
        !versionsQuery.isPending &&
        (versions.length > 0 || creating) ? (
          <button
            type="button"
            className="min-h-8 border border-border-strong bg-surface px-3 text-xs font-semibold hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus disabled:text-disabled"
            disabled={editorDirty}
            title={
              editorDirty
                ? "Simpan atau batalkan perubahan draft terlebih dahulu."
                : undefined
            }
            onClick={() => setCreating((value) => !value)}
          >
            {creating
              ? "Tutup form"
              : source
                ? "Buat versi baru"
                : "Tambah konfigurasi harga"}
          </button>
        ) : null}
      </header>

      <nav
        aria-label="Bagian konfigurasi harga"
        className="flex overflow-x-auto border-b border-border bg-surface px-2"
      >
        {(
          [
            ["rates", "Tabel harga"],
            ["policy", "Aturan kalkulasi"],
            ["stations", "Kelompok mesin"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-current={view === value ? "page" : undefined}
            className={`min-h-8 shrink-0 border-b-2 px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-focus ${
              view === value
                ? "border-brand text-brand-strong"
                : "border-transparent text-muted hover:text-foreground"
            }`}
            onClick={() => changeView(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* About editing prices that exist; with none yet it is noise. */}
      {view === "rates" && versions.length > 0 ? (
        <div
          className="flex items-center gap-2 border border-success-border bg-success-soft px-3 py-2 text-xs text-success-strong"
          role="note"
        >
          <span
            aria-hidden="true"
            className="grid size-5 shrink-0 place-items-center rounded-full bg-success text-[0.625rem] font-bold text-white"
          >
            i
          </span>
          <p>
            <strong>Harga aktif dapat diedit langsung</strong> selama belum
            dipakai payroll yang terkunci. Payroll yang belum dikunci pada masa
            berlakunya harus di-generate ulang setelah perubahan. Untuk harga
            dengan tanggal berlaku baru, buat versi baru.
          </p>
        </div>
      ) : null}

      {view === "rates" && creating ? (
        <CreateRatePanel
          versions={versions}
          defaultSourceId={selectedSummary?.id ?? source?.id ?? ""}
          csrfToken={csrfToken}
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            selectVersion(id);
            setCreating(false);
          }}
        />
      ) : null}

      {view !== "stations" && versionsQuery.isPending ? (
        <div className="grid min-h-0 gap-2 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <PanelSkeleton lines={6} className="min-h-72" />
          <RateTableSkeleton label="Memuat riwayat harga" />
        </div>
      ) : null}
      {view !== "stations" && versionsQuery.isError ? (
        <ErrorState
          message="Riwayat harga belum dapat dimuat."
          onRetry={() => void versionsQuery.refetch()}
        />
      ) : null}
      {view !== "stations" &&
      !versionsQuery.isPending &&
      !versionsQuery.isError &&
      versions.length === 0 &&
      !creating ? (
        <EmptyState
          id="rates-empty"
          icon="rates"
          title="Belum ada versi harga"
          description="Payroll dihitung dari versi harga yang berlaku. Buat versi pertama berisi harga per width dan anyaman."
          action={
            canWrite ? (
              <button
                type="button"
                className="empty-state-primary"
                onClick={() => {
                  changeView("rates");
                  setCreating(true);
                }}
              >
                Tambah konfigurasi harga
              </button>
            ) : (
              <span className="empty-state-note">
                Minta pengguna dengan izin tulis membuat versi harga pertama.
              </span>
            )
          }
          backdrop={<RatesEmptyBackdrop />}
          fill
        />
      ) : null}

      {view !== "stations" && versions.length > 0 ? (
        <div className="grid min-h-0 gap-2 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <RateVersionList
            versions={versions}
            selectedId={selectedId}
            onSelect={selectVersion}
            hasNextPage={Boolean(versionsQuery.hasNextPage)}
            isFetchingNextPage={versionsQuery.isFetchingNextPage}
            onLoadMore={() => void versionsQuery.fetchNextPage()}
          />
          <div className="min-w-0">
            {view === "rates" && detailsQuery.isPending ? (
              <RateTableSkeleton label="Memuat tabel harga" />
            ) : null}
            {view === "rates" && detailsQuery.isError ? (
              <ErrorState
                message="Detail versi harga belum dapat dimuat."
                onRetry={() => void detailsQuery.refetch()}
              />
            ) : null}
            {view === "rates" && detailsQuery.data ? (
              <RateEditor
                key={detailsQuery.data.id}
                version={detailsQuery.data}
                canWrite={canWrite}
                canApprove={canApprove}
                csrfToken={csrfToken}
                onDirtyChange={setEditorDirty}
                onReload={async () => (await detailsQuery.refetch()).data}
              />
            ) : null}
            {view === "policy" && selectedSummary ? (
              <CalculationPolicyEditor
                key={selectedSummary.id}
                version={selectedSummary}
                canWrite={canWrite}
                csrfToken={csrfToken}
                onDirtyChange={setEditorDirty}
              />
            ) : null}
          </div>
        </div>
      ) : null}
      {view === "stations" ? (
        <StationGroupManager
          canWrite={canWrite}
          canApprove={canApprove}
          csrfToken={csrfToken}
          onDirtyChange={setEditorDirty}
        />
      ) : null}
    </div>
  );
}

/** Matriks harga: kolom range width, lalu kolom per anyaman. */
const RATE_COLUMNS = [16, 12, 12, 12, 12, 12, 12, 12];

function RateTableSkeleton({ label }: { label: string }) {
  return (
    <TableSkeleton
      label={label}
      height="26rem"
      columns={RATE_COLUMNS}
      align={["start", "end", "end", "end", "end", "end", "end", "end"]}
    />
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <section
      role="alert"
      className="flex items-center justify-between gap-3 border border-danger/30 bg-surface p-4 text-sm"
    >
      <p>{message}</p>
      <button
        type="button"
        className="min-h-8 border border-border-strong px-3 text-xs font-semibold"
        onClick={onRetry}
      >
        Coba lagi
      </button>
    </section>
  );
}

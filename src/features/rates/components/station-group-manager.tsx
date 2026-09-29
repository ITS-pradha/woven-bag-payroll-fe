import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";

import { ApiClientError } from "../../../api/client/api-result";
import {
  activateStationGroupVersion,
  createStationGroupVersion,
  listStationGroupVersions,
  replaceStationGroupMappingBatch,
  type StationGroupVersion,
  type StationGroupVersionWithMappings,
} from "../api/station-group-api";
import {
  stationGroupVersionQueryOptions,
  stationGroupVersionsQueryKey,
} from "../api/rates-queries";
import { LiveEditConfirm } from "./live-edit-confirm";
import { RateStatusBadge } from "./rate-status-badge";

interface StationGroupManagerProps {
  canWrite: boolean;
  canApprove: boolean;
  csrfToken: string;
  onDirtyChange: (dirty: boolean) => void;
}

export function StationGroupManager(props: StationGroupManagerProps) {
  const [requestedId, setRequestedId] = useState("");
  const [creating, setCreating] = useState(false);
  const query = useInfiniteQuery({
    queryKey: stationGroupVersionsQueryKey,
    queryFn: ({ signal, pageParam }) =>
      listStationGroupVersions(signal, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.page.nextCursor ?? undefined,
  });
  const versions = query.data?.pages.flatMap((page) => page.data) ?? [];
  const selectedId = requestedId || versions[0]?.id || "";
  const selected = versions.find((version) => version.id === selectedId);
  const details = useQuery(stationGroupVersionQueryOptions(selectedId));

  return (
    <section
      className="min-w-0 space-y-2"
      aria-labelledby="station-group-title"
    >
      <div className="flex flex-wrap items-end gap-2 border border-border bg-surface px-3 py-2">
        <label className="mr-auto min-w-64 text-[0.6875rem] font-semibold">
          <span id="station-group-title">Versi kelompok mesin</span>
          <select
            aria-label="Versi kelompok mesin"
            className="mt-1 min-h-8 w-full border border-border-strong bg-surface px-2 text-xs focus:outline-2 focus:outline-focus"
            value={selectedId}
            onChange={(event) => setRequestedId(event.target.value)}
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.name} · {version.status}
              </option>
            ))}
          </select>
        </label>
        {query.hasNextPage ? (
          <button
            type="button"
            className="min-h-8 border border-border px-2 text-xs font-semibold"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? "Memuat…" : "Muat versi lain"}
          </button>
        ) : null}
        {props.canWrite ? (
          <button
            type="button"
            className="min-h-8 border border-border-strong px-3 text-xs font-semibold"
            onClick={() => setCreating((value) => !value)}
          >
            {creating ? "Tutup form" : "Buat versi mapping baru"}
          </button>
        ) : null}
      </div>

      {creating ? (
        <CreateStationGroupPanel
          source={
            versions.find((version) => version.status === "ACTIVE") ?? selected
          }
          csrfToken={props.csrfToken}
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setRequestedId(id);
            setCreating(false);
          }}
        />
      ) : null}
      {query.isPending ? (
        <StationState label="Memuat versi kelompok mesin…" />
      ) : null}
      {query.isError ? (
        <StationState
          label="Versi kelompok mesin belum dapat dimuat."
          retry={() => void query.refetch()}
        />
      ) : null}
      {!query.isPending && !query.isError && versions.length === 0 ? (
        <div className="border border-border bg-surface p-6 text-center">
          <h2 className="text-sm font-bold">Belum ada kelompok mesin</h2>
          <p className="mt-1 text-xs text-muted">
            Buat versi pertama untuk memetakan nomor station ke Regular, CS,
            atau SP.
          </p>
        </div>
      ) : null}
      {selected && details.isPending ? (
        <StationState label="Memuat mapping station…" />
      ) : null}
      {details.isError ? (
        <StationState
          label="Mapping station belum dapat dimuat."
          retry={() => void details.refetch()}
        />
      ) : null}
      {details.data ? (
        <StationGroupEditor
          key={details.data.id}
          version={details.data}
          {...props}
        />
      ) : null}
    </section>
  );
}

function CreateStationGroupPanel({
  source,
  csrfToken,
  onCancel,
  onCreated,
}: {
  source: StationGroupVersion | undefined;
  csrfToken: string;
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState(source ? `${source.name} versi baru` : "");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      createStationGroupVersion(
        {
          key: crypto.randomUUID(),
          body: {
            ...(source ? { cloneFromStationGroupVersionId: source.id } : {}),
            code: code.trim(),
            name: name.trim(),
            effectiveFrom,
            changeNote: changeNote.trim(),
          },
        },
        csrfToken,
      ),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({
        queryKey: stationGroupVersionsQueryKey,
      });
      onCreated(created.id);
    },
    onError: (cause) => setError(readError(cause)),
  });
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      !code.trim() ||
      !name.trim() ||
      !effectiveFrom ||
      changeNote.trim().length < 5
    ) {
      setError(
        "Lengkapi kode, nama, tanggal berlaku, dan alasan minimal 5 karakter.",
      );
      return;
    }
    setError("");
    mutation.mutate();
  }
  return (
    <form
      className="grid gap-2 border border-info-border bg-info-soft p-3 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={submit}
    >
      <CompactInput
        label="Kode versi mapping"
        value={code}
        onChange={setCode}
      />
      <CompactInput
        label="Nama versi mapping"
        value={name}
        onChange={setName}
      />
      <CompactInput
        label="Berlaku mulai mapping"
        type="date"
        value={effectiveFrom}
        onChange={setEffectiveFrom}
      />
      <CompactInput
        label="Alasan perubahan mapping"
        value={changeNote}
        onChange={setChangeNote}
      />
      <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
        <button
          type="submit"
          className="min-h-8 rounded bg-brand px-3 text-xs font-bold text-white disabled:bg-brand-disabled"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Membuat…" : "Buat draft mapping"}
        </button>
        <button
          type="button"
          className="min-h-8 px-2 text-xs font-semibold"
          onClick={onCancel}
        >
          Batal
        </button>
        {error ? (
          <p role="alert" className="text-xs font-semibold text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

interface EditableMapping {
  clientRowId: string;
  stationNo: string;
  loomGroup: "REGULAR" | "CS" | "SP";
}

function StationGroupEditor({
  version,
  canWrite,
  canApprove,
  csrfToken,
  onDirtyChange,
}: StationGroupManagerProps & { version: StationGroupVersionWithMappings }) {
  const queryClient = useQueryClient();
  const [baseline, setBaseline] = useState(version);
  const [rows, setRows] = useState<EditableMapping[]>(() =>
    version.mappings.map((mapping) => ({
      clientRowId: mapping.clientRowId,
      stationNo: String(mapping.stationNo),
      loomGroup: mapping.loomGroup,
    })),
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [approvalNote, setApprovalNote] = useState("");
  const [showApproval, setShowApproval] = useState(false);
  /*
    ACTIVE is edited in place (decision 2026-09-29, same rule as prices):
    the server refuses once the period is in a locked payroll, and fails the
    unlocked runs of that period so they are generated again.
  */
  const live = baseline.status === "ACTIVE";
  const editable = (baseline.status === "DRAFT" || live) && canWrite;
  const [confirmingLiveSave, setConfirmingLiveSave] = useState(false);
  const dirty =
    JSON.stringify(rows) !==
    JSON.stringify(
      baseline.mappings.map((mapping) => ({
        clientRowId: mapping.clientRowId,
        stationNo: String(mapping.stationNo),
        loomGroup: mapping.loomGroup,
      })),
    );

  function changeRows(next: EditableMapping[]) {
    setRows(next);
    setMessage("");
    onDirtyChange(true);
  }
  function applySaved(saved: StationGroupVersionWithMappings) {
    queryClient.setQueryData(
      stationGroupVersionQueryOptions(saved.id).queryKey,
      saved,
    );
    void queryClient.invalidateQueries({
      queryKey: stationGroupVersionsQueryKey,
    });
    setBaseline(saved);
    setRows(
      saved.mappings.map((mapping) => ({
        clientRowId: mapping.clientRowId,
        stationNo: String(mapping.stationNo),
        loomGroup: mapping.loomGroup,
      })),
    );
    onDirtyChange(false);
  }
  const saveMutation = useMutation({
    mutationFn: () => {
      const stationNumbers = rows.map((row) => Number(row.stationNo));
      if (
        stationNumbers.some(
          (station) => !Number.isInteger(station) || station < 1,
        )
      )
        throw new Error("Nomor station wajib berupa angka bulat positif.");
      if (new Set(stationNumbers).size !== stationNumbers.length)
        throw new Error("Nomor station tidak boleh ganda dalam satu versi.");
      if (rows.length === 0)
        throw new Error("Tambahkan minimal satu mapping station.");
      return replaceStationGroupMappingBatch(
        baseline.id,
        {
          key: crypto.randomUUID(),
          body: {
            expectedRowVersion: baseline.rowVersion,
            mappings: rows.map((row) => ({
              clientRowId: row.clientRowId,
              stationNo: Number(row.stationNo),
              loomGroup: row.loomGroup,
            })),
          },
        },
        csrfToken,
      );
    },
    onSuccess: (saved) => {
      applySaved(saved);
      setConfirmingLiveSave(false);
      setError("");
      setMessage(
        live
          ? "Mapping station aktif berhasil disimpan. Generate ulang payroll yang belum dikunci pada masa berlakunya."
          : "Mapping station berhasil disimpan.",
      );
    },
    onError: (cause) => {
      setConfirmingLiveSave(false);
      setError(readError(cause));
    },
  });
  const activation = useMutation({
    mutationFn: () =>
      activateStationGroupVersion(
        baseline.id,
        {
          key: crypto.randomUUID(),
          body: {
            expectedRowVersion: baseline.rowVersion,
            approvalNote: approvalNote.trim(),
          },
        },
        csrfToken,
      ),
    onSuccess: (saved) => {
      applySaved(saved);
      setShowApproval(false);
      setApprovalNote("");
      setError("");
      setMessage("Kelompok mesin berhasil diaktifkan.");
    },
    onError: (cause) => setError(readError(cause)),
  });

  return (
    <section
      className="border border-border bg-surface"
      aria-labelledby="station-mapping-title"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="mr-auto min-w-0">
          <p className="text-[0.625rem] font-bold uppercase tracking-wider text-brand-strong">
            {baseline.code} · berlaku {baseline.effectiveFrom}
          </p>
          <h2 id="station-mapping-title" className="truncate text-sm font-bold">
            {baseline.name}
          </h2>
        </div>
        <RateStatusBadge status={baseline.status} />
        {editable ? (
          <button
            type="button"
            className="min-h-7 border border-border px-2 text-[0.6875rem] font-semibold"
            onClick={() =>
              changeRows([
                ...rows,
                {
                  clientRowId: crypto.randomUUID(),
                  stationNo: "",
                  loomGroup: "REGULAR",
                },
              ])
            }
          >
            Tambah mapping station
          </button>
        ) : null}
      </div>
      {live && editable ? (
        <p className="border-b border-info-border bg-info-soft px-3 py-2 text-[0.6875rem] text-info-strong">
          <strong>Mapping aktif dapat diedit langsung</strong> selama masa
          berlakunya belum dipakai payroll yang terkunci. Payroll yang belum
          dikunci pada masa berlakunya harus di-generate ulang setelah
          perubahan.
        </p>
      ) : null}
      <div className="max-h-[calc(100vh-18rem)] overflow-auto">
        <table
          className="w-full min-w-[28rem] border-collapse text-xs"
          aria-label="Mapping station ke kelompok loom"
        >
          <thead className="sticky top-0 bg-grid-header text-grid-header-foreground">
            <tr>
              <th className="w-16 border border-grid-border p-1">No.</th>
              <th className="border border-grid-border p-1 text-left">
                Nomor station
              </th>
              <th className="border border-grid-border p-1 text-left">
                Kelompok loom
              </th>
              <th className="w-20 border border-grid-border p-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.clientRowId}>
                <td className="border border-grid-border p-1 text-center">
                  {index + 1}
                </td>
                <td className="border border-grid-border p-0">
                  <input
                    aria-label={
                      row.stationNo
                        ? `Nomor station ${row.stationNo}`
                        : "Nomor station baru"
                    }
                    type="number"
                    min="1"
                    className="min-h-8 w-full border-0 bg-transparent px-2 focus:outline-2 focus:-outline-offset-2 focus:outline-focus disabled:bg-surface-muted"
                    value={row.stationNo}
                    disabled={!editable}
                    onChange={(event) =>
                      changeRows(
                        rows.map((current) =>
                          current.clientRowId === row.clientRowId
                            ? { ...current, stationNo: event.target.value }
                            : current,
                        ),
                      )
                    }
                  />
                </td>
                <td className="border border-grid-border p-0">
                  <select
                    aria-label={
                      row.stationNo
                        ? `Kelompok loom station ${row.stationNo}`
                        : "Kelompok loom baru"
                    }
                    className="min-h-8 w-full border-0 bg-transparent px-2 focus:outline-2 focus:-outline-offset-2 focus:outline-focus disabled:bg-surface-muted"
                    value={row.loomGroup}
                    disabled={!editable}
                    onChange={(event) =>
                      changeRows(
                        rows.map((current) =>
                          current.clientRowId === row.clientRowId
                            ? {
                                ...current,
                                loomGroup: event.target
                                  .value as EditableMapping["loomGroup"],
                              }
                            : current,
                        ),
                      )
                    }
                  >
                    <option value="REGULAR">Regular</option>
                    <option value="CS">CS</option>
                    <option value="SP">SP</option>
                  </select>
                </td>
                <td className="border border-grid-border p-1 text-center">
                  {editable ? (
                    <button
                      type="button"
                      className="min-h-7 px-2 font-semibold text-danger"
                      onClick={() =>
                        changeRows(
                          rows.filter(
                            (current) =>
                              current.clientRowId !== row.clientRowId,
                          ),
                        )
                      }
                    >
                      Hapus
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? (
        <p
          role="alert"
          className="border-t border-danger/30 px-3 py-2 text-xs font-semibold text-danger"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          role="status"
          aria-live="polite"
          className="border-t border-success-border bg-success-soft px-3 py-2 text-xs font-semibold text-success-strong"
        >
          {message}
        </p>
      ) : null}
      {showApproval ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-warning-border bg-warning-soft px-3 py-2">
          <CompactInput
            label="Catatan persetujuan mapping"
            value={approvalNote}
            onChange={setApprovalNote}
          />
          <button
            type="button"
            className="min-h-8 rounded bg-brand px-3 text-xs font-bold text-white disabled:bg-brand-disabled"
            disabled={approvalNote.trim().length < 5 || activation.isPending}
            onClick={() => activation.mutate()}
          >
            {activation.isPending ? "Mengaktifkan…" : "Konfirmasi aktifkan"}
          </button>
          <button
            type="button"
            className="min-h-8 px-2 text-xs font-semibold"
            onClick={() => setShowApproval(false)}
          >
            Batal
          </button>
        </div>
      ) : null}
      <div className="flex items-center gap-2 border-t border-border bg-surface-muted px-3 py-2">
        <span className="mr-auto text-[0.6875rem] text-muted">
          {dirty
            ? "Ada perubahan yang belum disimpan"
            : `${rows.length} station tersimpan`}
        </span>
        {editable ? (
          <button
            type="button"
            className="min-h-8 border border-border-strong bg-surface px-3 text-xs font-semibold disabled:text-disabled"
            disabled={!dirty || saveMutation.isPending || confirmingLiveSave}
            onClick={() => {
              setMessage("");
              if (live) setConfirmingLiveSave(true);
              else saveMutation.mutate();
            }}
          >
            {saveMutation.isPending ? "Menyimpan…" : "Simpan mapping station"}
          </button>
        ) : null}
        {baseline.status === "DRAFT" && canApprove ? (
          <button
            type="button"
            className="min-h-8 rounded bg-brand px-3 text-xs font-bold text-white disabled:bg-brand-disabled"
            disabled={dirty || rows.length === 0}
            onClick={() => setShowApproval(true)}
          >
            Aktifkan mapping
          </button>
        ) : null}
      </div>
      {confirmingLiveSave ? (
        <LiveEditConfirm
          versionCode={baseline.code}
          subject="mapping station"
          impact="Kelompok loom baru langsung dipakai. Payroll yang belum dikunci pada masa berlaku mapping ini ditandai gagal dan harus di-generate ulang."
          isPending={saveMutation.isPending}
          onConfirm={() => saveMutation.mutate()}
          onCancel={() => setConfirmingLiveSave(false)}
        />
      ) : null}
    </section>
  );
}

function CompactInput({
  label,
  value,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  type?: "text" | "date";
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-44 text-[0.6875rem] font-semibold">
      {label}
      <input
        aria-label={label}
        type={type}
        className="mt-1 min-h-8 w-full border border-border-strong bg-surface px-2 text-xs focus:outline-2 focus:outline-focus"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
function StationState({ label, retry }: { label: string; retry?: () => void }) {
  return (
    <div
      role={retry ? "alert" : "status"}
      className="flex min-h-32 items-center justify-center gap-2 border border-border bg-surface p-4 text-xs text-muted"
    >
      <span>{label}</span>
      {retry ? (
        <button
          type="button"
          className="min-h-7 border border-border px-2 font-semibold text-foreground"
          onClick={retry}
        >
          Coba lagi
        </button>
      ) : null}
    </div>
  );
}
function readError(cause: unknown) {
  if (cause instanceof ApiClientError) {
    if (cause.code === "ROW_VERSION_CONFLICT")
      return "Versi sudah diubah admin lain. Muat ulang sebelum menyimpan.";
    if (cause.code === "STATION_GROUP_LOCKED")
      return "Masa berlaku mapping ini sudah dipakai payroll yang terkunci, jadi tidak dapat diubah. Buat versi baru untuk perubahan berikutnya.";
    return cause.message;
  }
  return cause instanceof Error
    ? cause.message
    : "Perubahan belum dapat disimpan.";
}

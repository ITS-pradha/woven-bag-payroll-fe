import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cloneElement, useState, type ReactElement } from "react";

import { ApiClientError } from "../../../api/client/api-result";
import type { components } from "../../../api/generated/schema";
import {
  activateRateVersion,
  replaceRateBatch,
  updateRateVersion,
  type RateVersionWithRows,
} from "../api/rates-api";
import {
  rateVersionQueryOptions,
  rateVersionsQueryKey,
} from "../api/rates-queries";
import {
  buildRateRowsPayload,
  toEditableRateRows,
  validateRateDraft,
} from "../model/rate-draft";
import { rateEditErrorMessage } from "../model/rate-edit-errors";
import { ActivateRateDialog } from "./activate-rate-dialog";
import { LiveEditConfirm } from "./live-edit-confirm";
import { RateMatrixEditor } from "./rate-matrix-editor";
import { RateStatusBadge } from "./rate-status-badge";

type RoundingMode = components["schemas"]["RateVersion"]["roundingMode"];

interface RateEditorProps {
  version: RateVersionWithRows;
  canWrite: boolean;
  canApprove: boolean;
  csrfToken: string;
  onReload: () => Promise<RateVersionWithRows | undefined>;
  onDirtyChange: (dirty: boolean) => void;
}

function metadataFrom(version: RateVersionWithRows) {
  return {
    code: version.code,
    name: version.name,
    effectiveFrom: version.effectiveFrom,
    bonusMultiplier: version.bonusMultiplier,
    roundingMode: version.roundingMode,
    changeNote: version.changeNote ?? "",
  };
}

function errorMessage(cause: unknown) {
  if (cause instanceof ApiClientError) {
    if (cause.code === "ROW_VERSION_CONFLICT")
      return "Versi ini sudah diubah admin lain. Muat versi server sebelum melanjutkan.";
    const known = rateEditErrorMessage(cause.code);
    if (known) return known;
    return cause.message;
  }
  return cause instanceof Error
    ? cause.message
    : "Permintaan belum dapat diproses.";
}

export function RateEditor({
  version,
  canWrite,
  canApprove,
  csrfToken,
  onReload,
  onDirtyChange,
}: RateEditorProps) {
  const queryClient = useQueryClient();
  const [baseline, setBaseline] = useState(version);
  const [metadata, setMetadata] = useState(() => metadataFrom(version));
  const [rows, setRows] = useState(() => toEditableRateRows(version.rows));
  const [rowsDirty, setRowsDirty] = useState(false);
  const [selected, setSelected] = useState(new Set<string>());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showActivation, setShowActivation] = useState(false);
  const [saveAttemptKey, setSaveAttemptKey] = useState<string | null>(null);
  const [activationKey, setActivationKey] = useState("");
  const [confirmingLiveSave, setConfirmingLiveSave] = useState(false);

  // DRAFT, ACTIVE, dan RETIRED boleh diubah; server yang menolak versi yang
  // sudah dipakai payroll LOCKED (RATE_VERSION_LOCKED).
  const editable = canWrite;
  const live = baseline.status !== "DRAFT";
  const metadataDirty =
    JSON.stringify(metadata) !== JSON.stringify(metadataFrom(baseline));
  const dirty = metadataDirty || rowsDirty;
  const validationErrors = validateRateDraft(rows);

  function updateMetadata<K extends keyof RateMetadata>(
    field: K,
    value: RateMetadata[K],
  ) {
    setMetadata((current) => ({ ...current, [field]: value }));
    setSaveAttemptKey(null);
    onDirtyChange(true);
  }

  function updateCachedVersion(updated: RateVersionWithRows) {
    queryClient.setQueryData(
      rateVersionQueryOptions(updated.id).queryKey,
      updated,
    );
    void queryClient.invalidateQueries({ queryKey: rateVersionsQueryKey });
    setBaseline(updated);
    setMetadata(metadataFrom(updated));
    setRows(toEditableRateRows(updated.rows));
    setRowsDirty(false);
    onDirtyChange(false);
    setSelected(new Set());
  }

  const saveMutation = useMutation({
    mutationFn: async (idempotencyKey: string) => {
      let current = baseline;
      if (metadataDirty) {
        const updated = await updateRateVersion(
          baseline.id,
          {
            expectedRowVersion: current.rowVersion,
            code: metadata.code.trim(),
            name: metadata.name.trim(),
            effectiveFrom: metadata.effectiveFrom,
            bonusMultiplier: metadata.bonusMultiplier.trim(),
            roundingMode: metadata.roundingMode,
            changeNote: metadata.changeNote.trim(),
          },
          csrfToken,
        );
        current = { ...updated, rows: current.rows };
        queryClient.setQueryData(
          rateVersionQueryOptions(current.id).queryKey,
          current,
        );
        setBaseline(current);
      }
      if (rowsDirty) {
        current = await replaceRateBatch(
          baseline.id,
          {
            key: idempotencyKey,
            body: {
              expectedRowVersion: current.rowVersion,
              rows: buildRateRowsPayload(rows),
            },
          },
          csrfToken,
        );
      }
      return current;
    },
    onSuccess: (updated) => {
      updateCachedVersion(updated);
      setSaveAttemptKey(null);
      setConfirmingLiveSave(false);
      setError("");
      setMessage(
        live
          ? `Perubahan ${updated.code} tersimpan dan langsung berlaku. Generate ulang payroll yang belum dikunci pada masa berlaku versi ini.`
          : "Draft berhasil disimpan.",
      );
    },
    onError: (cause) => {
      setConfirmingLiveSave(false);
      setMessage("");
      setError(errorMessage(cause));
    },
  });

  const activationMutation = useMutation({
    mutationFn: ({
      approvalNote,
      key,
    }: {
      approvalNote: string;
      key: string;
    }) =>
      activateRateVersion(
        baseline.id,
        {
          key,
          body: { expectedRowVersion: baseline.rowVersion, approvalNote },
        },
        csrfToken,
      ),
    onSuccess: (updated) => {
      updateCachedVersion(updated);
      setShowActivation(false);
      setActivationKey("");
      setError("");
      setMessage(
        `${updated.code} berhasil diaktifkan. Payroll lama tetap memakai harga sebelumnya.`,
      );
    },
    onError: (cause) => setError(errorMessage(cause)),
  });

  function save() {
    const metadataValid =
      metadata.code.trim() &&
      metadata.name.trim() &&
      /^\d{4}-\d{2}-\d{2}$/.test(metadata.effectiveFrom) &&
      /^\d+(?:\.\d+)?$/.test(metadata.bonusMultiplier);
    if (!metadataValid || validationErrors.length > 0) {
      setMessage("");
      setError(
        !metadataValid
          ? "Lengkapi metadata versi dengan nilai yang valid."
          : (validationErrors[0] ?? "Tabel harga belum valid."),
      );
      return;
    }
    setError("");
    setMessage("");
    if (live && !confirmingLiveSave) {
      setConfirmingLiveSave(true);
      return;
    }
    const key = saveAttemptKey ?? crypto.randomUUID();
    setSaveAttemptKey(key);
    saveMutation.mutate(key);
  }

  async function reloadServerVersion() {
    const server = await onReload();
    if (!server) return;
    setBaseline(server);
    setMetadata(metadataFrom(server));
    setRows(toEditableRateRows(server.rows));
    setRowsDirty(false);
    onDirtyChange(false);
    setSaveAttemptKey(null);
    setSelected(new Set());
    setError("");
    setMessage("Versi terbaru dari server telah dimuat.");
  }

  return (
    <div className="min-w-0 space-y-2">
      <section
        className="border border-border bg-surface"
        aria-labelledby="rate-editor-title"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <p className="text-[0.625rem] font-bold uppercase tracking-wider text-brand-strong">
              Versi terpilih
            </p>
            <h2 id="rate-editor-title" className="truncate text-sm font-bold">
              {baseline.name}
            </h2>
          </div>
          <RateStatusBadge status={baseline.status} />
        </div>
        <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Kode versi">
            <input
              aria-label="Kode versi"
              value={metadata.code}
              disabled={!editable}
              onChange={(event) => updateMetadata("code", event.target.value)}
            />
          </Field>
          <Field label="Nama versi">
            <input
              aria-label="Nama versi"
              value={metadata.name}
              disabled={!editable}
              onChange={(event) => updateMetadata("name", event.target.value)}
            />
          </Field>
          <Field label="Berlaku mulai">
            <input
              aria-label="Berlaku mulai"
              type="date"
              value={metadata.effectiveFrom}
              disabled={!editable || live}
              onChange={(event) =>
                updateMetadata("effectiveFrom", event.target.value)
              }
            />
          </Field>
          <Field label="Grup mesin">
            <input
              aria-label="Grup mesin"
              value={baseline.machineGroup}
              disabled
            />
          </Field>
          <Field label="Pengali bonus">
            <input
              aria-label="Pengali bonus"
              inputMode="decimal"
              value={metadata.bonusMultiplier}
              disabled={!editable}
              onChange={(event) =>
                updateMetadata("bonusMultiplier", event.target.value)
              }
            />
          </Field>
          <Field label="Pembulatan">
            <select
              aria-label="Pembulatan"
              value={metadata.roundingMode}
              disabled={!editable}
              onChange={(event) =>
                updateMetadata(
                  "roundingMode",
                  event.target.value as RoundingMode,
                )
              }
            >
              <option value="HALF_UP_AT_PIN_TOTAL">Total per PIN</option>
              <option value="HALF_UP_PER_LINE">Setiap baris produksi</option>
            </select>
          </Field>
          <Field label="Berlaku sampai">
            <input
              aria-label="Berlaku sampai"
              value={
                baseline.effectiveToExclusive
                  ? `Sebelum ${baseline.effectiveToExclusive}`
                  : "Belum berakhir"
              }
              disabled
            />
          </Field>
          <Field label="Dibuat oleh">
            <input
              aria-label="Dibuat oleh"
              value={baseline.createdBy}
              disabled
            />
          </Field>
          <label className="text-[0.6875rem] font-semibold sm:col-span-2 xl:col-span-4">
            Alasan perubahan
            <textarea
              aria-label="Alasan perubahan"
              rows={2}
              className="mt-1 w-full resize-y border border-border-strong px-2 py-1.5 text-xs focus:outline-2 focus:outline-focus disabled:bg-surface-muted disabled:text-muted"
              value={metadata.changeNote}
              disabled={!editable}
              onChange={(event) =>
                updateMetadata("changeNote", event.target.value)
              }
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-muted px-3 py-2">
          <span className="mr-auto text-[0.6875rem] text-muted">
            {dirty
              ? "Ada perubahan yang belum disimpan"
              : `${baseline.rows.length} range tersimpan`}
          </span>
          {editable ? (
            <button
              type="button"
              className="min-h-8 border border-border-strong bg-surface px-3 text-xs font-semibold disabled:text-disabled"
              disabled={!dirty || saveMutation.isPending}
              onClick={save}
            >
              {saveMutation.isPending
                ? "Menyimpan…"
                : live
                  ? "Simpan perubahan"
                  : "Simpan draft"}
            </button>
          ) : null}
          {baseline.status === "DRAFT" && canApprove ? (
            <button
              type="button"
              className="min-h-8 rounded bg-brand px-3 text-xs font-bold text-white hover:bg-brand-strong disabled:bg-brand-disabled"
              disabled={
                dirty || validationErrors.length > 0 || saveMutation.isPending
              }
              onClick={() => {
                setActivationKey(crypto.randomUUID());
                setShowActivation(true);
              }}
            >
              Aktifkan versi
            </button>
          ) : null}
        </div>
        {confirmingLiveSave ? (
          <LiveEditConfirm
            versionCode={baseline.code}
            subject="perubahan harga"
            isPending={saveMutation.isPending}
            onConfirm={save}
            onCancel={() => setConfirmingLiveSave(false)}
          />
        ) : null}
      </section>

      {message ? (
        <p
          role="status"
          aria-live="polite"
          className="border border-success-border bg-success-soft px-3 py-2 text-xs font-semibold text-success-strong"
        >
          {message}
        </p>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border border-danger/30 bg-surface px-3 py-2 text-xs text-danger"
        >
          <span>{error}</span>
          {error.includes("admin lain") ? (
            <button
              type="button"
              className="shrink-0 border border-danger px-2 py-1 font-bold"
              onClick={() => void reloadServerVersion()}
            >
              Muat versi server
            </button>
          ) : null}
        </div>
      ) : null}

      <RateMatrixEditor
        rows={rows}
        selected={selected}
        editable={editable}
        onRowsChange={(next) => {
          setRows(next);
          setRowsDirty(true);
          setSaveAttemptKey(null);
          onDirtyChange(true);
          setMessage("");
        }}
        onSelectionChange={setSelected}
      />

      {showActivation ? (
        <ActivateRateDialog
          versionCode={baseline.code}
          effectiveFrom={baseline.effectiveFrom}
          rangeCount={rows.length}
          isPending={activationMutation.isPending}
          error={activationMutation.isError ? error : ""}
          onClose={() => {
            setShowActivation(false);
            setActivationKey("");
            setError("");
          }}
          onConfirm={(approvalNote) =>
            activationMutation.mutate({
              approvalNote,
              key: activationKey || crypto.randomUUID(),
            })
          }
        />
      ) : null}
    </div>
  );
}

type RateMetadata = ReturnType<typeof metadataFrom>;

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactElement<{ className?: string }>;
}) {
  return (
    <label className="text-[0.6875rem] font-semibold">
      {label}
      <span className="mt-1 block">
        {cloneElement(children, {
          className: `min-h-8 w-full border border-border-strong bg-surface px-2 text-xs focus:outline-2 focus:outline-focus disabled:bg-surface-muted disabled:text-muted ${children.props.className ?? ""}`,
        })}
      </span>
    </label>
  );
}

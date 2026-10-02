import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiClientError } from "../../../api/client/api-result";
import {
  replaceRateCalculationPolicy,
  type RateCalculationPolicy,
} from "../api/calculation-policy-api";
import type { RateVersion } from "../api/rates-api";
import { rateCalculationPolicyQueryOptions } from "../api/rates-queries";
import {
  changePayFormulaType,
  changeTargetPpmType,
  createDefaultCalculationPolicy,
  validateCalculationPolicy,
  type CalculationPolicyDraft,
} from "../model/calculation-policy-draft";
import { rateEditErrorMessage } from "../model/rate-edit-errors";
import { LiveEditConfirm } from "./live-edit-confirm";
import { RateStatusBadge } from "./rate-status-badge";
import { SpecialRateRulesEditor } from "./special-rate-rules-editor";
import { PanelSkeleton } from "../../../components/skeleton/skeleton";

interface CalculationPolicyEditorProps {
  version: RateVersion;
  canWrite: boolean;
  csrfToken: string;
  onDirtyChange: (dirty: boolean) => void;
}

export function CalculationPolicyEditor(props: CalculationPolicyEditorProps) {
  const query = useQuery(rateCalculationPolicyQueryOptions(props.version.id));
  if (query.isPending)
    return (
      <PanelSkeleton
        label="Memuat aturan kalkulasi"
        lines={7}
        className="min-h-80"
      />
    );
  if (query.isError)
    return (
      <PolicyState
        label="Aturan kalkulasi belum dapat dimuat."
        onRetry={() => void query.refetch()}
      />
    );
  return (
    <CalculationPolicyForm
      key={props.version.id}
      {...props}
      policy={query.data}
    />
  );
}

function CalculationPolicyForm({
  version,
  policy,
  canWrite,
  csrfToken,
  onDirtyChange,
}: CalculationPolicyEditorProps & { policy: RateCalculationPolicy | null }) {
  const queryClient = useQueryClient();
  // Sama dengan tabel harga: server menolak versi yang dipakai payroll LOCKED.
  const editable = canWrite;
  const live = version.status !== "DRAFT";
  const [confirmingLiveSave, setConfirmingLiveSave] = useState(false);
  const [baseline, setBaseline] = useState(() => toDraft(policy));
  const [draft, setDraft] = useState(() => toDraft(policy));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [attemptKey, setAttemptKey] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  function change(next: CalculationPolicyDraft) {
    setDraft(next);
    setAttemptKey(null);
    setMessage("");
    onDirtyChange(JSON.stringify(next) !== JSON.stringify(baseline));
  }

  const mutation = useMutation({
    mutationFn: (key: string) =>
      replaceRateCalculationPolicy(
        version.id,
        {
          key,
          body: {
            ...draft,
            expectedRowVersion: policy?.rowVersion ?? 0,
          },
        },
        csrfToken,
      ),
    onSuccess: (saved) => {
      const savedDraft = toDraft(saved);
      queryClient.setQueryData(
        rateCalculationPolicyQueryOptions(version.id).queryKey,
        saved,
      );
      setBaseline(savedDraft);
      setDraft(savedDraft);
      setAttemptKey(null);
      setConfirmingLiveSave(false);
      setError("");
      setMessage(
        live
          ? "Aturan kalkulasi tersimpan dan langsung berlaku. Generate ulang payroll yang belum dikunci pada masa berlaku versi ini."
          : "Aturan kalkulasi berhasil disimpan.",
      );
      onDirtyChange(false);
    },
    onError: (cause) => {
      setConfirmingLiveSave(false);
      setMessage("");
      setError(policyError(cause));
    },
  });

  function save() {
    const validationError = validateCalculationPolicy(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    if (live && !confirmingLiveSave) {
      setConfirmingLiveSave(true);
      return;
    }
    const key = attemptKey ?? crypto.randomUUID();
    setAttemptKey(key);
    mutation.mutate(key);
  }

  return (
    <section
      className="min-w-0 border border-border bg-surface"
      aria-labelledby="policy-title"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="text-[0.625rem] font-bold uppercase tracking-wider text-brand-strong">
            Aturan server · {version.code}
          </p>
          <h2 id="policy-title" className="truncate text-sm font-bold">
            Aturan kalkulasi
          </h2>
        </div>
        <RateStatusBadge status={version.status} />
      </div>

      <div className="grid gap-2 p-3 md:grid-cols-3">
        <SelectField
          label="Cara menentukan target"
          value={draft.targetPpmPolicy.type}
          disabled={!editable}
          options={[
            ["FIXED", "Target PPM tetap"],
            ["WIDTH_CURVE", "Target mengikuti lebar"],
          ]}
          onChange={(value) =>
            change({
              ...draft,
              targetPpmPolicy: changeTargetPpmType(
                value as "FIXED" | "WIDTH_CURVE",
              ),
            })
          }
        />
        <SelectField
          label="Sumber tarif"
          value={draft.payRateFormula.type}
          disabled={!editable}
          options={[
            ["MATRIX", "Tabel harga"],
            ["REGULAR_WIDTH_CURVE", "Rumus lebar regular"],
            ["TARGET_BASED", "Rumus berbasis target"],
          ]}
          onChange={(value) =>
            change({
              ...draft,
              payRateFormula: changePayFormulaType(
                value as "MATRIX" | "REGULAR_WIDTH_CURVE" | "TARGET_BASED",
              ),
            })
          }
        />
        <SelectField
          label="Jika weft di luar tabel"
          value={draft.outOfRangeMode}
          disabled={!editable}
          options={[
            ["CLAMP", "Pakai batas terdekat"],
            ["EXTRAPOLATE", "Lanjutkan pola tarif"],
            ["REJECT", "Tolak saat generate"],
          ]}
          onChange={(value) =>
            change({
              ...draft,
              outOfRangeMode: value as CalculationPolicyDraft["outOfRangeMode"],
            })
          }
        />
        {draft.targetPpmPolicy.type === "FIXED" ? (
          <NumberField
            label="Target PPM tetap"
            value={draft.targetPpmPolicy.fixedTargetPpm}
            disabled={!editable}
            onChange={(value) =>
              change({
                ...draft,
                targetPpmPolicy: {
                  type: "FIXED",
                  fixedTargetPpm: value,
                },
              })
            }
          />
        ) : (
          <CurveTargetFields
            draft={draft}
            disabled={!editable}
            onChange={change}
          />
        )}
      </div>

      <details className="border-t border-border px-3 py-2">
        <summary className="cursor-pointer text-xs font-bold focus:outline-2 focus:outline-focus">
          Pengaturan teknis lanjutan
          <span className="ml-2 font-normal text-muted">
            Ubah hanya bila rumus sudah disetujui.
          </span>
        </summary>
        <div className="mt-3 space-y-3">
          <TechnicalFields
            draft={draft}
            disabled={!editable}
            onChange={change}
          />
          <SpecialRateRulesEditor
            rules={draft.specialRules}
            disabled={!editable}
            onChange={(specialRules) => change({ ...draft, specialRules })}
          />
        </div>
      </details>

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
      <div className="flex items-center gap-2 border-t border-border bg-surface-muted px-3 py-2">
        <span className="mr-auto text-[0.6875rem] text-muted">
          {policy
            ? `Terakhir diubah oleh ${policy.updatedBy}`
            : "Aturan belum pernah disimpan"}
        </span>
        {editable ? (
          <button
            type="button"
            className="min-h-8 rounded bg-brand px-3 text-xs font-bold text-white disabled:bg-brand-disabled"
            disabled={!dirty || mutation.isPending}
            onClick={save}
          >
            {mutation.isPending ? "Menyimpan…" : "Simpan aturan kalkulasi"}
          </button>
        ) : null}
      </div>
      {confirmingLiveSave ? (
        <LiveEditConfirm
          versionCode={version.code}
          subject="aturan kalkulasi"
          isPending={mutation.isPending}
          onConfirm={save}
          onCancel={() => setConfirmingLiveSave(false)}
        />
      ) : null}
    </section>
  );
}

function toDraft(policy: RateCalculationPolicy | null): CalculationPolicyDraft {
  if (!policy) return createDefaultCalculationPolicy();
  const { rateVersionId, rowVersion, updatedBy, updatedAt, ...draft } = policy;
  void rateVersionId;
  void rowVersion;
  void updatedBy;
  void updatedAt;
  return draft;
}

function policyError(cause: unknown) {
  if (cause instanceof ApiClientError) {
    if (cause.code === "ROW_VERSION_CONFLICT")
      return "Aturan sudah diubah admin lain. Muat ulang halaman sebelum menyimpan lagi.";
    const known = rateEditErrorMessage(cause.code);
    if (known) return known;
    return cause.message;
  }
  return cause instanceof Error
    ? cause.message
    : "Aturan belum dapat disimpan.";
}

function PolicyState({
  label,
  busy = false,
  onRetry,
}: {
  label: string;
  busy?: boolean;
  onRetry?: () => void;
}) {
  return (
    <section
      aria-busy={busy}
      role={busy ? "status" : "alert"}
      className="flex min-h-32 items-center justify-center gap-3 border border-border bg-surface p-4 text-xs text-muted"
    >
      <span>{label}</span>
      {onRetry ? (
        <button
          type="button"
          className="min-h-7 border border-border px-2 font-semibold text-foreground"
          onClick={onRetry}
        >
          Coba lagi
        </button>
      ) : null}
    </section>
  );
}

function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-[0.6875rem] font-semibold">
      {label}
      <input
        aria-label={label}
        inputMode="decimal"
        className="mt-1 min-h-8 w-full border border-border-strong bg-surface px-2 text-xs focus:outline-2 focus:outline-focus disabled:bg-surface-muted disabled:text-muted"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  disabled,
  options,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-[0.6875rem] font-semibold">
      {label}
      <select
        aria-label={label}
        className="mt-1 min-h-8 w-full border border-border-strong bg-surface px-2 text-xs focus:outline-2 focus:outline-focus disabled:bg-surface-muted disabled:text-muted"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function CurveTargetFields({
  draft,
  disabled,
  onChange,
}: {
  draft: CalculationPolicyDraft;
  disabled: boolean;
  onChange: (draft: CalculationPolicyDraft) => void;
}) {
  if (draft.targetPpmPolicy.type !== "WIDTH_CURVE") return null;
  return (
    <>
      {(["basePpm", "curveNumerator", "widthDivisor", "exponent"] as const).map(
        (field) => (
          <NumberField
            key={field}
            label={
              {
                basePpm: "PPM dasar",
                curveNumerator: "Pembilang kurva target",
                widthDivisor: "Pembagi lebar target",
                exponent: "Pangkat target",
              }[field]
            }
            value={
              draft.targetPpmPolicy.type === "WIDTH_CURVE"
                ? draft.targetPpmPolicy[field]
                : ""
            }
            disabled={disabled}
            onChange={(value) =>
              onChange({
                ...draft,
                targetPpmPolicy: { ...draft.targetPpmPolicy, [field]: value },
              })
            }
          />
        ),
      )}
    </>
  );
}

function TechnicalFields({
  draft,
  disabled,
  onChange,
}: {
  draft: CalculationPolicyDraft;
  disabled: boolean;
  onChange: (draft: CalculationPolicyDraft) => void;
}) {
  const targetLabels = {
    millimetersPerInch: "Milimeter per inci",
    millimetersPerMeter: "Milimeter per meter",
    baseEfficiencyFactor: "Faktor efisiensi",
    minutesPerHour: "Menit per jam",
    loomShareNumerator: "Pembilang pembagian loom",
    loomShareDenominator: "Penyebut pembagian loom",
  } as const;
  return (
    <>
      <fieldset className="grid gap-2 md:grid-cols-3">
        <legend className="mb-1 text-xs font-bold">
          Konversi target meter
        </legend>
        {(Object.keys(targetLabels) as Array<keyof typeof targetLabels>).map(
          (field) => (
            <NumberField
              key={field}
              label={targetLabels[field]}
              value={draft.targetMeterPolicy[field]}
              disabled={disabled}
              onChange={(value) =>
                onChange({
                  ...draft,
                  targetMeterPolicy: {
                    ...draft.targetMeterPolicy,
                    [field]: value,
                  },
                })
              }
            />
          ),
        )}
      </fieldset>
      <fieldset className="grid gap-2 md:grid-cols-2">
        <legend className="mb-1 text-xs font-bold">Sumber data produksi</legend>
        {draft.sourceDurationPolicies.map((item, index) => (
          <div
            key={item.sourceType}
            className="grid grid-cols-3 gap-2 border border-border p-2"
          >
            <strong className="col-span-3 text-[0.6875rem]">
              {item.sourceType}
            </strong>
            <SelectField
              label={`Durasi ${item.sourceType}`}
              value={item.durationMode}
              disabled={disabled}
              options={[
                ["SHIFT_ELAPSED", "Selisih shift"],
                ["NORMALIZED_RUNTIME", "Runtime dinormalisasi"],
              ]}
              onChange={(value) =>
                onChange({
                  ...draft,
                  sourceDurationPolicies: draft.sourceDurationPolicies.map(
                    (current, currentIndex) =>
                      currentIndex === index
                        ? {
                            ...current,
                            durationMode: value as typeof current.durationMode,
                          }
                        : current,
                  ),
                })
              }
            />
            <NumberField
              label={`Skala persen ${item.sourceType}`}
              value={item.percentageScale}
              disabled={disabled}
              onChange={(value) =>
                onChange({
                  ...draft,
                  sourceDurationPolicies: draft.sourceDurationPolicies.map(
                    (current, currentIndex) =>
                      currentIndex === index
                        ? { ...current, percentageScale: value }
                        : current,
                  ),
                })
              }
            />
            <NumberField
              label={`Menit per jam ${item.sourceType}`}
              value={item.minutesPerHour}
              disabled={disabled}
              onChange={(value) =>
                onChange({
                  ...draft,
                  sourceDurationPolicies: draft.sourceDurationPolicies.map(
                    (current, currentIndex) =>
                      currentIndex === index
                        ? { ...current, minutesPerHour: value }
                        : current,
                  ),
                })
              }
            />
            <NumberField
              label={`Faktor target ${item.sourceType}`}
              value={
                draft.sourceTargetFactors.find(
                  (factor) => factor.sourceType === item.sourceType,
                )?.multiplier ?? ""
              }
              disabled={disabled}
              onChange={(value) =>
                onChange({
                  ...draft,
                  sourceTargetFactors: draft.sourceTargetFactors.map(
                    (factor) =>
                      factor.sourceType === item.sourceType
                        ? { ...factor, multiplier: value }
                        : factor,
                  ),
                })
              }
            />
          </div>
        ))}
      </fieldset>
      <FormulaFields draft={draft} disabled={disabled} onChange={onChange} />
    </>
  );
}

function FormulaFields({
  draft,
  disabled,
  onChange,
}: {
  draft: CalculationPolicyDraft;
  disabled: boolean;
  onChange: (draft: CalculationPolicyDraft) => void;
}) {
  if (draft.payRateFormula.type === "MATRIX") {
    return (
      <p className="border border-border bg-surface-muted p-2 text-xs text-muted">
        Tarif diambil dari tabel harga pada versi ini. Interpolasi antar-weft:
        linear.
      </p>
    );
  }
  const regularLabels = {
    constantA: "Konstanta A",
    constantB: "Konstanta B",
    curveNumerator: "Pembilang kurva tarif",
    widthDivisor: "Pembagi lebar tarif",
    exponent: "Pangkat tarif",
    densityDivisor: "Pembagi density",
  } as const;
  const targetLabels = {
    baseRate: "Tarif dasar",
    numerator: "Pembilang tarif",
    referenceHours: "Jam acuan",
    machinesPerOperator: "Mesin per operator",
  } as const;
  const labels =
    draft.payRateFormula.type === "REGULAR_WIDTH_CURVE"
      ? regularLabels
      : targetLabels;
  return (
    <fieldset className="grid gap-2 md:grid-cols-3">
      <legend className="mb-1 text-xs font-bold">Koefisien rumus tarif</legend>
      {Object.entries(labels).map(([field, label]) => (
        <NumberField
          key={field}
          label={label}
          value={readFormulaField(draft.payRateFormula, field)}
          disabled={disabled}
          onChange={(value) =>
            onChange({
              ...draft,
              payRateFormula: { ...draft.payRateFormula, [field]: value },
            })
          }
        />
      ))}
    </fieldset>
  );
}

function readFormulaField(
  formula: CalculationPolicyDraft["payRateFormula"],
  field: string,
) {
  if (formula.type === "MATRIX") return "";
  const entries = Object.entries(formula);
  return entries.find(([key]) => key === field)?.[1] ?? "";
}

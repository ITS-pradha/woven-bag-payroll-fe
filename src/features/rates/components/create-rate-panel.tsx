import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiClientError } from "../../../api/client/api-result";
import { createRateVersion, type RateVersion } from "../api/rates-api";
import { rateVersionsQueryKey } from "../api/rates-queries";

interface CreateRatePanelProps {
  /** Semua versi yang ada; kosong = konfigurasi harga pertama. */
  versions: RateVersion[];
  /** Versi yang sedang dibuka — yang paling mungkin ingin diteruskan. */
  defaultSourceId: string;
  csrfToken: string;
  onCancel: () => void;
  onCreated: (id: string) => void;
}

const GROUP_LABEL = { REGULAR: "Regular", CS: "CS", SP: "SP" } as const;
const STATUS_LABEL = {
  DRAFT: "Draft",
  ACTIVE: "Aktif",
  RETIRED: "Expired",
} as const;

/**
 * Versi baru hampir selalu "versi lama dengan beberapa harga berubah", jadi
 * titik awalnya duplikat: seluruh matriks tarif dan calculation policy versi
 * sumber disalin server ke draft baru (`cloneFromRateVersionId`), dan yang
 * perlu diisi tinggal kode, tanggal berlaku, dan alasannya. "Mulai kosong"
 * tetap ada untuk jadwal atau kelompok mesin yang benar-benar baru.
 */
export function CreateRatePanel({
  versions,
  defaultSourceId,
  csrfToken,
  onCancel,
  onCreated,
}: CreateRatePanelProps) {
  const [sourceId, setSourceId] = useState(
    versions.some((version) => version.id === defaultSourceId)
      ? defaultSourceId
      : (versions[0]?.id ?? ""),
  );
  const source = versions.find((version) => version.id === sourceId);
  return (
    <CreateRateForm
      // Remount per source: every prefilled field restarts from the version
      // being duplicated instead of keeping the previous source's code.
      key={sourceId || "blank"}
      versions={versions}
      source={source}
      onSourceChange={setSourceId}
      csrfToken={csrfToken}
      onCancel={onCancel}
      onCreated={onCreated}
    />
  );
}

function CreateRateForm({
  versions,
  source,
  onSourceChange,
  csrfToken,
  onCancel,
  onCreated,
}: {
  versions: RateVersion[];
  source: RateVersion | undefined;
  onSourceChange: (id: string) => void;
  csrfToken: string;
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  // Nomor versi berjalan per kode jadwal, jadi yang berikutnya dihitung dari
  // versi TERTINGGI jadwal itu — bukan dari sumber, yang bisa saja versi lama.
  const nextVersion =
    Math.max(
      0,
      ...versions
        .filter((version) => version.scheduleCode === source?.scheduleCode)
        .map((version) => version.versionNo),
    ) + 1;
  const [code, setCode] = useState(
    source?.code.replace(/V\d+$/, `V${nextVersion}`) ?? "",
  );
  const [name, setName] = useState(
    source ? `${source.name.replace(/\s+V\d+$/, "")} V${nextVersion}` : "",
  );
  const [scheduleCode, setScheduleCode] = useState(
    source?.scheduleCode ?? "LOOM_CS",
  );
  const [machineGroup, setMachineGroup] = useState<"REGULAR" | "CS" | "SP">(
    source?.machineGroup ?? "CS",
  );
  const [bonusMultiplier, setBonusMultiplier] = useState(
    source?.bonusMultiplier ?? "1",
  );
  const [roundingMode, setRoundingMode] = useState<
    "HALF_UP_PER_LINE" | "HALF_UP_AT_PIN_TOTAL"
  >(source?.roundingMode ?? "HALF_UP_AT_PIN_TOTAL");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [error, setError] = useState("");
  const [attemptKey, setAttemptKey] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (key: string) =>
      createRateVersion(
        {
          key,
          body: {
            ...(source ? { cloneFromRateVersionId: source.id } : {}),
            scheduleCode: scheduleCode.trim(),
            code: code.trim(),
            name: name.trim(),
            machineGroup,
            effectiveFrom,
            bonusMultiplier: bonusMultiplier.trim(),
            roundingMode,
            changeNote: changeNote.trim(),
          },
        },
        csrfToken,
      ),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: rateVersionsQueryKey });
      onCreated(created.id);
    },
    onError: (cause) => {
      setError(
        cause instanceof ApiClientError
          ? cause.message
          : "Draft belum dapat dibuat. Coba lagi.",
      );
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      !code.trim() ||
      !name.trim() ||
      !scheduleCode.trim() ||
      !/^\d+(?:\.\d+)?$/.test(bonusMultiplier.trim()) ||
      !effectiveFrom ||
      changeNote.trim().length < 5
    ) {
      setError(
        "Lengkapi kode jadwal, kode versi, nama, tanggal berlaku, pengali bonus, dan alasan minimal 5 karakter.",
      );
      return;
    }
    setError("");
    const key = attemptKey ?? crypto.randomUUID();
    setAttemptKey(key);
    mutation.mutate(key);
  }

  return (
    <section
      className="border border-info-border bg-info-soft p-3"
      aria-labelledby="create-rate-title"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="create-rate-title" className="text-sm font-bold">
          {versions.length > 0
            ? "Buat versi harga baru"
            : "Buat konfigurasi harga pertama"}
        </h2>
        <button
          type="button"
          className="min-h-8 px-2 text-xs font-semibold text-muted hover:text-foreground"
          onClick={onCancel}
        >
          Tutup
        </button>
      </div>
      <form
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={submit}
      >
        {versions.length > 0 ? (
          <div className="grid gap-x-3 gap-y-1 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:col-span-4">
            <label className="text-[0.6875rem] font-semibold">
              Duplikat dari
              <select
                aria-label="Duplikat dari versi"
                className="mt-1 min-h-8 w-full border border-border-strong bg-surface px-2 text-xs font-normal focus:outline-2 focus:outline-focus"
                value={source?.id ?? ""}
                onChange={(event) => onSourceChange(event.target.value)}
              >
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.code} · {GROUP_LABEL[version.machineGroup]} ·{" "}
                    {STATUS_LABEL[version.status]}
                  </option>
                ))}
                <option value="">Mulai kosong</option>
              </select>
            </label>
            <p className="self-end pb-1.5 text-[0.6875rem] text-info-strong">
              {source
                ? `Semua harga dan aturan perhitungan ${source.code} disalin ke draft baru. Tinggal isi tanggal berlaku dan alasan, lalu ubah harga yang berbeda saja.`
                : "Draft baru dimulai tanpa harga dan tanpa aturan perhitungan."}
            </p>
          </div>
        ) : null}
        {!source ? (
          <>
            <label className="text-[0.6875rem] font-semibold">
              Kode jadwal
              <input
                aria-label="Kode jadwal"
                className="mt-1 min-h-8 w-full border border-border-strong bg-surface px-2 text-xs focus:outline-2 focus:outline-focus"
                value={scheduleCode}
                onChange={(event) => {
                  setScheduleCode(event.target.value);
                  setAttemptKey(null);
                }}
              />
            </label>
            <label className="text-[0.6875rem] font-semibold">
              Kelompok mesin
              <select
                aria-label="Kelompok mesin"
                className="mt-1 min-h-8 w-full border border-border-strong bg-surface px-2 text-xs focus:outline-2 focus:outline-focus"
                value={machineGroup}
                onChange={(event) => {
                  setMachineGroup(
                    event.target.value as "REGULAR" | "CS" | "SP",
                  );
                  setAttemptKey(null);
                }}
              >
                <option value="REGULAR">Regular</option>
                <option value="CS">CS</option>
                <option value="SP">SP</option>
              </select>
            </label>
            <label className="text-[0.6875rem] font-semibold">
              Pengali bonus
              <input
                aria-label="Pengali bonus"
                inputMode="decimal"
                className="mt-1 min-h-8 w-full border border-border-strong bg-surface px-2 text-xs focus:outline-2 focus:outline-focus"
                value={bonusMultiplier}
                onChange={(event) => {
                  setBonusMultiplier(event.target.value);
                  setAttemptKey(null);
                }}
              />
            </label>
            <label className="text-[0.6875rem] font-semibold">
              Pembulatan
              <select
                aria-label="Pembulatan"
                className="mt-1 min-h-8 w-full border border-border-strong bg-surface px-2 text-xs focus:outline-2 focus:outline-focus"
                value={roundingMode}
                onChange={(event) => {
                  setRoundingMode(
                    event.target.value as
                      "HALF_UP_PER_LINE" | "HALF_UP_AT_PIN_TOTAL",
                  );
                  setAttemptKey(null);
                }}
              >
                <option value="HALF_UP_AT_PIN_TOTAL">Per total karyawan</option>
                <option value="HALF_UP_PER_LINE">Per baris produksi</option>
              </select>
            </label>
          </>
        ) : null}
        <label className="text-[0.6875rem] font-semibold">
          Kode versi
          <input
            aria-label="Kode versi baru"
            className="mt-1 min-h-8 w-full border border-border-strong bg-surface px-2 text-xs focus:outline-2 focus:outline-focus"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setAttemptKey(null);
            }}
          />
        </label>
        <label className="text-[0.6875rem] font-semibold">
          Nama versi
          <input
            aria-label="Nama versi baru"
            className="mt-1 min-h-8 w-full border border-border-strong bg-surface px-2 text-xs focus:outline-2 focus:outline-focus"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setAttemptKey(null);
            }}
          />
        </label>
        <label className="text-[0.6875rem] font-semibold">
          Berlaku mulai
          <input
            aria-label="Berlaku mulai versi baru"
            type="date"
            className="mt-1 min-h-8 w-full border border-border-strong bg-surface px-2 text-xs focus:outline-2 focus:outline-focus"
            value={effectiveFrom}
            onChange={(event) => {
              setEffectiveFrom(event.target.value);
              setAttemptKey(null);
            }}
          />
        </label>
        <label className="text-[0.6875rem] font-semibold">
          Alasan perubahan
          <input
            aria-label="Alasan perubahan versi baru"
            className="mt-1 min-h-8 w-full border border-border-strong bg-surface px-2 text-xs focus:outline-2 focus:outline-focus"
            value={changeNote}
            onChange={(event) => {
              setChangeNote(event.target.value);
              setAttemptKey(null);
            }}
          />
        </label>
        <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="min-h-8 rounded bg-brand px-3 text-xs font-bold text-white hover:bg-brand-strong disabled:bg-brand-disabled"
          >
            {mutation.isPending ? "Membuat…" : "Buat draft"}
          </button>
          {error ? (
            <p role="alert" className="text-xs font-semibold text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

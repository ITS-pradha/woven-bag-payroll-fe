import type { RateVersionOption } from "../api/summary-api";

export const MACHINE_GROUPS = ["REGULAR", "CS", "SP"] as const;
export type MachineGroup = (typeof MACHINE_GROUPS)[number];

/** Versi terpilih per machine group; group tanpa versi sama sekali tidak ada di sini. */
export type RateSelection = Partial<Record<MachineGroup, string>>;

/** Terbaru lebih dulu: tanggal berlaku, lalu nomor versi. */
export function versionsForGroup(
  versions: readonly RateVersionOption[],
  group: MachineGroup,
) {
  return versions
    .filter((version) => version.machineGroup === group)
    .sort((a, b) =>
      a.effectiveFrom === b.effectiveFrom
        ? b.versionNo - a.versionNo
        : a.effectiveFrom < b.effectiveFrom
          ? 1
          : -1,
    );
}

/**
 * Default per group: versi terbaru yang SEDANG berlaku hari ini. Versi ACTIVE
 * yang baru berlaku besok belum "sedang aktif", jadi dilewati. Tanpa versi
 * yang berlaku hari ini, jatuh ke versi terbaru apa pun — lebih baik dari
 * pilihan kosong yang membuat semua baris group itu BLOCKING.
 */
export function defaultRateSelection(
  versions: readonly RateVersionOption[],
  today: string,
): RateSelection {
  const selection: RateSelection = {};
  for (const group of MACHINE_GROUPS) {
    const candidates = versionsForGroup(versions, group);
    const current = candidates.find(
      (version) =>
        version.status === "ACTIVE" &&
        version.effectiveFrom <= today &&
        (!version.effectiveToExclusive || today < version.effectiveToExclusive),
    );
    const chosen = current ?? candidates[0];
    if (chosen) selection[group] = chosen.id;
  }
  return selection;
}

export function selectedRateVersionIds(selection: RateSelection): string[] {
  return MACHINE_GROUPS.flatMap((group) => {
    const id = selection[group];
    return id ? [id] : [];
  });
}

/** "24 Agu 2026 – 31 Agu 2026" / "sejak 1 Sep 2026"; akhir eksklusif ditampilkan inklusif. */
export function effectiveRangeLabel(version: RateVersionOption) {
  const from = dateLabel(version.effectiveFrom);
  if (!version.effectiveToExclusive) return `sejak ${from}`;
  return `${from} – ${dateLabel(previousDay(version.effectiveToExclusive))}`;
}

const MONTHS = [
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

function dateLabel(date: string) {
  const [year, month, day] = date.split("-");
  const name = MONTHS[Number(month) - 1];
  return year && name && day ? `${Number(day)} ${name} ${year}` : date;
}

function previousDay(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

import { normalizeDateInput } from "./rows";

/**
 * Peringatan buku periode yang harus terlihat SEBELUM Simpan gagal.
 *
 * Backend menolak setiap baris yang tanggalnya tidak tercakup buku mana pun
 * (`PERIOD_NOT_FOUND`), jadi hari pertama periode baru bisa memblokir semua
 * Simpan kalau HRD lupa membuka bukunya. Ini peringatan, bukan auto-create:
 * batas periode adalah data master dan keputusan manusia.
 *
 * Hari ini yang TIDAK tercakup buku mana pun sengaja tidak diperingatkan
 * (keputusan pemilik produk 2026-09-28): buku boleh dibuat untuk rentang
 * yang sudah lewat, dan admin yang sedang mengerjakan buku lama tidak perlu
 * didesak membuat buku untuk hari ini. Yang dijaga hanya satu hal — buku
 * yang sedang berjalan hampir habis tanpa penerus.
 *
 * Tanggal di sini selalu `YYYY-MM-DD` hari bisnis Asia/Jakarta, jadi
 * perbandingan string sama dengan perbandingan tanggal.
 */
export interface PeriodBookLike {
  code: string;
  periodStart: string;
  periodEnd: string;
}

/** Periode aktif yang tinggal sebanyak ini (atau kurang) memicu peringatan. */
export const NEXT_PERIOD_WARNING_DAYS = 3;

export interface PeriodWarning {
  kind: "NEXT_MISSING";
  current: PeriodBookLike;
  nextDate: string;
}

export function periodWarning(
  periods: readonly PeriodBookLike[],
  today: string,
): PeriodWarning | null {
  const current = periods.find(
    (period) => period.periodStart <= today && today <= period.periodEnd,
  );
  if (!current) return null;

  if (daysBetween(today, current.periodEnd) > NEXT_PERIOD_WARNING_DAYS)
    return null;
  const nextDate = addDays(current.periodEnd, 1);
  const covered = periods.some(
    (period) => period.periodStart <= nextDate && nextDate <= period.periodEnd,
  );
  return covered ? null : { kind: "NEXT_MISSING", current, nextDate };
}

export function periodWarningMessage(warning: PeriodWarning): string {
  return `Buku ${warning.current.code} berakhir ${warning.current.periodEnd} dan periode berikutnya belum ada. Buat periode yang mencakup ${warning.nextDate} sebelum tanggal itu, supaya Simpan tidak ditolak.`;
}

// Tanggal dihitung di UTC tengah malam supaya DST atau zona browser tidak
// menggeser selisih hari; nilainya tetap tanggal Jakarta yang diterima.
function daysBetween(from: string, to: string) {
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
    86_400_000
  );
}

function addDays(date: string, days: number) {
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return next.toISOString().slice(0, 10);
}

export interface PeriodDraft {
  code: string;
  periodStart: string;
  periodEnd: string;
}

/** Cut-off payroll woven bag: periode tanggal 24 s/d tanggal 23 bulan berikutnya. */
const CYCLE_START_DAY = 24;
const CYCLE_END_DAY = 23;

/**
 * Isian awal "Buat buku", selalu mengikuti siklus cut-off 24 s/d 23 — sama
 * dengan periode HRIS, supaya attendance dan produksi satu buku cocok persis.
 *
 * - Tanpa buku: siklus yang mencakup hari ini.
 * - Ada buku: siklus tepat setelah buku terakhir (berakhir 23 Sep → 24 Sep –
 *   23 Okt), supaya tidak bertumpuk dan tidak meninggalkan celah.
 * - Buku terakhir di luar siklus (mis. 1–30 Sep): buku peralihan dari hari
 *   sesudahnya sampai tanggal 23 berikutnya (1–23 Okt), lalu siklus normal.
 *   Memaksa mulai tanggal 24 di sini akan meninggalkan celah yang membuat
 *   Simpan ditolak `PERIOD_NOT_FOUND`.
 *
 * Kode dari bulan tanggal akhir (24 Sep – 23 Okt = `KARUNG-2026-10`). Hanya
 * saran — semua isian tetap bisa diubah, termasuk ke rentang yang sudah lewat.
 */
export function suggestNextPeriod(
  periods: readonly PeriodBookLike[],
  today: string,
  departmentCode: string,
): PeriodDraft {
  const latestEnd = periods.reduce<string | null>(
    (latest, period) =>
      latest === null || period.periodEnd > latest ? period.periodEnd : latest,
    null,
  );
  const periodStart = latestEnd ? addDays(latestEnd, 1) : cycleStartOf(today);
  const periodEnd = nextCycleEnd(periodStart);
  return {
    code: freeCode(periods, departmentCode, periodStart, periodEnd),
    periodStart,
    periodEnd,
  };
}

/** Tanggal 24 yang memulai siklus berisi `date`. */
function cycleStartOf(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const monthIndex = day! >= CYCLE_START_DAY ? month! - 1 : month! - 2;
  return isoDate(year!, monthIndex, CYCLE_START_DAY);
}

/** Tanggal 23 pertama SETELAH `start` (bukan hari itu sendiri). */
function nextCycleEnd(start: string) {
  const [year, month, day] = start.split("-").map(Number);
  // `>=`: buku yang dimulai tanggal 23 (sisa buku peralihan) berakhir tanggal
  // 23 bulan berikutnya, bukan hari itu juga — rentang satu hari bukan saran.
  const monthIndex = day! >= CYCLE_END_DAY ? month! : month! - 1;
  return isoDate(year!, monthIndex, CYCLE_END_DAY);
}

/** `monthIndex` boleh di luar 0..11; Date.UTC menggulirkannya ke tahun lain. */
function isoDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

/**
 * Kode buku unik di database. Bawaannya bulan tanggal akhir — bulan payroll
 * dibayarkan — lalu bulan tanggal mulai, karena buku lama bisa saja dinamai
 * dari bulan mulai, dan menyarankan kode yang sudah terpakai hanya berujung
 * penolakan saat Simpan.
 */
function freeCode(
  periods: readonly PeriodBookLike[],
  departmentCode: string,
  periodStart: string,
  periodEnd: string,
) {
  const taken = new Set(periods.map((period) => period.code));
  const candidates = [
    `${departmentCode}-${periodEnd.slice(0, 7)}`,
    `${departmentCode}-${periodStart.slice(0, 7)}`,
  ];
  const free = candidates.find((candidate) => !taken.has(candidate));
  if (free) return free;
  let suffix = 2;
  while (taken.has(`${candidates[0]}-${suffix}`)) suffix += 1;
  return `${candidates[0]}-${suffix}`;
}

/**
 * Baris yang Shift Start-nya jatuh DI LUAR buku yang sedang dibuka.
 *
 * Backend memilih buku per baris dari tanggal `shift_start` saja, bukan dari
 * buku yang sedang dilihat admin: baris 25 Sep yang disimpan dari buku 24 Agu
 * – 23 Sep masuk diam-diam ke buku berikutnya kalau buku itu terbuka, atau
 * ditolak kalau belum ada/sudah tutup. Keduanya sah, tapi admin perlu
 * melihatnya sebelum Simpan — salah ketik bulan terbaca seperti data biasa.
 *
 * Hanya tanggal yang terbaca `YYYY-MM-DD …` yang dinilai; format lain sudah
 * ditandai merah oleh validator dan tidak perlu diperingatkan dua kali.
 * Nomor baris 1-based, seperti `RowError.row`.
 */
export function rowsOutsideBook(
  drafts: readonly { cells: readonly string[] }[],
  book: Pick<PeriodBookLike, "periodStart" | "periodEnd">,
): { row: number; date: string }[] {
  const outside: { row: number; date: string }[] = [];
  drafts.forEach((draft, index) => {
    const date = /^(\d{4}-\d{2}-\d{2})\s/.exec(
      normalizeDateInput(draft.cells[0] ?? ""),
    )?.[1];
    if (date && (date < book.periodStart || date > book.periodEnd))
      outside.push({ row: index + 1, date });
  });
  return outside;
}

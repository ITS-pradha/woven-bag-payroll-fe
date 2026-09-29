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

/**
 * Isian awal "Buat buku": satu bulan tepat setelah buku terakhir, supaya buku
 * baru tidak bertumpuk dan tidak meninggalkan celah. Siklusnya mengikuti
 * tanggal mulai: buku yang mulai tanggal 1 berakhir di akhir bulan, buku
 * 24 Agu–23 Sep disusul 24 Sep–23 Okt. Tanpa buku sama sekali: bulan
 * kalender berjalan. Hanya saran — semua isian tetap bisa diubah, termasuk
 * ke rentang yang sudah lewat.
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
  const periodStart = latestEnd
    ? addDays(latestEnd, 1)
    : `${today.slice(0, 7)}-01`;
  const periodEnd = addDays(sameDayNextMonth(periodStart), -1);
  return {
    code: `${departmentCode}-${periodStart.slice(0, 7)}`,
    periodStart,
    periodEnd,
  };
}

/**
 * Tanggal yang sama bulan depan, dipotong ke akhir bulan bila bulan itu lebih
 * pendek (31 Jan -> 28/29 Feb), supaya hasilnya tidak meloncat ke Maret.
 */
function sameDayNextMonth(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  // Hari ke-0 dari bulan sesudahnya = hari terakhir bulan depan.
  const lastDay = new Date(Date.UTC(year!, month! + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year!, month!, Math.min(day!, lastDay)))
    .toISOString()
    .slice(0, 10);
}

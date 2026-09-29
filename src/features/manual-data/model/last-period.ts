/**
 * Buku periode yang terakhir dibuka, supaya kembali ke Manual Data (pindah
 * menu, reload, buka tab baru) membuka buku yang sama, bukan melompat ke buku
 * hari ini.
 *
 * Disimpan per user DAN per departemen: satu browser bisa dipakai bergantian,
 * dan buku admin lain tidak boleh terbuka diam-diam untuk orang berikutnya.
 * Yang disimpan hanya id — status dan tanggalnya selalu dibaca dari server,
 * jadi buku yang sudah ditutup di tempat lain tetap tampil tutup.
 *
 * Penyimpanan ini kenyamanan, bukan kebenaran: bisa kosong (mode privat) atau
 * melempar (penyimpanan situs diblokir). Keduanya jatuh ke pilihan bawaan.
 */
const PREFIX = "manual-data:last-period";

function keyFor(userId: string, departmentCode: string) {
  return `${PREFIX}:${departmentCode}:${userId}`;
}

export function readLastPeriod(
  userId: string,
  departmentCode: string,
): string | null {
  if (!userId) return null;
  try {
    return localStorage.getItem(keyFor(userId, departmentCode));
  } catch {
    return null;
  }
}

export function writeLastPeriod(
  userId: string,
  departmentCode: string,
  periodId: string,
) {
  if (!userId) return;
  try {
    localStorage.setItem(keyFor(userId, departmentCode), periodId);
  } catch {
    // Tidak bisa diingat; pilihan tetap berlaku sampai halaman ditinggalkan.
  }
}

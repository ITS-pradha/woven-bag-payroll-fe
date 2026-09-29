/**
 * Kode penolakan edit yang sama untuk tabel harga dan aturan kalkulasi.
 * Dipetakan dari `code`, bukan dari teks pesan server.
 */
export function rateEditErrorMessage(code: string): string | null {
  switch (code) {
    case "RATE_VERSION_LOCKED":
      return "Versi ini sudah dipakai payroll yang terkunci, jadi harganya tidak dapat diubah. Buat versi baru untuk perubahan berikutnya.";
    case "RATE_VERSION_IN_CALCULATION":
      return "Ada payroll yang sedang dihitung pada masa berlaku versi ini. Tunggu sampai selesai, lalu simpan lagi.";
    case "RATE_VERSION_ACTIVE_START_DATE":
      return "Tanggal mulai versi aktif tidak dapat diubah karena menyambung ke versi sebelumnya. Buat versi baru untuk mengubah tanggal berlaku.";
    case "RATE_VERSION_NOT_EDITABLE":
    case "RATE_VERSION_NOT_DRAFT":
      return "Versi ini tidak dapat diubah lagi.";
    default:
      return null;
  }
}

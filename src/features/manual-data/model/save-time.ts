/** "14.32" — jam Simpan terakhir, dalam waktu Asia/Jakarta. */
export function formatSaveTime(at: Date) {
  return at.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

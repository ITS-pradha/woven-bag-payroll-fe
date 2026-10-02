/** Proporsi kolom tabel summary, dipakai kerangka loading dan keadaan kosong. */
export const SUMMARY_COLUMNS = [10, 24, 48, 32, 32, 32, 32, 32, 24, 28, 20];
/** Judul kolom tabel summary, untuk sketsa keadaan kosong. */
export const SUMMARY_HEAD = [
  "",
  "PIN",
  "Nama karyawan",
  "Calc. base",
  "Base pay",
  "Calc. bonus",
  "Bonus pay",
  "Total pay",
  "Working days",
  "Status",
  "",
] as const;
/** Kartu metrik di atas tabel summary. */
export const SUMMARY_METRICS = [
  "Karyawan",
  "Total base pay",
  "Total bonus",
  "Total payroll",
  "Working days",
] as const;

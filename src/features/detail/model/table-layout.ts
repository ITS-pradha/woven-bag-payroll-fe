/** Proporsi kolom tabel Rincian produksi, supaya datanya muncul di tempat. */
export const PRODUCTION_COLUMNS = [
  36, 36, 16, 20, 20, 20, 20, 24, 24, 28, 28, 28, 32, 20,
];
/** Judul kolom tabel Rincian produksi, untuk sketsa keadaan kosong. */
export const PRODUCTION_HEAD = [
  "Shift start",
  "Shift end",
  "Mesin",
  "Width",
  "Weft",
  "Result",
  "Durasi",
  "Target",
  "Tarif/m",
  "Base pay",
  "Bonus",
  "Total",
  "Versi harga",
  "Trace",
] as const;

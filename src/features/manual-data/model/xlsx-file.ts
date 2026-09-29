/**
 * Terpisah dari `xlsx-import.ts` dengan sengaja: halaman perlu tahu apakah
 * sebuah file .xlsx tanpa ikut memuat pembaca zip-nya. Pembaca itu dimuat
 * lewat `import()` hanya saat file .xlsx benar-benar dipilih.
 */
export function isXlsxFile(file: { name: string; type: string }) {
  return (
    file.name.toLowerCase().endsWith(".xlsx") ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

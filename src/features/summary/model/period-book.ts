import type { PayrollPeriod } from "../api/summary-api";
import { formatDay } from "./format-day";

/** Terbaru di atas, seperti cara admin mencari buku bulan berjalan. */
export function sortPeriodBooks(books: readonly PayrollPeriod[]) {
  return [...books].sort((a, b) => b.periodStart.localeCompare(a.periodStart));
}

/**
 * Buku aktif diturunkan, tidak disimpan: pilihan pengguna bila masih ada di
 * daftar, lalu buku yang mencakup hari ini, lalu yang terbaru.
 */
export function selectPeriodBook(
  books: readonly PayrollPeriod[],
  pickedId: string | null,
  today: string,
): PayrollPeriod | null {
  if (pickedId) {
    const picked = books.find((book) => book.id === pickedId);
    if (picked) return picked;
  }
  return (
    books.find(
      (book) => book.periodStart <= today && today <= book.periodEnd,
    ) ??
    sortPeriodBooks(books)[0] ??
    null
  );
}

export function periodBookLabel(book: PayrollPeriod) {
  const range = `${formatDay(book.periodStart)} – ${formatDay(book.periodEnd)}`;
  return book.status === "CLOSED"
    ? `${book.code} · ${range} · TUTUP`
    : `${book.code} · ${range}`;
}

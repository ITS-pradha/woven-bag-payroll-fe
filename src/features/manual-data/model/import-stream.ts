import {
  DelimitedParser,
  detectDelimiter,
  findImportHeader,
  IMPORT_HEADER_SCAN_ROWS,
  importRowProblem,
  isBlankRow,
  mapImportHeader,
  ROW_FIELD,
  toImportCells,
  validateRows,
  type BatchInput,
  type ImportHeader,
} from "./rows";

/**
 * Impor file besar tanpa melewati grid.
 *
 * Grid adalah permukaan edit, bukan alat angkut: kapasitasnya terbatas
 * (`MAX_ROWS`) dan Simpan-nya menahan seluruh draft di memori. File yang lebih besar tidak punya
 * alasan lewat sana — dibaca sebagai stream, divalidasi per batch, lalu dikirim ke
 * `POST /production-entry-batches`. Memori yang dipakai sebesar satu batch,
 * bukan sebesar file, jadi file 200 ribu baris memakai memori yang sama dengan
 * file 2 ribu baris.
 *
 * Batas baris dihapus di jalur ini. Yang tersisa cuma batas kontrak: satu
 * request maksimal 10.000 baris (openapi `ProductionEntryBatchRequest`).
 */
/**
 * Diukur terhadap Postgres sungguhan: satu batch 10.000 baris tersimpan dalam
 * ~1,45 detik, 2.000 baris dalam ~0,45 detik. Batch besar lebih sedikit
 * round-trip, batch kecil membuat progres lebih halus dan unit retry lebih
 * murah kalau satu batch gagal. 5.000 ada di tengah, dan tetap di bawah batas
 * kontrak 10.000 baris per request.
 */
export const IMPORT_BATCH_ROWS = 5_000;

export interface ImportRejection {
  /** Nomor baris di file, bukan di batch — supaya bisa dicari di spreadsheet. */
  row: number;
  field: string;
  value: string;
  message: string;
}

export interface ImportProgress {
  rowsRead: number;
  rowsSent: number;
  batches: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
}

export interface ImportSummary extends ImportProgress {
  headerDetected: boolean;
  unknownColumns: string[];
  /** Baris tak kosong di atas baris judul yang dilewati. */
  skippedBeforeHeader: number;
  delimiter: string;
  rejections: ImportRejection[];
  /** True kalau daftar penolakan dipotong karena terlalu panjang. */
  rejectionsTruncated: boolean;
}

export interface ImportOptions {
  /** Potongan teks berurutan dari file. */
  chunks: AsyncIterable<string>;
  send: (rows: BatchInput[], key: string) => Promise<BatchResult>;
  /**
   * Satu kunci per percobaan impor. Kunci tiap batch DITURUNKAN darinya
   * (`<importKey>-<n>`), jadi mengulang impor yang sama setelah gagal di
   * tengah memutar ulang batch yang sudah tersimpan alih-alih menulisnya dua
   * kali. Ulang dengan kunci yang sama hanya untuk file yang sama persis.
   */
  importKey?: string;
  /** Dipakai hanya bila `importKey` tidak diberikan: kunci acak per batch. */
  newKey?: () => string;
  onProgress?: (progress: ImportProgress) => void;
  signal?: AbortSignal;
  batchSize?: number;
}

export interface BatchResult {
  counts: {
    inserted: number;
    updated: number;
    unchanged: number;
    rejected: number;
  };
  rows: {
    clientRowId: string;
    outcome: "INSERTED" | "UPDATED" | "UNCHANGED" | "REJECTED";
    fieldErrors?: { field: string; message: string; code: string }[];
  }[];
}

/** Daftar penolakan dibatasi supaya laporan tidak ikut membesar tanpa batas. */
const MAX_REJECTIONS_KEPT = 1_000;

export class ImportAborted extends Error {
  constructor() {
    super("Impor dibatalkan. Batch yang sudah terkirim tetap tersimpan.");
  }
}

/**
 * PIN sengaja TIDAK diresolusi di klien pada jalur ini. Jalur paste melakukannya
 * untuk menampilkan nama di grid; di sini tidak ada yang ditampilkan, dan satu
 * request per PIN akan jadi ribuan request. Server yang memutuskan PIN sah atau
 * tidak, dan menolaknya per baris — itu memang otoritasnya.
 */
export async function importProductionStream(
  options: ImportOptions,
): Promise<ImportSummary> {
  const batchSize = Math.min(options.batchSize ?? IMPORT_BATCH_ROWS, 10_000);
  const progress: ImportProgress = {
    rowsRead: 0,
    rowsSent: 0,
    batches: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
  };

  const rejections: ImportRejection[] = [];
  let rejectionsTruncated = false;
  const keepRejection = (item: ImportRejection) => {
    if (rejections.length < MAX_REJECTIONS_KEPT) rejections.push(item);
    else rejectionsTruncated = true;
  };

  const seenKeys = new Set<string>();
  /** Nomor batch yang sudah dibentuk, termasuk yang tidak berisi baris terkirim. */
  let batchIndex = 0;
  const batchKey = () => {
    const index = batchIndex++;
    return options.importKey
      ? `${options.importKey}-${index}`
      : (options.newKey?.() ?? crypto.randomUUID());
  };
  let header: ImportHeader | null = null;
  /** Baris tak kosong yang ditahan sampai baris judul bisa diputuskan. */
  let scanned: { raw: string[]; row: number }[] = [];
  let skippedBeforeHeader = 0;
  let delimiter = "";
  let parser: DelimitedParser | null = null;
  let leading = "";
  let fileRow = 0;
  let pending: { cells: string[]; row: number; problem: string | null }[] = [];

  const flush = async (force: boolean) => {
    while (pending.length >= (force ? 1 : batchSize)) {
      if (options.signal?.aborted) throw new ImportAborted();

      const slice = pending.slice(0, batchSize);
      pending = pending.slice(batchSize);

      const drafts = slice.map((item) => ({
        key: `import-${item.row}`,
        cells: item.cells,
      }));
      const rowNumbers = new Map(drafts.map((d, i) => [d.key, slice[i]!.row]));

      // Baris yang sudah bermasalah sebelum validasi (kolom lebih) tidak ikut
      // divalidasi: kuncinya tidak boleh memesan tempat di `seenKeys`.
      const checked = drafts.filter((_, index) => !slice[index]!.problem);
      const { rows, errors } = validateRows(checked, new Map(), seenKeys, {
        reserve: "passing",
      });

      // `validateRows` tetap mengembalikan baris yang punya error supaya grid
      // bisa menampilkannya berdampingan. Impor tidak boleh mengirimnya: satu
      // baris duplikat yang lolos akan menimpa produksi yang sudah benar.
      const failed = new Set(
        errors.map((error) => checked[error.row - 1]?.key),
      );
      const sendable = rows.filter((row) => !failed.has(row.clientRowId));

      // Satu baris dengan tiga sel salah tetap SATU baris ditolak: hitungannya
      // dibandingkan dengan "baris dibaca", bukan dengan jumlah pesan.
      const rejectedRows = new Set<number>();
      for (const item of slice) {
        if (!item.problem) continue;
        rejectedRows.add(item.row);
        keepRejection({
          row: item.row,
          field: ROW_FIELD,
          value: "",
          message: item.problem,
        });
      }
      for (const error of errors) {
        const row = rowNumbers.get(checked[error.row - 1]?.key ?? "") ?? 0;
        rejectedRows.add(row);
        keepRejection({
          row,
          field: error.field,
          value: error.value,
          message: error.message,
        });
      }
      progress.rejected += rejectedRows.size;

      // Dibentuk untuk setiap batch, terkirim atau tidak, supaya nomor batch
      // — dan karena itu kuncinya — sama di setiap ulangan file yang sama.
      const key = batchKey();
      if (sendable.length) {
        const result = await options.send(sendable, key);

        progress.batches += 1;
        progress.rowsSent += sendable.length;
        progress.inserted += result.counts.inserted;
        progress.updated += result.counts.updated;
        progress.unchanged += result.counts.unchanged;
        progress.rejected += result.counts.rejected;

        for (const row of result.rows) {
          if (row.outcome !== "REJECTED") continue;
          for (const error of row.fieldErrors ?? [])
            keepRejection({
              row: rowNumbers.get(row.clientRowId) ?? 0,
              field: error.field,
              value: "",
              message: error.message,
            });
        }
      }

      options.onProgress?.({ ...progress });
      if (!force && pending.length < batchSize) return;
    }
  };

  const enqueue = (shape: ImportHeader, raw: string[], row: number) => {
    progress.rowsRead += 1;
    pending.push({
      cells: toImportCells(raw, shape),
      row,
      problem: importRowProblem(raw, shape),
    });
  };

  /**
   * Baris judul diputuskan setelah `IMPORT_HEADER_SCAN_ROWS` baris tak kosong
   * terkumpul (atau file habis) — aturan yang sama dengan `parseImportFile`,
   * jadi file yang sama terbaca sama lewat grid maupun lewat stream.
   */
  const resolveHeader = () => {
    const at = findImportHeader(scanned.map((item) => item.raw));
    const shape = mapImportHeader(
      at >= 0 ? scanned[at]!.raw : (scanned[0]?.raw ?? []),
    );
    header = shape;
    skippedBeforeHeader = Math.max(0, at);
    for (const item of scanned.slice(at + 1))
      enqueue(shape, item.raw, item.row);
    scanned = [];
  };

  const take = async (rows: string[][], last = false) => {
    for (const raw of rows) {
      fileRow += 1;
      if (isBlankRow(raw)) continue;

      if (!header) {
        scanned.push({ raw, row: fileRow });
        if (scanned.length >= IMPORT_HEADER_SCAN_ROWS) resolveHeader();
        continue;
      }

      enqueue(header, raw, fileRow);
    }
    if (last && !header && scanned.length) resolveHeader();

    await flush(false);
  };

  for await (const chunk of options.chunks) {
    if (options.signal?.aborted) throw new ImportAborted();

    if (!parser) {
      // Pemisah ditentukan dari baris pertama yang punya pemisah, jadi
      // potongan awal ditahan sampai baris itu lengkap — file satu baris pun
      // tetap terbaca lewat `finish`.
      leading += chunk.replace(/^\uFEFF/, "");
      if (!readyToDetect(leading)) continue;

      delimiter = detectDelimiter(leading);
      parser = new DelimitedParser(delimiter);
      await take(parser.push(leading));
      leading = "";
      continue;
    }

    await take(parser.push(chunk));
  }

  if (!parser) {
    if (!leading.trim()) throw new Error("File impor kosong.");
    delimiter = detectDelimiter(leading);
    parser = new DelimitedParser(delimiter);
    await take(parser.push(leading));
  }

  await take(parser.finish(), true);
  await flush(true);

  if (!progress.rowsRead)
    throw new Error("File impor tidak berisi baris data.");

  const shape = header as ImportHeader | null;
  if (shape?.headerDetected && shape.mapped.every((column) => column === -1))
    throw new Error("Tidak ada kolom yang dikenali pada baris judul.");

  return {
    ...progress,
    headerDetected: shape?.headerDetected ?? false,
    unknownColumns: shape?.unknownColumns ?? [],
    skippedBeforeHeader,
    delimiter,
    rejections,
    rejectionsTruncated,
  };
}

/**
 * Cukup teks untuk memilih pemisah seperti `detectDelimiter` pada file utuh:
 * satu baris lengkap yang berisi pemisah, atau sudah sebanyak baris yang
 * dipindainya. Judul laporan di baris pertama tidak berisi pemisah apa pun.
 */
function readyToDetect(text: string) {
  if (text.length > 1024 * 1024) return true;
  const complete = text.split(/\r\n|\n|\r/).slice(0, -1);
  return (
    complete.length >= IMPORT_HEADER_SCAN_ROWS ||
    complete.some((line) => /[\t;,]/.test(line))
  );
}

/** Potongan teks dari `File`, tanpa pernah menahan seluruh isinya di memori. */
export async function* fileTextChunks(file: File): AsyncIterable<string> {
  const decoder = new TextDecoder();
  const reader = file.stream().getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // `stream: true` menjaga karakter multi-byte yang terbelah antar potongan.
      yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/** Laporan baris ditolak sebagai CSV, supaya bisa dibuka di spreadsheet asalnya. */
export function rejectionReportCsv(rejections: readonly ImportRejection[]) {
  const escape = (value: string) =>
    /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  return [
    "Baris file,Kolom,Nilai,Alasan",
    ...rejections.map((item) =>
      [item.row, item.field, item.value, item.message]
        .map(String)
        .map(escape)
        .join(","),
    ),
  ].join("\n");
}

import {
  DelimitedParser,
  detectDelimiter,
  mapImportHeader,
  toImportCells,
  validateRows,
  type BatchInput,
  type ImportHeader,
} from "./rows";

/**
 * Impor file besar tanpa melewati grid.
 *
 * Grid adalah permukaan edit, bukan alat angkut: kapasitasnya 10.000 baris
 * karena itu batas satu batch di kontrak. File yang lebih besar tidak punya
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
  delimiter: string;
  rejections: ImportRejection[];
  /** True kalau daftar penolakan dipotong karena terlalu panjang. */
  rejectionsTruncated: boolean;
}

export interface ImportOptions {
  /** Potongan teks berurutan dari file. */
  chunks: AsyncIterable<string>;
  send: (rows: BatchInput[], key: string) => Promise<BatchResult>;
  newKey: () => string;
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
  let header: ImportHeader | null = null;
  let delimiter = "";
  let parser: DelimitedParser | null = null;
  let leading = "";
  let fileRow = 0;
  let pending: { cells: string[]; row: number }[] = [];

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

      const { rows, errors } = validateRows(drafts, new Map(), seenKeys);

      // `validateRows` tetap mengembalikan baris yang punya error supaya grid
      // bisa menampilkannya berdampingan. Impor tidak boleh mengirimnya: satu
      // baris duplikat yang lolos akan menimpa produksi yang sudah benar.
      const failed = new Set(
        errors.map((error) => drafts[error.row - 1]?.key).filter(Boolean),
      );
      const sendable = rows.filter((row) => !failed.has(row.clientRowId));

      for (const error of errors) {
        progress.rejected += 1;
        keepRejection({
          row: slice[error.row - 1]?.row ?? error.row,
          field: error.field,
          value: error.value,
          message: error.message,
        });
      }

      if (sendable.length) {
        const result = await options.send(sendable, options.newKey());

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

  const take = async (rows: string[][]) => {
    for (const raw of rows) {
      fileRow += 1;

      if (!header) {
        header = mapImportHeader(raw);
        if (header.headerDetected) continue;
      }

      const shape: ImportHeader = header;
      if (raw.every((cell) => cell.trim() === "")) continue;

      progress.rowsRead += 1;
      pending.push({ cells: toImportCells(raw, shape, fileRow), row: fileRow });
    }

    await flush(false);
  };

  for await (const chunk of options.chunks) {
    if (options.signal?.aborted) throw new ImportAborted();

    if (!parser) {
      // Pemisah ditentukan dari baris pertama, jadi potongan awal ditahan
      // sampai ada newline — file satu baris pun tetap terbaca lewat `finish`.
      leading += chunk.replace(/^\uFEFF/, "");
      if (!leading.includes("\n") && !leading.includes("\r")) continue;

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

  await take(parser.finish());
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
    delimiter,
    rejections,
    rejectionsTruncated,
  };
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

import { z } from "zod";
import type { components } from "../../../api/generated/schema";

export type Entry = components["schemas"]["ProductionEntry"];
export type Employee = components["schemas"]["Employee"];
export type BatchInput = components["schemas"]["ProductionEntryInput"];
/**
 * Kapasitas grid: 10.000 baris, dua puluh kali kapasitas lama.
 *
 * Univer sendiri sanggup jauh lebih banyak — `cellData`-nya sparse dan
 * rendernya per viewport — dan kode di sini sudah tidak lagi memindai seluruh
 * kapasitas tiap perubahan. Yang membatasi justru kontrak: satu
 * `POST /production-entry-batches` maksimal 10.000 baris (openapi
 * `ProductionEntryBatchRequest`), dan grid menyimpan seluruh draft-nya untuk
 * dikirim sebagai SATU batch supaya Simpan tetap satu operasi yang bisa
 * di-retry dengan idempotency key yang sama.
 *
 * Data yang lebih besar dari ini masuk lewat Impor file, yang memang mengirim
 * per batch dan tidak lewat grid sama sekali.
 */
export const MAX_ROWS = 100_000;
export const columns = [
  "Shift Start",
  "Shift End",
  "Station",
  "Assignee",
  "Width [cm]",
  "Weft [s/in]",
  "Result [m]",
] as const;
export type Baseline = Omit<Entry, "createdAt" | "updatedAt">;
export interface DraftRow {
  key: string;
  cells: string[];
  original?: Baseline;
}
export interface RowError {
  row: number;
  field: string;
  value: string;
  message: string;
}

export function toJakartaInput(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Date(time + 7 * 3600_000).toISOString().slice(0, 19).replace("T", " ")
    : value;
}

const SPREADSHEET_EPOCH_UTC = Date.UTC(1899, 11, 30);
const SECONDS_PER_DAY = 86_400;

/**
 * Spreadsheet apps copy date cells as a day serial in some clipboard paths.
 * Treat the value as a wall-clock value (not an instant) so 23:00 remains
 * 23:00 when it is later encoded with the Jakarta offset.
 */
export function normalizeDateInput(value: string) {
  const text = value.trim().replace("T", " ");

  // Spreadsheets export a single-digit hour: Google Sheets writes
  // "2026-07-01 7:00", never "07:00". Rejecting that failed every row of a
  // real export while the panel promised the format would be tidied up, so
  // the padding happens here — once, for both the paste and the import path.
  const parts =
    /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (parts) {
    const pad = (part: string) => part.padStart(2, "0");
    return (
      `${parts[1]}-${pad(parts[2]!)}-${pad(parts[3]!)} ` +
      `${pad(parts[4]!)}:${parts[5]}${parts[6] ? `:${parts[6]}` : ""}`
    );
  }

  if (!/^\d+(\.\d+)?$/.test(text)) return text;
  const serial = Number(text);
  if (!Number.isFinite(serial) || serial < 60) return text;
  const time =
    SPREADSHEET_EPOCH_UTC + Math.round(serial * SECONDS_PER_DAY) * 1_000;
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return text;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Turns a spreadsheet's decimal comma into the dot this app stores.
 *
 * Measured on a real 15,141-row export: 9,435 of its Weft values were written
 * "12,2" while its one Result value was "1902.4" — the same file mixing both
 * conventions, because a sheet formats per column. Rejecting the comma made
 * every one of those rows fail on a value that was never wrong, only written
 * in the operator's locale.
 *
 * What it will NOT do is guess "1,902". Comma followed by exactly three digits
 * is either 1902 grouped or 1.902 as a decimal, and there is no way to tell
 * from the value alone. Choosing wrong misstates a payroll figure by a factor
 * of a thousand, so that shape is left untouched for a human to rewrite.
 */
export function normalizeDecimalInput(value: string) {
  const text = value.trim();
  if (!text.includes(",") || !/^\d[\d.,]*$/.test(text)) return text;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");

  // Both separators present: the rightmost one is the decimal point and the
  // other groups digits. "1,902.4" and "1.902,4" both mean 1902.4.
  if (lastDot >= 0) {
    return lastComma > lastDot
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "");
  }

  // Comma only. Two or more groups of three can only be digit grouping.
  if (/^\d{1,3}(,\d{3}){2,}$/.test(text)) return text.replace(/,/g, "");

  // Exactly one group of three is the ambiguous case described above.
  if (/^\d{1,3},\d{3}$/.test(text)) return text;

  // Anything else with a single comma is a decimal comma.
  return /^\d+,\d+$/.test(text) ? text.replace(",", ".") : text;
}

/** True for the one shape this refuses to guess, so it can be explained. */
export function isAmbiguousDecimal(value: string) {
  return /^\d{1,3},\d{3}$/.test(value.trim());
}

export function normalizePastedCells(
  rows: readonly (readonly string[])[],
  firstColumn: number,
) {
  return rows.map((row) =>
    row.map((value, index) => {
      const column = firstColumn + index;
      if (column === 1 || column === 2) return normalizeDateInput(value);
      // Width, Weft, Result — the three decimal columns.
      return column >= 5 && column <= 7 ? normalizeDecimalInput(value) : value;
    }),
  );
}

function parseDate(value: string) {
  const text = normalizeDateInput(value);
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(:\d{2})?$/.exec(text);
  if (!match) return null;
  const result = `${match[1]}T${match[2]}${match[3] ?? ":00"}+07:00`;
  return toJakartaInput(result) ===
    `${match[1]} ${match[2]}${match[3] ?? ":00"}`
    ? result
    : null;
}

const decimal = z.string().regex(/^\d+(\.\d+)?$/);
/**
 * Draft rows whose cell in `field` holds exactly `value`, as 1-based grid rows.
 *
 * Shared by the bulk fix and the bulk delete so the two can never act on
 * different sets: "Terapkan" and "Hapus" on one entry of the problem panel
 * have to mean the same rows.
 *
 * Read from the drafts passed in, never from row numbers remembered earlier.
 * The error list is only recomputed by an explicit validate, so typing into a
 * cell leaves those numbers pointing at rows whose contents have moved on —
 * and acting on them hits whatever took their place.
 *
 * Trimmed exact match, never a prefix: correcting one operator must not touch
 * another whose identity happens to begin the same way.
 */
export function rowsWithValue(
  drafts: DraftRow[],
  field: string,
  value: string,
): number[] {
  const column = (columns as readonly string[]).indexOf(field);
  if (column < 0) return [];

  return drafts.flatMap((draft, index) =>
    (draft.cells[column] ?? "").trim() === value ? [index + 1] : [],
  );
}

export function validateRows(
  drafts: DraftRow[],
  labels: ReadonlyMap<string, string>,
  /**
   * Kunci unik yang sudah terpakai. Impor file memanggil ini per batch, jadi
   * duplikat baru ketahuan kalau set-nya dibagi antar batch — tanpa itu file
   * yang mengulang satu shift di batch berbeda lolos sampai ke database.
   */
  seenKeys: Set<string> = new Set(),
) {
  const errors: RowError[] = [];
  const rows: BatchInput[] = [];
  const keys = seenKeys;
  drafts.forEach((draft, index) => {
    const values = draft.cells.map((value) => value.trim());
    if (values.every((value) => value === "") && !draft.original) return;
    const fail = (col: number, message: string) =>
      errors.push({
        row: index + 1,
        field: columns[col] ?? "Baris",
        value: values[col] ?? "",
        message,
      });
    const start = parseDate(values[0] ?? "");
    const end = parseDate(values[1] ?? "");
    if (!start) fail(0, "Gunakan tanggal valid YYYY-MM-DD HH:mm (WIB).");
    if (!end) fail(1, "Gunakan tanggal valid YYYY-MM-DD HH:mm (WIB).");
    if (start && end && Date.parse(end) <= Date.parse(start))
      fail(1, "Shift end harus setelah shift start.");
    const stationNo = Number(values[2]);
    if (
      !/^\d+$/.test(values[2] ?? "") ||
      !Number.isSafeInteger(stationNo) ||
      stationNo <= 0
    )
      fail(2, "Nomor mesin harus bilangan bulat positif.");
    const assignee = values[3] ?? "";
    // Labels originate from API choices. Raw numeric PINs are resolved by the server.
    const pin =
      labels.get(assignee) ?? (/^\d+$/.test(assignee) ? assignee : "");
    if (!pin)
      fail(
        3,
        "Pilih karyawan dari pencarian atau tempel PIN numerik yang valid.",
      );
    for (const col of [4, 5, 6]) {
      const value = values[col] ?? "";
      if (
        !decimal.safeParse(value).success ||
        (col !== 6 && /^0+(\.0+)?$/.test(value))
      )
        fail(
          col,
          value === ""
            ? // Never defaulted to 0: an empty Result may mean the loom made
              // nothing, or that nobody filled it in. Writing 0 invents
              // production and costs the operator the pay for that roll.
              "Kosong. Tulis 0 kalau memang tidak menghasilkan, atau isi angkanya."
            : isAmbiguousDecimal(value)
              ? `"${value}" bisa berarti ${value.replace(",", "")} atau ${value.replace(",", ".")}. Tulis ulang memakai titik.`
              : col === 6
                ? "Isi angka desimal ≥ 0, gunakan titik."
                : "Isi angka desimal > 0, gunakan titik.",
        );
    }
    if (draft.original?.status === "VOID")
      fail(0, "Data VOID tidak dapat diubah.");
    const unique = `${start}|${end}|${stationNo}`;
    if (keys.has(unique))
      fail(2, "Duplikat shift start, shift end, dan station dalam workspace.");
    keys.add(unique);
    if (start && end)
      rows.push({
        clientRowId: draft.key,
        shiftStart: start,
        shiftEnd: end,
        stationNo,
        pin,
        widthCm: values[4] ?? "",
        weftDensity: values[5] ?? "",
        resultMeter: values[6] ?? "",
        ...(draft.original
          ? { expectedRowVersion: draft.original.rowVersion }
          : {}),
      });
  });
  return { rows, errors };
}

export function entryCells(entry: Baseline, name?: string): string[] {
  return [
    toJakartaInput(entry.shiftStart),
    toJakartaInput(entry.shiftEnd),
    String(entry.stationNo),
    name ?? entry.pin,
    entry.widthCm,
    entry.weftDensity,
    entry.resultMeter,
  ];
}

export function isChanged(row: BatchInput, original?: Baseline) {
  if (!original) return true;
  return (
    Date.parse(row.shiftStart) !== Date.parse(original.shiftStart) ||
    Date.parse(row.shiftEnd) !== Date.parse(original.shiftEnd) ||
    row.stationNo !== original.stationNo ||
    row.pin !== original.pin ||
    row.widthCm !== original.widthCm ||
    row.weftDensity !== original.weftDensity ||
    row.resultMeter !== original.resultMeter
  );
}

/** Bounded quoted TSV parser. No truncation, formulas are rejected by validation. */
export function parseClipboard(text: string): string[][] {
  const result = parseDelimited(text, "\t");
  const width = result[0]?.length ?? 0;
  if (
    result.length > MAX_ROWS ||
    width > 7 ||
    result.some((item) => item.length !== width)
  )
    throw new Error(
      `Tempel rentang persegi, maksimal ${MAX_ROWS.toLocaleString("id-ID")} baris dan 7 kolom. Untuk lebih banyak pakai Impor file.`,
    );
  return result;
}

/**
 * Parser delimited yang bisa disuapi potongan teks berurutan.
 *
 * Bentuknya inkremental supaya file besar tidak perlu ada di memori sekaligus:
 * jalur impor membacanya dari stream dan mengirim per batch, sementara jalur
 * clipboard memakai `parseDelimited` yang membungkusnya. Aturan kutip, CRLF,
 * dan escape `""` cuma ada di sini — CSV dan clipboard memang cuma beda
 * pemisah.
 */
export class DelimitedParser {
  private row: string[] = [];
  private cell = "";
  private quoted = false;
  private pendingCr = false;

  constructor(private readonly delimiter: string) {}

  /** Baris yang selesai pada potongan ini. Sisa baris menunggu `finish()`. */
  push(text: string): string[][] {
    const result: string[][] = [];

    for (let i = 0; i < text.length; i++) {
      const char = text[i]!;

      // CRLF bisa terbelah antar potongan stream; LF setelah CR yang sudah
      // menutup baris dibuang di sini.
      if (this.pendingCr) {
        this.pendingCr = false;
        if (char === "\n") continue;
      }

      if (char === '"') {
        if (this.quoted && text[i + 1] === '"') {
          this.cell += '"';
          i++;
        } else if (this.quoted || this.cell === "") this.quoted = !this.quoted;
        else this.cell += char;
      } else if (
        !this.quoted &&
        (char === this.delimiter || char === "\n" || char === "\r")
      ) {
        this.row.push(this.cell);
        this.cell = "";
        if (char !== this.delimiter) {
          result.push(this.row);
          this.row = [];
          if (char === "\r") this.pendingCr = true;
        }
      } else this.cell += char;
    }

    return result;
  }

  /** Baris terakhir yang tidak diakhiri newline. Melempar kalau kutip menggantung. */
  finish(): string[][] {
    if (this.quoted) throw new Error("Tanda kutip clipboard tidak lengkap.");
    if (this.cell === "" && !this.row.length) return [];

    this.row.push(this.cell);
    const last = this.row;
    this.row = [];
    this.cell = "";
    return [last];
  }
}

function parseDelimited(text: string, delimiter: string): string[][] {
  if (text.length > 8_000_000)
    throw new Error(
      "Clipboard terlalu besar (maksimal 8 MB). Untuk data sebesar ini pakai Impor file.",
    );

  const parser = new DelimitedParser(delimiter);
  const result = [...parser.push(text), ...parser.finish()];

  if (!result.length) throw new Error("Clipboard kosong.");
  return result;
}

/**
 * Nama kolom yang diterima file impor. Satu kolom boleh ditulis dengan nama
 * apa pun di daftar ini; pencocokannya mengabaikan huruf besar, spasi, garis
 * bawah, dan satuan dalam kurung siku — "Width [cm]", "width_cm", dan "lebar"
 * sama-sama dikenali.
 */
const IMPORT_HEADER_ALIASES: readonly (readonly string[])[] = [
  ["shiftstart", "start", "starttime", "waktumulai", "mulai", "jammulai"],
  ["shiftend", "end", "endtime", "waktuselesai", "selesai", "jamselesai"],
  ["station", "stationno", "mesin", "nomesin", "loom"],
  ["assignee", "pin", "operator", "karyawan", "nik"],
  ["width", "widthcm", "lebar", "lebarcm"],
  ["weft", "weftdensity", "weftsin", "kepadatan", "pick", "picks"],
  ["result", "resultm", "resultmeter", "hasil", "hasilm", "meter", "produksi"],
];

const IMPORT_DELIMITERS = ["\t", ";", ","] as const;

export interface ImportedFile {
  /** Selalu tepat 7 kolom per baris, urut sesuai `columns`. */
  cells: string[][];
  delimiter: (typeof IMPORT_DELIMITERS)[number];
  /** True ketika baris pertama dikenali sebagai header dan dibuang. */
  headerDetected: boolean;
  /** Judul kolom file yang tidak dikenali — dilaporkan, tidak fatal. */
  unknownColumns: string[];
  /** Kolom grid yang diisi dari posisi karena judulnya kosong di file. */
  assumedColumns: string[];
}

function headerKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\[.*?\]|\(.*?\)/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Pemisah dipilih dari baris pertama DI LUAR tanda kutip: file Indonesia
 * sering memakai titik koma karena koma sudah dipakai desimal, dan menebak
 * "koma" untuk file semacam itu memecah setiap baris jadi kolom sampah.
 */
export function detectDelimiter(
  text: string,
): (typeof IMPORT_DELIMITERS)[number] {
  let quoted = false;
  const counts = new Map<string, number>(
    IMPORT_DELIMITERS.map((item) => [item, 0]),
  );

  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (char === "\n" && !quoted) break;
    else if (!quoted && counts.has(char))
      counts.set(char, (counts.get(char) ?? 0) + 1);
  }

  // Urutan preferensi tab -> titik koma -> koma dipertahankan saat seri.
  return IMPORT_DELIMITERS.find((item) => (counts.get(item) ?? 0) > 0) ?? "\t";
}

/**
 * Membaca isi file impor Manual Data menjadi sel yang siap ditempel.
 *
 * Header opsional: file tanpa header dianggap sudah urut seperti kolom grid.
 * Kalau ada header, kolomnya diurutkan ulang mengikuti header itu — file yang
 * kolomnya tertukar tidak boleh diam-diam masuk ke kolom yang salah.
 */
export interface ImportHeader {
  headerDetected: boolean;
  /** Indeks kolom grid untuk tiap kolom file; -1 berarti kolom tidak dikenali. */
  mapped: number[];
  unknownColumns: string[];
  /** Kolom grid yang diisi dari posisi karena judulnya kosong. */
  assumedColumns: string[];
}

/**
 * Header dianggap ada kalau minimal 4 dari 7 kolom dikenali. Ambang itu
 * membedakan baris judul dari baris data yang kebetulan berisi teks, tanpa
 * menuntut file memakai nama kolom yang persis sama.
 */
export function mapImportHeader(first: readonly string[]): ImportHeader {
  const mapped = first.map((value) =>
    IMPORT_HEADER_ALIASES.findIndex((aliases) =>
      aliases.includes(headerKey(value)),
    ),
  );
  const headerDetected = mapped.filter((index) => index >= 0).length >= 4;

  /*
   * A column whose header cell is EMPTY keeps its position instead of being
   * dropped. Real exports carry one: a sheet's first column often has no
   * title, and losing it silently cost a 15,000-row import its entire Shift
   * Start column — every row then failed as an invalid date, with nothing on
   * screen pointing at the cause.
   *
   * Only blank titles get this. A column titled something unrecognised is a
   * genuine unknown: guessing it by position would quietly feed the wrong
   * data into a real column, which is worse than dropping it and saying so.
   */
  const assumed: string[] = [];
  if (headerDetected) {
    const claimed = new Set(mapped.filter((column) => column >= 0));
    first.forEach((value, position) => {
      if (mapped[position] !== -1) return;
      if (value.trim() !== "") return;
      if (position >= columns.length || claimed.has(position)) return;
      mapped[position] = position;
      claimed.add(position);
      assumed.push(columns[position]!);
    });
  }

  return {
    headerDetected,
    mapped,
    unknownColumns: headerDetected
      ? first
          .filter((_, index) => mapped[index] === -1)
          .map((item) => item.trim())
      : [],
    assumedColumns: assumed,
  };
}

/**
 * Satu baris file menjadi tepat 7 sel urut kolom grid. `rowNumber` hanya untuk
 * pesan error — nomor baris file apa adanya, supaya bisa dicari di editor.
 */
export function toImportCells(
  row: readonly string[],
  header: ImportHeader,
  rowNumber: number,
): string[] {
  const target = Array.from({ length: columns.length }, () => "");

  if (header.headerDetected) {
    header.mapped.forEach((column, position) => {
      if (column >= 0) target[column] = (row[position] ?? "").trim();
    });
  } else {
    if (row.length > columns.length)
      throw new Error(
        `Baris ${rowNumber} punya ${row.length} kolom. Tanpa header, file harus persis ${columns.length} kolom urut: ${columns.join(", ")}.`,
      );
    row.forEach((value, position) => {
      target[position] = value.trim();
    });
  }

  // Tanggal dari spreadsheet kadang datang sebagai serial hari, sama seperti
  // jalur clipboard.
  return target.map((value, column) => {
    if (column === 0 || column === 1) return normalizeDateInput(value);
    return column >= 4 ? normalizeDecimalInput(value) : value;
  });
}

export function parseImportFile(text: string): ImportedFile {
  const clean = text.replace(/^\uFEFF/, "");
  if (!clean.trim()) throw new Error("File impor kosong.");

  const delimiter = detectDelimiter(clean);
  const rows = parseDelimited(clean, delimiter);
  const header = mapImportHeader(rows[0] ?? []);

  const body = header.headerDetected ? rows.slice(1) : rows;
  const dataRows = body.filter((row) => row.some((cell) => cell.trim() !== ""));

  // Tidak ada batas baris di sini: yang tahu muat atau tidak adalah pemanggil,
  // dan file yang tidak muat di grid dikirim lewat jalur streaming, bukan
  // ditolak.
  if (!dataRows.length) throw new Error("File impor tidak berisi baris data.");

  if (header.headerDetected && header.mapped.every((column) => column === -1))
    throw new Error(
      `Tidak ada kolom yang dikenali. Judul kolom yang diterima: ${columns.join(", ")}.`,
    );

  return {
    cells: dataRows.map((row, index) =>
      toImportCells(row, header, index + (header.headerDetected ? 2 : 1)),
    ),
    delimiter,
    headerDetected: header.headerDetected,
    unknownColumns: header.unknownColumns,
    assumedColumns: header.assumedColumns,
  };
}

/** Sel hasil impor dikembalikan sebagai TSV supaya lewat jalur paste yang sama. */
export function toClipboardText(cells: readonly (readonly string[])[]): string {
  return cells
    .map((row) =>
      row
        .map((value) =>
          /["\t\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value,
        )
        .join("\t"),
    )
    .join("\n");
}

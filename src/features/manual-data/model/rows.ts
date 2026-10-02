import type { components } from "../../../api/generated/schema";

export type Entry = components["schemas"]["ProductionEntry"];
export type Employee = components["schemas"]["Employee"];
export type BatchInput = components["schemas"]["ProductionEntryInput"];
/**
 * Kapasitas grid: 100.000 baris.
 *
 * Univer sendiri sanggup jauh lebih banyak — `cellData`-nya sparse dan
 * rendernya per viewport — dan kode di sini sudah tidak lagi memindai seluruh
 * kapasitas tiap perubahan. Satu `POST /production-entry-batches` maksimal
 * 10.000 baris (openapi `ProductionEntryBatchRequest`), jadi Simpan memecah
 * draft per `SAVE_BATCH_ROWS` dengan kunci idempotensi turunan; batch yang
 * sudah tersimpan saat batch berikutnya gagal dilaporkan lewat
 * `PartialSaveError`, bukan hilang.
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
  /** Rejected by the server: only a changed cell or the next Simpan clears it. */
  server?: boolean;
}

/** Whole-row failure marker; the grid points it at the row's first cell. */
export const ROW_FIELD = "Baris";

/** Batch field names → the grid column they came from. */
const SERVER_FIELDS: Record<
  string,
  (typeof columns)[number] | typeof ROW_FIELD
> = {
  shiftStart: "Shift Start",
  shiftEnd: "Shift End",
  stationNo: "Station",
  pin: "Assignee",
  widthCm: "Width [cm]",
  weftDensity: "Weft [s/in]",
  resultMeter: "Result [m]",
  // DUPLICATE_IN_BATCH / ENTRY_VOIDED name the (start, end, station) key as a
  // whole; Shift Start is the first cell of that key.
  uniqueKey: "Shift Start",
  // Version and row-id failures belong to the row, not to one of its cells.
  expectedRowVersion: ROW_FIELD,
  clientRowId: ROW_FIELD,
};

/**
 * The column a server field error belongs to. `shiftStart` read as a column
 * name matches nothing, so a PERIOD_NOT_FOUND left its cell unmarked and the
 * admin hunting for it.
 */
export function serverFieldColumn(field: string): string {
  return SERVER_FIELDS[field] ?? field;
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
  // Dot only, two or more groups of three: "1.902.400" cannot be a decimal at
  // all, so it can only be the Indonesian thousands dot. The single-group
  // "1.902" is NOT rewritten here — see `isAmbiguousDecimal`.
  if (/^\d{1,3}(\.\d{3}){2,}$/.test(text)) return text.replace(/\./g, "");
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

/**
 * True for the shapes this refuses to guess, so they can be explained.
 *
 * "1,902" always. "1.902" too — the Indonesian thousands dot makes it 1902
 * just as plausibly as 1.902, and passing it as a decimal misstates the pay
 * a thousandfold — but only in Result (`column` 6), the one column where both
 * readings can be valid:
 *
 * - Weft is capped at 100 and Width at 500, so the grouped reading (≥ 1000)
 *   can never be valid there. "10.000" — exactly what the server returns for
 *   weft numeric(7,3) — is plain 10; a width "1.902" fails its 2-decimal
 *   scale on its own.
 * - The caller skips a cell still equal to the value the server returned:
 *   Result is numeric(14,3), so "850.000" comes back from every save and
 *   must not turn red on the next validate.
 */
export function isAmbiguousDecimal(value: string, column?: number) {
  const text = value.trim();
  if (/^\d{1,3},\d{3}$/.test(text)) return true;
  return column === 6 && /^\d{1,3}\.\d{3}$/.test(text);
}

/**
 * Per-column limits, from the DDL (`production_entries`): width numeric(7,2)
 * 0 < w ≤ 500, weft numeric(7,3) 0 < x ≤ 100, result numeric(14,3) ≥ 0.
 * Checked here so the row turns red before Simpan instead of coming back as a
 * server rejection — or, worse, a database CHECK aborting the whole batch.
 */
const DECIMAL_LIMITS: Record<
  number,
  { scale: number; max?: number; zero: boolean }
> = {
  4: { scale: 2, max: 500, zero: false },
  5: { scale: 3, max: 100, zero: false },
  // 14 digits, 3 after the point: at most 11 before it.
  6: { scale: 3, zero: true },
};
const RESULT_MAX_INTEGER_DIGITS = 11;

/** Trailing zeros past the scale lose nothing: "1.9020" is 1.902. */
function significantDecimals(value: string) {
  return (value.split(".")[1] ?? "").replace(/0+$/, "").length;
}

/**
 * A server decimal as the admin's spreadsheet showed it: "75.00" → "75",
 * "9.700" → "9.7", "642.000" → "642". The DDL scales (2/3/3) pad every value,
 * and the padding reads as false precision next to the legacy sheet.
 */
export function displayDecimal(value: string) {
  if (!value.includes(".")) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "");
}

/** "1.9020" → "1.902", "56.00" untouched: only zeros past the scale go. */
function trimToScale(value: string, scale: number) {
  const [whole, fraction] = value.split(".");
  if (fraction === undefined || fraction.length <= scale) return value;
  const kept = fraction.slice(0, Math.max(scale, significantDecimals(value)));
  return kept ? `${whole}.${kept}` : (whole ?? value);
}

function decimalProblem(value: string, column: number): string | null {
  const limit = DECIMAL_LIMITS[column];
  if (!limit) return null;
  if (significantDecimals(value) > limit.scale)
    return `Maksimal ${limit.scale} angka di belakang titik.`;
  const integer = (value.split(".")[0] ?? "").replace(/^0+(?=\d)/, "");
  if (limit.max === undefined) {
    return integer.length > RESULT_MAX_INTEGER_DIGITS
      ? `Maksimal ${RESULT_MAX_INTEGER_DIGITS} digit sebelum titik.`
      : null;
  }
  // Comparing as a number is safe here: it decides a range, it computes
  // nothing, and every value that passes the regex above is far below 2^53.
  return Number(value) > limit.max
    ? `Maksimal ${limit.max.toLocaleString("id-ID")}.`
    : null;
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

interface ParsedDate {
  /** ISO 8601 with the Jakarta offset, as the API takes it. */
  iso: string;
  /** Epoch milliseconds of `iso`, so ordering needs no second parse. */
  time: number;
}

function parseDateUncached(value: string): ParsedDate | null {
  const text = normalizeDateInput(value);
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(:\d{2})?$/.exec(text);
  if (!match) return null;
  const result = `${match[1]}T${match[2]}${match[3] ?? ":00"}+07:00`;
  return toJakartaInput(result) ===
    `${match[1]} ${match[2]}${match[3] ?? ":00"}`
    ? { iso: result, time: Date.parse(result) }
    : null;
}

/**
 * Parsed shift timestamps, by the exact cell text.
 *
 * Profiled on a 100.000-row validate: a third of the time was the
 * `Date.parse` + `toISOString` round trip below, run twice per row although a
 * workspace holds a few thousand distinct shift boundaries at most (days in
 * the book × shifts). The result depends on the text alone, so it is cached;
 * cleared wholesale at the bound rather than evicted per entry, which keeps
 * the hot path to one `Map.get`.
 */
const DATE_CACHE_MAX = 10_000;
const dateCache = new Map<string, ParsedDate | null>();
function parseDate(value: string): ParsedDate | null {
  const cached = dateCache.get(value);
  if (cached !== undefined) return cached;
  const parsed = parseDateUncached(value);
  if (dateCache.size >= DATE_CACHE_MAX) dateCache.clear();
  dateCache.set(value, parsed);
  return parsed;
}

/**
 * A plain decimal: digits, optionally a dot and more digits. The same check
 * the zod schema `z.string().regex(...)` made, without building a parse
 * result object for each of the three decimal cells of every row.
 */
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;
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

/** What the validator itself says about an assignee; any other message on
 *  that column came from the HRIS lookup. */
export const ASSIGNEE_INVALID_MESSAGE =
  "Pilih karyawan dari pencarian atau tempel PIN numerik yang valid.";

export const DUPLICATE_KEY_MESSAGE =
  "Duplikat shift start, shift end, dan station dalam workspace.";

function stationOf(text: string) {
  const stationNo = Number(text);
  const valid =
    /^\d+$/.test(text) && Number.isSafeInteger(stationNo) && stationNo > 0;
  return { stationNo, valid };
}

/**
 * The `(shiftStart, shiftEnd, station)` key `validateRows` reserves for a
 * row, or `null` when one of the three does not parse — the same rule, so a
 * caller re-checking a few edited rows for duplicates agrees with a full
 * validate about which rows collide.
 */
export function uniqueKeyOf(cells: readonly string[]): string | null {
  const start = parseDate((cells[0] ?? "").trim());
  const end = parseDate((cells[1] ?? "").trim());
  const { stationNo, valid } = stationOf((cells[2] ?? "").trim());
  return start && end && valid ? `${start.iso}|${end.iso}|${stationNo}` : null;
}

export interface ValidateOptions {
  /**
   * Which rows claim their unique key in `seenKeys`.
   *
   * - `"valid-key"` (grid): any row whose start, end, and station parse, even
   *   if another cell fails — both halves of a duplicate stay red, so fixing
   *   one typo never reveals a second problem afterwards.
   * - `"passing"` (import): only rows that will actually be sent. A rejected
   *   row never reaches the server, so it must not make a later, correct row
   *   of the same shift fail as its "duplicate".
   */
  reserve?: "valid-key" | "passing";
  /**
   * Grid rows above `drafts[0]`: errors are numbered from `rowOffset + 1`.
   * Lets a long validate run in slices (sharing `seenKeys`), or re-check a
   * single edited row, and still name the row the grid shows.
   */
  rowOffset?: number;
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
  options: ValidateOptions = {},
) {
  const errors: RowError[] = [];
  const rows: BatchInput[] = [];
  const keys = seenKeys;
  const reserve = options.reserve ?? "valid-key";
  const rowOffset = options.rowOffset ?? 0;
  drafts.forEach((draft, index) => {
    const values = draft.cells.map((value) => value.trim());
    if (values.every((value) => value === "") && !draft.original) return;
    const errorsBefore = errors.length;
    const fail = (col: number, message: string) =>
      errors.push({
        row: rowOffset + index + 1,
        field: columns[col] ?? ROW_FIELD,
        value: values[col] ?? "",
        message,
      });
    const startDate = parseDate(values[0] ?? "");
    const endDate = parseDate(values[1] ?? "");
    const start = startDate?.iso ?? null;
    const end = endDate?.iso ?? null;
    if (!startDate) fail(0, "Gunakan tanggal valid YYYY-MM-DD HH:mm (WIB).");
    if (!endDate) fail(1, "Gunakan tanggal valid YYYY-MM-DD HH:mm (WIB).");
    if (startDate && endDate && endDate.time <= startDate.time)
      fail(1, "Shift end harus setelah shift start.");
    const { stationNo, valid: stationValid } = stationOf(values[2] ?? "");
    if (!stationValid) fail(2, "Nomor mesin harus bilangan bulat positif.");
    const assignee = values[3] ?? "";
    // Labels originate from API choices. Raw numeric PINs are resolved by the server.
    const pin =
      labels.get(assignee) ?? (/^\d+$/.test(assignee) ? assignee : "");
    if (!pin) fail(3, ASSIGNEE_INVALID_MESSAGE);
    const originalDecimals = draft.original
      ? [
          draft.original.widthCm,
          draft.original.weftDensity,
          draft.original.resultMeter,
        ]
      : [];
    for (const col of [4, 5, 6]) {
      const value = values[col] ?? "";
      // A cell still holding what the server returned is never second-guessed,
      // whether it shows the padded server text or the trimmed display form.
      const original = originalDecimals[col - 4];
      const fromServer =
        original !== undefined &&
        (original === value || displayDecimal(original) === value);
      if (!fromServer && isAmbiguousDecimal(value, col)) {
        const grouped = value.replace(/[.,]/, "");
        fail(
          col,
          value.includes(",")
            ? `"${value}" bisa berarti ${grouped} atau ${value.replace(",", ".")}. Tulis ulang memakai titik.`
            : // A decimal 1.902 written with a trailing zero is no longer
              // the thousands shape, and loses nothing.
              `"${value}" bisa berarti ${grouped} (titik ribuan) atau desimal ${value}. Tulis ${grouped} untuk ribuan, atau ${value}0 untuk desimal.`,
        );
        continue;
      }
      if (
        !DECIMAL_PATTERN.test(value) ||
        (col !== 6 && /^0+(\.0+)?$/.test(value))
      ) {
        fail(
          col,
          value === ""
            ? // Never defaulted to 0: an empty Result may mean the loom made
              // nothing, or that nobody filled it in. Writing 0 invents
              // production and costs the operator the pay for that roll.
              "Kosong. Tulis 0 kalau memang tidak menghasilkan, atau isi angkanya."
            : col === 6
              ? "Isi angka desimal ≥ 0, gunakan titik."
              : "Isi angka desimal > 0, gunakan titik.",
        );
        continue;
      }
      const problem = decimalProblem(value, col);
      if (problem) fail(col, problem);
    }
    if (draft.original?.status === "VOID")
      fail(0, "Data VOID tidak dapat diubah.");
    // Only a fully parsed key can be a duplicate: reserving "null|null|NaN"
    // made every later row with an unreadable date fail as a duplicate too.
    const unique =
      start && end && stationValid ? `${start}|${end}|${stationNo}` : null;
    if (unique && keys.has(unique)) fail(2, DUPLICATE_KEY_MESSAGE);
    if (unique && (reserve === "valid-key" || errors.length === errorsBefore))
      keys.add(unique);
    if (start && end)
      rows.push({
        clientRowId: draft.key,
        shiftStart: start,
        shiftEnd: end,
        stationNo,
        pin,
        widthCm: trimToScale(values[4] ?? "", 2),
        weftDensity: trimToScale(values[5] ?? "", 3),
        resultMeter: trimToScale(values[6] ?? "", 3),
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
    displayDecimal(entry.widthCm),
    displayDecimal(entry.weftDensity),
    displayDecimal(entry.resultMeter),
  ];
}

export function isChanged(row: BatchInput, original?: Baseline) {
  if (!original) return true;
  return (
    Date.parse(row.shiftStart) !== Date.parse(original.shiftStart) ||
    Date.parse(row.shiftEnd) !== Date.parse(original.shiftEnd) ||
    row.stationNo !== original.stationNo ||
    row.pin !== original.pin ||
    // By value: the grid shows "75" for the server's "75.00".
    displayDecimal(row.widthCm) !== displayDecimal(original.widthCm) ||
    displayDecimal(row.weftDensity) !== displayDecimal(original.weftDensity) ||
    displayDecimal(row.resultMeter) !== displayDecimal(original.resultMeter)
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
  /** True ketika baris judul dikenali dan dibuang. */
  headerDetected: boolean;
  /** Judul kolom file yang tidak dikenali — dilaporkan, tidak fatal. */
  unknownColumns: string[];
  /** Kolom grid yang diisi dari posisi karena judulnya kosong di file. */
  assumedColumns: string[];
  /** Nomor baris file (1-based) untuk tiap baris `cells`. */
  fileRows: number[];
  /** Baris tak kosong di atas baris judul (judul laporan, catatan) yang dilewati. */
  skippedBeforeHeader: number;
  /** Masalah per baris yang tidak bisa diwakili sel grid, indeks ke `cells`. */
  problems: { index: number; message: string }[];
}

/**
 * Baris judul dicari di sekian baris tak kosong pertama, bukan hanya baris
 * pertama: ekspor nyata sering diawali judul laporan atau rentang tanggal, dan
 * membaca baris itu sebagai "tanpa header" membuat setiap kolom salah tempat.
 */
export const IMPORT_HEADER_SCAN_ROWS = 20;

/**
 * Baris judul di antara `rows` (sudah dibuang yang kosong), atau `-1`.
 * Dipakai jalur grid dan jalur streaming supaya keduanya memilih baris yang
 * sama untuk file yang sama.
 */
export function findImportHeader(rows: readonly (readonly string[])[]): number {
  return rows
    .slice(0, IMPORT_HEADER_SCAN_ROWS)
    .findIndex((row) => mapImportHeader(row).headerDetected);
}

export function isBlankRow(row: readonly string[]) {
  return row.every((cell) => cell.trim() === "");
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

  // Baris tanpa pemisah sama sekali (judul laporan di atas tabel) tidak
  // menentukan apa-apa; pindai sampai baris pertama yang punya pemisah.
  let lines = 0;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (char === "\n" && !quoted) {
      lines += 1;
      if (
        lines >= IMPORT_HEADER_SCAN_ROWS ||
        IMPORT_DELIMITERS.some((item) => (counts.get(item) ?? 0) > 0)
      )
        break;
    } else if (!quoted && counts.has(char))
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
 * Masalah satu baris file yang tidak tampak di 7 sel grid, atau `null`.
 *
 * Tanpa header, kolom ke-8 dan seterusnya tidak punya tempat. Kolom kosong di
 * ujung (sel sisa format spreadsheet) diabaikan; kolom berisi ditolak PER
 * BARIS — dulu satu baris lebar menggagalkan impor di tengah jalan, setelah
 * batch sebelumnya sudah tersimpan.
 */
export function importRowProblem(
  row: readonly string[],
  header: ImportHeader,
): string | null {
  if (header.headerDetected) return null;
  const extra = row.slice(columns.length).filter((cell) => cell.trim() !== "");
  return extra.length
    ? `Baris punya isi di luar ${columns.length} kolom (${extra.length} sel lebih). Tanpa baris judul, file harus urut: ${columns.join(", ")}.`
    : null;
}

/** Satu baris file menjadi tepat 7 sel urut kolom grid. */
export function toImportCells(
  row: readonly string[],
  header: ImportHeader,
): string[] {
  const target = Array.from({ length: columns.length }, () => "");

  if (header.headerDetected) {
    header.mapped.forEach((column, position) => {
      if (column >= 0) target[column] = (row[position] ?? "").trim();
    });
  } else {
    row.slice(0, columns.length).forEach((value, position) => {
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
  // Nomor baris file ikut dibawa: baris kosong dibuang setelah ini, dan pesan
  // "baris N" harus menunjuk baris yang sama di spreadsheet asalnya.
  const rows = parseDelimited(clean, delimiter)
    .map((row, index) => ({ row, fileRow: index + 1 }))
    .filter((item) => !isBlankRow(item.row));
  const headerAt = findImportHeader(rows.map((item) => item.row));
  const header = mapImportHeader(
    headerAt >= 0 ? rows[headerAt]!.row : (rows[0]?.row ?? []),
  );

  const dataRows = headerAt >= 0 ? rows.slice(headerAt + 1) : rows;

  // Tidak ada batas baris di sini: yang tahu muat atau tidak adalah pemanggil,
  // dan file yang tidak muat di grid dikirim lewat jalur streaming, bukan
  // ditolak.
  if (!dataRows.length) throw new Error("File impor tidak berisi baris data.");

  if (header.headerDetected && header.mapped.every((column) => column === -1))
    throw new Error(
      `Tidak ada kolom yang dikenali. Judul kolom yang diterima: ${columns.join(", ")}.`,
    );

  const problems: ImportedFile["problems"] = [];
  dataRows.forEach((item, index) => {
    const message = importRowProblem(item.row, header);
    if (message) problems.push({ index, message });
  });

  return {
    cells: dataRows.map((item) => toImportCells(item.row, header)),
    delimiter,
    headerDetected: header.headerDetected,
    unknownColumns: header.unknownColumns,
    assumedColumns: header.assumedColumns,
    fileRows: dataRows.map((item) => item.fileRow),
    skippedBeforeHeader: Math.max(0, headerAt),
    problems,
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

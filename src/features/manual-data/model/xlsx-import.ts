import { unzipSync, type UnzipFileInfo } from "fflate";

/**
 * Membaca satu sheet .xlsx menjadi teks tab-separated untuk jalur impor yang
 * SUDAH ADA (`parseImportFile`, atau streaming langsung ke server).
 *
 * Sengaja bukan jalur kedua: deteksi judul kolom, koma desimal, serial
 * tanggal, dan resolusi assignee tetap satu tempat. Yang dikerjakan di sini
 * hanya membongkar zip dan XML-nya.
 *
 * Dua keputusan yang tidak kelihatan dari kodenya:
 *
 * - **Angka dibaca sebagai teks apa adanya dari XML**, tidak lewat `Number`
 *   untuk dihitung. Meter dan lebar adalah decimal string end-to-end
 *   (spec §7). Satu-satunya perapian: Excel kadang menulis angka dengan 17
 *   digit (`12.199999999999999` untuk 12.2 yang diketik), jadi angka dipotong
 *   ke 15 digit signifikan — presisi yang ditampilkan Excel sendiri, sehingga
 *   yang diimpor adalah angka yang dilihat orangnya.
 * - **Sel tanggal datang sebagai serial hari** (46269.2916…). Itu dibiarkan:
 *   `normalizeDateInput` sudah mengubah serial menjadi tanggal WIB, persis
 *   seperti serial yang ikut tertempel dari clipboard spreadsheet.
 */

/** Sheet dengan nama ini dipilih lebih dulu; sheet petunjuk tidak pernah terbaca sebagai data. */
export const XLSX_DATA_SHEET = "Data";

/**
 * Batas ukuran XML satu sheet setelah dibongkar. Sheet penuh Excel
 * (1.048.576 baris × 7 kolom) sekitar 250 MB; di atasnya hampir pasti
 * zip bomb, dan tab browser orang itu yang akan mati.
 */
const MAX_ENTRY_BYTES = 512 * 1024 * 1024;

export interface XlsxSheetText {
  sheetName: string;
  text: string;
}

export function xlsxToText(data: Uint8Array): XlsxSheetText {
  const workbook = unzipEntries(
    data,
    (name) =>
      name === "xl/workbook.xml" || name === "xl/_rels/workbook.xml.rels",
  );
  const workbookXml = workbook.get("xl/workbook.xml");
  if (!workbookXml)
    throw new Error(
      "File .xlsx tidak berisi workbook. Simpan ulang dari Excel sebagai .xlsx.",
    );

  const sheet = pickSheet(
    workbookXml,
    workbook.get("xl/_rels/workbook.xml.rels") ?? "",
  );
  const date1904 = usesDate1904(workbookXml);
  const entries = unzipEntries(
    data,
    (name) =>
      name === sheet.path ||
      name === "xl/sharedStrings.xml" ||
      (date1904 && name === "xl/styles.xml"),
  );
  const sheetXml = entries.get(sheet.path);
  if (sheetXml === undefined)
    throw new Error(`Sheet "${sheet.name}" tidak ditemukan di dalam file.`);

  const shared = parseSharedStrings(entries.get("xl/sharedStrings.xml") ?? "");
  const context: SheetContext = {
    shared,
    dateStyles: date1904
      ? dateStyleIndexes(entries.get("xl/styles.xml") ?? "")
      : null,
  };
  return { sheetName: sheet.name, text: sheetToText(sheetXml, context) };
}

interface SheetContext {
  shared: readonly string[];
  /**
   * Indeks `cellXfs` bertipe tanggal — hanya untuk workbook `date1904`;
   * `null` berarti serial dibiarkan apa adanya (sistem 1900).
   */
  dateStyles: ReadonlySet<number> | null;
}

/**
 * Workbook dari Excel Mac lama memakai sistem tanggal 1904: serial 0 adalah
 * 1 Jan 1904, bukan 30 Des 1899. `normalizeDateInput` hanya mengenal sistem
 * 1900, jadi tanpa koreksi setiap shift dari file semacam itu mundur 4 tahun
 * 1 hari — dan tetap "valid".
 */
function usesDate1904(workbookXml: string) {
  const tag = new RegExp(`<${NS}workbookPr\\b[^>]*>`).exec(workbookXml)?.[0];
  const value = tag ? attr(tag, "date1904") : undefined;
  return value === "1" || value?.toLowerCase() === "true";
}

/** Selisih sistem 1904 terhadap 1900, dalam hari. */
const DATE1904_OFFSET_DAYS = 1462;

/** Format bawaan Excel yang berupa tanggal/jam (ECMA-376 §18.8.30). */
const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

/**
 * Hanya sel bergaya tanggal yang digeser: Width, Weft, dan Result juga angka,
 * dan menambah 1462 pada meter hasil adalah kesalahan yang jauh lebih buruk.
 */
function dateStyleIndexes(stylesXml: string): Set<number> {
  const custom = new Map<number, string>();
  for (const [tag] of stylesXml.matchAll(
    new RegExp(`<${NS}numFmt\\b[^>]*>`, "g"),
  ))
    custom.set(Number(attr(tag, "numFmtId")), attr(tag, "formatCode") ?? "");

  const cellXfs =
    new RegExp(`<${NS}cellXfs\\b[^>]*>([\\s\\S]*?)</${NS}cellXfs>`).exec(
      stylesXml,
    )?.[1] ?? "";
  const dates = new Set<number>();
  [...cellXfs.matchAll(new RegExp(`<${NS}xf\\b[^>]*>`, "g"))].forEach(
    ([tag], index) => {
      const id = Number(attr(tag, "numFmtId") ?? "0");
      const code = custom.get(id);
      if (
        code === undefined ? BUILTIN_DATE_FORMATS.has(id) : isDateFormat(code)
      )
        dates.add(index);
    },
  );
  return dates;
}

/** Kode format berisi bagian tanggal/jam di luar teks berkutip dan `[...]`. */
function isDateFormat(code: string) {
  const bare = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, "");
  return /[ydmhs]/i.test(bare);
}

/** Serial 1904 → serial 1900, dengan pecahan (jam) dibiarkan sebagai teks. */
function shiftDate1904(value: string) {
  const match = /^(\d+)(\.\d+)?$/.exec(value);
  return match
    ? `${Number(match[1]) + DATE1904_OFFSET_DAYS}${match[2] ?? ""}`
    : value;
}

class EntryTooLarge extends Error {}

function unzipEntries(
  data: Uint8Array,
  wanted: (name: string) => boolean,
): Map<string, string> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (info: UnzipFileInfo) => {
        if (!wanted(info.name)) return false;
        if (info.originalSize > MAX_ENTRY_BYTES)
          throw new EntryTooLarge(
            `Isi ${info.name} lebih dari ${MAX_ENTRY_BYTES / 1024 / 1024} MB setelah dibongkar. Pecah filenya atau impor sebagai CSV.`,
          );
        return true;
      },
    });
  } catch (error) {
    if (error instanceof EntryTooLarge) throw error;
    // .xls lama (BIFF) dan .xlsx berpassword sama-sama bukan zip.
    throw new Error(
      "Bukan file .xlsx yang bisa dibaca. File .xls lama atau yang dikunci password: buka di Excel, lalu simpan ulang sebagai .xlsx tanpa password.",
      { cause: error },
    );
  }
  const decoder = new TextDecoder();
  return new Map(
    Object.entries(files).map(([name, bytes]) => [name, decoder.decode(bytes)]),
  );
}

/** Semua tag boleh berprefix namespace (`<x:row>` dari OpenXML SDK). */
const NS = "(?:[\\w-]+:)?";

function attr(tag: string, name: string) {
  const match = new RegExp(`\\s${NS}${name}="([^"]*)"`).exec(tag);
  return match ? decodeXml(match[1]!) : undefined;
}

function pickSheet(workbookXml: string, relsXml: string) {
  const sheets = [
    ...workbookXml.matchAll(new RegExp(`<${NS}sheet\\b[^>]*>`, "g")),
  ].map(([tag]) => ({
    name: attr(tag, "name") ?? "",
    relId: attr(tag, "id") ?? "",
  }));
  const targets = new Map(
    [...relsXml.matchAll(new RegExp(`<${NS}Relationship\\b[^>]*>`, "g"))].map(
      ([tag]) => [attr(tag, "Id") ?? "", attr(tag, "Target") ?? ""],
    ),
  );
  const chosen =
    sheets.find(
      (sheet) =>
        sheet.name.trim().toLowerCase() === XLSX_DATA_SHEET.toLowerCase(),
    ) ?? sheets[0];
  const target = chosen ? targets.get(chosen.relId) : undefined;
  if (!chosen || !target)
    throw new Error("File .xlsx tidak berisi sheet yang bisa dibaca.");

  // Target relatif terhadap xl/, atau absolut dari akar paket.
  const path = target.startsWith("/")
    ? target.slice(1)
    : `xl/${target.replace(/^\.\//, "")}`;
  return { name: chosen.name, path };
}

function parseSharedStrings(xml: string): string[] {
  return [
    ...xml.matchAll(new RegExp(`<${NS}si\\b[^>]*>([\\s\\S]*?)</${NS}si>`, "g")),
  ].map(([, body]) => textRuns(body!));
}

/** Gabungan semua `<t>`, tanpa teks furigana (`<rPh>`) yang bukan isi sel. */
function textRuns(body: string) {
  const visible = body.replace(
    new RegExp(`<${NS}rPh\\b[\\s\\S]*?</${NS}rPh>`, "g"),
    "",
  );
  let text = "";
  for (const [, run] of visible.matchAll(
    new RegExp(`<${NS}t\\b[^>]*?(?:/>|>([\\s\\S]*?)</${NS}t>)`, "g"),
  ))
    text += decodeXml(run ?? "");
  return text;
}

const ROW = new RegExp(
  `<${NS}row\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${NS}row>)`,
  "g",
);
const CELL = new RegExp(`<${NS}c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${NS}c>)`, "g");
const VALUE = new RegExp(`<${NS}v\\b[^>]*>([\\s\\S]*?)</${NS}v>`);
const INLINE = new RegExp(`<${NS}is\\b[^>]*>([\\s\\S]*?)</${NS}is>`);

function sheetToText(xml: string, context: SheetContext) {
  const rows: string[][] = [];
  let width = 0;

  for (const [, rowAttrs, body] of xml.matchAll(ROW)) {
    // Excel tidak menulis baris kosong. Tanpa `r`, baris 10 setelah lima baris
    // kosong terbaca sebagai baris 5, dan "baris N ditolak" menunjuk baris
    // yang salah di file orang itu.
    const number = Number(attr(`<row${rowAttrs}>`, "r"));
    if (Number.isSafeInteger(number))
      while (rows.length < number - 1) rows.push([]);

    const cells: string[] = [];
    let next = 0;
    for (const [, attrs, inner] of body ? body.matchAll(CELL) : []) {
      const ref = attr(`<c${attrs}>`, "r");
      const column = ref ? columnIndex(ref) : next;
      cells[column] = cellValue(attrs!, inner ?? "", context);
      next = column + 1;
    }
    // Excel tidak menulis sel kosong, jadi lubang diisi string kosong.
    const row = Array.from(cells, (value) => value ?? "");
    while (row.length && row.at(-1) === "") row.pop();
    width = Math.max(width, row.length);
    rows.push(row);
  }

  return rows
    .map((row) => {
      const padded = row.concat(Array(width - row.length).fill(""));
      return padded.map(quoteTsv).join("\t");
    })
    .join("\n");
}

function cellValue(attrs: string, inner: string, context: SheetContext) {
  const { shared } = context;
  const type = attr(`<c${attrs}>`, "t") ?? "n";
  if (type === "inlineStr") {
    const inline = INLINE.exec(inner);
    return inline ? textRuns(inline[1]!) : "";
  }
  const raw = VALUE.exec(inner)?.[1];
  // Rumus tanpa hasil tersimpan: tidak ada nilai yang bisa dipercaya.
  if (raw === undefined) return "";
  const value = decodeXml(raw);
  switch (type) {
    case "s":
      return shared[Number(value)] ?? "";
    case "b":
      return value === "1" ? "TRUE" : "FALSE";
    case "str":
    case "e":
      // Error seperti #N/A dibiarkan tampil supaya validasi menandainya,
      // bukan diam-diam jadi sel kosong.
      return value;
    case "d":
      // Tanggal ISO (jarang, dari generator non-Excel): 2026-09-04T07:00:00Z.
      return value.replace("T", " ").replace(/(\.\d+)?Z?$/, "");
    default: {
      const style = Number(attr(`<c${attrs}>`, "s") ?? "0");
      return context.dateStyles?.has(style)
        ? shiftDate1904(value)
        : excelNumber(value);
    }
  }
}

function excelNumber(value: string) {
  if (!/^-?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(value)) return value;
  const digits = value.replace(/^-|\.|E.*$/gi, "").replace(/^0+/, "");
  if (digits.length <= 15 && !/e/i.test(value)) return value;
  // Hanya untuk representasi 16–17 digit milik Excel; hasilnya string
  // desimal biasa, bukan notasi ilmiah.
  // `String` memberi representasi desimal terpendek (12.2, bukan
  // 12.1999…); notasi ilmiah hanya untuk nilai ekstrem yang bukan data
  // produksi, dan itu dikembalikan mentah supaya validasi menandainya.
  const rounded = String(Number(Number(value).toPrecision(15)));
  return /e/i.test(rounded) ? value : rounded;
}

function columnIndex(ref: string) {
  let index = 0;
  for (const char of ref) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

function quoteTsv(value: string) {
  return /["\t\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function decodeXml(text: string) {
  return (
    text
      .replace(
        /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
        (whole, entity: string) => {
          const lower = entity.toLowerCase();
          if (lower === "amp") return "&";
          if (lower === "lt") return "<";
          if (lower === "gt") return ">";
          if (lower === "quot") return '"';
          if (lower === "apos") return "'";
          const code =
            lower[1] === "x"
              ? Number.parseInt(lower.slice(2), 16)
              : Number.parseInt(lower.slice(1), 10);
          return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
        },
      )
      // Escape OOXML untuk karakter kontrol, mis. _x000D_ untuk CR.
      .replace(/_x([0-9A-F]{4})_/gi, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      )
  );
}

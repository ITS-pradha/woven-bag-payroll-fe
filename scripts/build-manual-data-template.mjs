/**
 * Membangun public/templates/manual-data-template.xlsx.
 *
 *   npm run templates:build
 *
 * File .xlsx dibangun dari kode, bukan disunting di Excel, supaya isinya bisa
 * direview sebagai teks dan dibangun ulang sama persis. Tidak ada library
 * penulis xlsx: cukup `fflate` (sudah dipakai pembaca impor) dan XML
 * SpreadsheetML minimum.
 *
 * Dua sheet: "Data" (dibaca impor — nama itu yang dicari
 * `xlsx-import.ts`) dan "Cara Pakai" (petunjuk; tidak pernah terbaca sebagai
 * data).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";

const OUT = fileURLToPath(
  new URL("../public/templates/manual-data-template.xlsx", import.meta.url),
);

const HEADERS = [
  "Shift Start",
  "Shift End",
  "Station",
  "Assignee",
  "Width [cm]",
  "Weft [s/in]",
  "Result [m]",
];

/** Contoh yang sama dengan template CSV lama: PIN, Result 0, dan EID. */
const EXAMPLES = [
  ["2026-09-04 07:00", "2026-09-04 15:00", 51, "8954", "56", "10", "982"],
  ["2026-09-04 15:00", "2026-09-04 23:00", 51, "2264", "56", "10", "0"],
  [
    "2026-09-04 07:00",
    "2026-09-04 15:00",
    52,
    "PT2-9546-0794",
    "60",
    "11",
    "1045.5",
  ],
];

const GUIDE = `Template impor Manual Data — Woven Payroll Tools

Isi sheet "Data", simpan sebagai .xlsx, lalu impor file ini lewat tombol "Impor file" di layar Manual Data. Tidak perlu disimpan ulang sebagai CSV. Baris contoh boleh dihapus atau ditimpa.

Yang dibaca impor hanya sheet bernama "Data". Kalau sheet itu tidak ada, sheet pertama yang dibaca. Sheet ini (Cara Pakai) tidak pernah ikut diimpor.

KOLOM
Shift Start — Wajib. Tanggal dan jam Asia/Jakarta (WIB). Ketik seperti 2026-09-04 07:00; kolom ini sudah berformat tanggal-jam.
Shift End — Wajib. Harus SETELAH Shift Start. Boleh lewat tengah malam.
Station — Wajib. Nomor mesin, bilangan bulat positif.
Assignee — Wajib. PIN karyawan (angka) ATAU EID dari HRIS, misalnya PT2-9546-0794. Kolom ini berformat Teks supaya PIN berawalan nol tidak hilang. Keduanya diterjemahkan jadi nama + PIN saat impor. Nama tidak dipakai sebagai identitas.
Width [cm] — Wajib. Desimal lebih dari 0, misalnya 56 atau 56.5.
Weft [s/in] — Wajib. Desimal lebih dari 0, misalnya 10 atau 10.5.
Result [m] — Wajib. Desimal 0 atau lebih. Nol adalah nilai sah, jangan dikosongkan.

ATURAN
- Satu shift + satu mesin hanya boleh muncul sekali. Kombinasi (Shift Start, Shift End, Station) adalah kunci uniknya; baris yang sudah ada di server akan diperbarui, bukan diduplikasi.
- Setiap baris harus jatuh di buku periode yang sudah dibuat dan masih terbuka, dilihat dari tanggal Shift Start (WIB). Baris di buku yang sudah tutup, atau di tanggal yang belum punya buku, ditolak saat disimpan.
- Result [m] yang dikosongkan TIDAK dianggap 0. Kosong berarti datanya belum diisi; kalau mesin memang tidak menghasilkan, tulis 0.
- Baris judul boleh ada atau tidak. Kalau ada, urutan kolomnya bebas: nama kolom yang menentukan. Kalau tidak ada, urutan harus persis seperti daftar di atas.
- Kolom tambahan yang punya judul tapi tidak dikenali akan diabaikan dan dilaporkan, tidak membatalkan impor.
- Sel berisi rumus diimpor sebagai hasil terakhirnya. Sel error seperti #N/A ditandai sebagai masalah, tidak dikosongkan diam-diam.
- Angka dibaca seperti yang ditampilkan Excel (15 digit signifikan).
- Impor juga menerima CSV, TSV, dan TXT. Di sana koma desimal seperti 12,2 dirapikan jadi 12.2, kecuali koma diikuti tepat tiga digit (1,902) yang harus ditulis ulang memakai titik karena bisa berarti 1902 atau 1.902.
- Tidak ada batas jumlah baris. Sampai 100.000 baris dibuka di grid untuk diperiksa dulu; di atas itu dikirim langsung ke server per 5.000 baris, dan kemajuannya terlihat selama proses berjalan.
- File .xls lama dan file berpassword tidak bisa dibaca: buka di Excel, lalu simpan sebagai .xlsx tanpa password.

SETELAH IMPOR
Sampai 100.000 baris: baris masuk sebagai DRAFT di grid dan langsung ditampilkan. Sel yang bermasalah ditandai merah, dan daftar masalahnya muncul di samping grid. Tidak ada yang terkirim ke server sebelum tombol "Simpan" ditekan.
Lebih dari 100.000 baris: baris dikirim langsung ke server setelah tombol "Kirim ke server" ditekan, per 5.000 baris. Baris yang tidak valid dilewati dan dilaporkan; sisanya tetap masuk, dan laporan baris ditolak bisa diunduh sebagai CSV.

Impor dapat dihentikan di tengah jalan. Batch yang sudah terkirim tetap tersimpan — ulangi impor dengan file yang sama untuk melanjutkan; baris yang sudah ada tidak terduplikasi.

JANGAN tutup tab selama impor berjalan. Tidak ada resume otomatis: menutup tab menghentikan impor di batch terakhir yang selesai.`;

const EPOCH = Date.UTC(1899, 11, 30);
/** "2026-09-04 07:00" (WIB, dinding pabrik) -> serial hari Excel. */
function serial(wallClock) {
  const [date, time] = wallClock.split(" ");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  // Serial Excel tidak punya zona: nilainya jam dinding, dan impor membacanya
  // kembali sebagai WIB.
  return (Date.UTC(y, m - 1, d, hh, mm) - EPOCH) / 86_400_000;
}

const escape = (text) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const col = (index) => String.fromCharCode(65 + index);
const str = (ref, text, style) =>
  `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escape(text)}</t></is></c>`;
const num = (ref, value, style) =>
  `<c r="${ref}" s="${style}"><v>${value}</v></c>`;

// Indeks cellXfs di styles.xml di bawah.
const S = { header: 1, datetime: 2, text: 3, number: 4, guide: 5, title: 6 };

const dataRows = [
  `<row r="1">${HEADERS.map((h, i) => str(`${col(i)}1`, h, S.header)).join("")}</row>`,
  ...EXAMPLES.map((row, r) => {
    const n = r + 2;
    return `<row r="${n}">${[
      num(`A${n}`, serial(row[0]), S.datetime),
      num(`B${n}`, serial(row[1]), S.datetime),
      num(`C${n}`, row[2], S.number),
      str(`D${n}`, row[3], S.text),
      num(`E${n}`, row[4], S.number),
      num(`F${n}`, row[5], S.number),
      num(`G${n}`, row[6], S.number),
    ].join("")}</row>`;
  }),
];

// Gaya per KOLOM, bukan cuma per sel contoh: baris yang diketik orang di
// bawah contoh ikut berformat tanggal-jam (A:B) dan teks (D).
const dataSheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>
<col min="1" max="2" width="19" style="${S.datetime}" customWidth="1"/>
<col min="3" max="3" width="10" style="${S.number}" customWidth="1"/>
<col min="4" max="4" width="20" style="${S.text}" customWidth="1"/>
<col min="5" max="7" width="12" style="${S.number}" customWidth="1"/>
</cols>
<sheetData>${dataRows.join("")}</sheetData>
</worksheet>`;

const guideLines = GUIDE.split("\n");
const guideSheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetFormatPr defaultRowHeight="15"/>
<cols><col min="1" max="1" width="110" customWidth="1"/></cols>
<sheetData>${guideLines
  .map((line, i) =>
    line
      ? `<row r="${i + 1}">${str(`A${i + 1}`, line, i === 0 || /^[A-Z ]+$/.test(line) ? S.title : S.guide)}</row>`
      : `<row r="${i + 1}"/>`,
  )
  .join("")}</sheetData>
</worksheet>`;

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F0EC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const files = {
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Cara Pakai" sheetId="2" r:id="rId2"/></sheets>
</workbook>`,
  "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  "xl/styles.xml": styles,
  "xl/worksheets/sheet1.xml": dataSheet,
  "xl/worksheets/sheet2.xml": guideSheet,
};

// mtime tetap supaya membangun ulang tanpa perubahan isi menghasilkan byte
// yang sama.
const MTIME = new Date("2026-09-28T00:00:00Z");
writeFileSync(
  OUT,
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, xml]) => [
        name,
        [strToU8(xml), { mtime: MTIME }],
      ]),
    ),
    { level: 9 },
  ),
);
console.log(`ditulis: ${OUT}`);

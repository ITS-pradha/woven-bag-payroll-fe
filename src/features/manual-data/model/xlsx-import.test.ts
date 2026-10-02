import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { normalizeDateInput, parseImportFile } from "./rows";
import { isXlsxFile } from "./xlsx-file";
import { xlsxToText } from "./xlsx-import";

// Vitest berjalan dari akar frontend; di jsdom `import.meta.url` bukan file:.
const TEMPLATE = resolve("public/templates/manual-data-template.xlsx");

/** Isi template CSV lama, sebagai pembanding hasil template .xlsx. */
const LEGACY_CSV = `Shift Start,Shift End,Station,Assignee,Width [cm],Weft [s/in],Result [m]
2026-09-04 07:00,2026-09-04 15:00,51,8954,56,10,982
2026-09-04 15:00,2026-09-04 23:00,51,2264,56,10,0
2026-09-04 07:00,2026-09-04 15:00,52,PT2-9546-0794,60,11,1045.5`;

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/** Workbook minimal dengan sheet dan sharedStrings yang ditentukan test. */
function workbook(options: {
  sheets: { name: string; xml: string }[];
  sharedStrings?: string;
  absoluteTargets?: boolean;
  workbookPr?: string;
  styles?: string;
}) {
  const files: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8(
      `<workbook xmlns="${MAIN}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${options.workbookPr ?? ""}<sheets>${options.sheets
        .map(
          (s, i) =>
            `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
        )
        .join("")}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships>${options.sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Target="${options.absoluteTargets ? "/xl/" : ""}worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("")}</Relationships>`,
    ),
  };
  options.sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(
      `<worksheet xmlns="${MAIN}"><sheetData>${sheet.xml}</sheetData></worksheet>`,
    );
  });
  if (options.sharedStrings)
    files["xl/sharedStrings.xml"] = strToU8(
      `<sst xmlns="${MAIN}">${options.sharedStrings}</sst>`,
    );
  if (options.styles)
    files["xl/styles.xml"] = strToU8(
      `<styleSheet xmlns="${MAIN}">${options.styles}</styleSheet>`,
    );
  return zipSync(files);
}

describe("xlsxToText", () => {
  it("template .xlsx menghasilkan sel yang sama persis dengan template CSV lama", () => {
    const { sheetName, text } = xlsxToText(readFileSync(TEMPLATE));
    expect(sheetName).toBe("Data");
    const fromXlsx = parseImportFile(text);
    const fromCsv = parseImportFile(LEGACY_CSV);
    expect(fromXlsx.headerDetected).toBe(true);
    // Serial tanggal dinormalisasi dengan detik (07:00:00), seperti serial
    // yang tertempel dari clipboard; ketikan CSV tetap 07:00. Waktunya sama.
    const minutes = (cells: string[][]) =>
      cells.map((row) =>
        row.map((cell) =>
          cell.replace(/^(\d{4}-\d\d-\d\d \d\d:\d\d):00$/, "$1"),
        ),
      );
    expect(minutes(fromXlsx.cells)).toEqual(minutes(fromCsv.cells));
    expect(fromXlsx.cells[0]![0]).toBe("2026-09-04 07:00:00");
    expect(fromXlsx.cells).toHaveLength(3);
    // Result 0 tetap 0, PIN tetap teks, EID tidak diubah.
    expect(fromXlsx.cells[1]).toContain("0");
    expect(fromXlsx.cells[2]).toContain("PT2-9546-0794");
  });

  it("memilih sheet 'Data' walau bukan sheet pertama, dan target absolut", () => {
    const data = workbook({
      absoluteTargets: true,
      sheets: [
        {
          name: "Cara Pakai",
          xml: `<row r="1"><c r="A1" t="inlineStr"><is><t>petunjuk</t></is></c></row>`,
        },
        { name: "data", xml: `<row r="1"><c r="A1"><v>7</v></c></row>` },
      ],
    });
    expect(xlsxToText(data)).toEqual({ sheetName: "data", text: "7" });
  });

  it("tanpa sheet 'Data': sheet pertama", () => {
    const data = workbook({
      sheets: [
        { name: "Sheet1", xml: `<row r="1"><c r="A1"><v>1</v></c></row>` },
        { name: "Sheet2", xml: `<row r="1"><c r="A1"><v>2</v></c></row>` },
      ],
    });
    expect(xlsxToText(data).text).toBe("1");
  });

  it("membaca tiap jenis sel tanpa mengarang nilai", () => {
    const data = workbook({
      sharedStrings:
        `<si><t>A &amp; B</t></si>` +
        `<si><r><t>PT2-</t></r><r><rPr><b/></rPr><t>9546</t></r><rPh><t>ふりがな</t></rPh></si>` +
        `<si><t>kata "kutip"\tdan tab</t></si>`,
      sheets: [
        {
          name: "Data",
          xml:
            `<row r="1">` +
            `<c r="A1" t="s"><v>0</v></c>` +
            `<c r="B1" t="s"><v>1</v></c>` +
            `<c r="C1" t="b"><v>1</v></c>` +
            `<c r="D1" t="e"><v>#N/A</v></c>` +
            `<c r="E1"><f>SUM(X1:X2)</f></c>` +
            `<c r="F1"><v>12.199999999999999</v></c>` +
            `<c r="G1"><v>0</v></c>` +
            `</row>` +
            // Sel jarang: B dan D kosong tidak ditulis Excel sama sekali.
            `<row r="2"><c r="A2" t="str"><f>A1</f><v>hasil_x000D_rumus</v></c><c r="C2" t="s"><v>2</v></c><c r="E2"/></row>` +
            `<row r="3"/>`,
        },
      ],
    });
    const lines = xlsxToText(data).text.split("\n");
    expect(lines[0]!.split("\t")).toEqual([
      "A & B",
      "PT2-9546",
      "TRUE",
      "#N/A",
      "",
      "12.2",
      "0",
    ]);
    expect(lines[1]).toBe(
      '"hasil\rrumus"\t\t"kata ""kutip""\tdan tab"\t\t\t\t',
    );
    expect(lines[2]).toBe("\t\t\t\t\t\t");
  });

  it("tag berprefix namespace (OpenXML SDK) tetap terbaca", () => {
    const data = workbook({
      sheets: [
        {
          name: "Data",
          xml: `<x:row r="1"><x:c r="B1" t="inlineStr"><x:is><x:t>8954</x:t></x:is></x:c></x:row>`,
        },
      ],
    });
    expect(xlsxToText(data).text).toBe("\t8954");
  });

  it("angka dengan digit signifikan wajar dibiarkan persis", () => {
    const data = workbook({
      sheets: [
        {
          name: "Data",
          xml: `<row r="1"><c r="A1"><v>1045.5</v></c><c r="B1"><v>46269.291666666664</v></c><c r="C1"><v>100000000000000000000</v></c></row>`,
        },
      ],
    });
    expect(xlsxToText(data).text.split("\t")).toEqual([
      "1045.5",
      "46269.2916666667",
      "100000000000000000000",
    ]);
  });

  it("baris kosong yang tidak ditulis Excel tetap terhitung (nomor baris file)", () => {
    const data = workbook({
      sheets: [
        {
          name: "Data",
          xml: `<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>b</t></is></c></row>`,
        },
      ],
    });
    expect(xlsxToText(data).text.split("\n")).toEqual(["a", "", "", "b"]);
  });

  it("workbook date1904: serial tanggal digeser 1462 hari, angka biasa tidak", () => {
    const data = workbook({
      workbookPr: `<workbookPr date1904="1"/>`,
      styles: `<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="22"/></cellXfs>`,
      sheets: [
        {
          name: "Data",
          // 44807.2916… di sistem 1904 = 2026-09-04 07:00.
          xml: `<row r="1"><c r="A1" s="1"><v>44807.291666666664</v></c><c r="B1" s="2"><v>44807.625</v></c><c r="C1"><v>982</v></c></row>`,
        },
      ],
    });
    const [start, end, result] = xlsxToText(data).text.split("\t");
    expect(normalizeDateInput(start!)).toBe("2026-09-04 07:00:00");
    expect(normalizeDateInput(end!)).toBe("2026-09-04 15:00:00");
    expect(result).toBe("982");
  });

  it("file .xls lama atau bukan zip ditolak dengan langkah perbaikannya", () => {
    expect(() => xlsxToText(strToU8("Shift Start,Shift End"))).toThrow(
      /simpan ulang sebagai \.xlsx/,
    );
  });
});

describe("isXlsxFile", () => {
  it("mengenali dari ekstensi atau MIME", () => {
    expect(isXlsxFile({ name: "Produksi.XLSX", type: "" })).toBe(true);
    expect(
      isXlsxFile({
        name: "x",
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toBe(true);
    expect(isXlsxFile({ name: "x.csv", type: "text/csv" })).toBe(false);
  });
});

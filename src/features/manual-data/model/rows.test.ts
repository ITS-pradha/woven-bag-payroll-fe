import { describe, expect, it } from "vitest";
import {
  isAmbiguousDecimal,
  normalizeDecimalInput,
  normalizeDateInput,
  parseImportFile,
  toClipboardText,
  normalizePastedCells,
  parseClipboard,
  rowsWithValue,
  validateRows,
  toJakartaInput,
} from "./rows";

const cells = [
  "2026-09-04 07:00",
  "2026-09-04 15:00",
  "51",
  "8954",
  "56",
  "10",
  "0",
];
describe("draft Manual Data", () => {
  it("mempertahankan nol dan mengirim waktu WIB ber-offset", () => {
    const result = validateRows([{ key: "draft-1", cells }], new Map());
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      resultMeter: "0",
      pin: "8954",
      shiftStart: "2026-09-04T07:00:00+07:00",
    });
  });
  it("menolak tanggal tidak nyata dan shift terbalik", () => {
    expect(
      validateRows(
        [{ key: "a", cells: ["2026-02-30 07:00", ...cells.slice(1)] }],
        new Map(),
      ).errors.length,
    ).toBeGreaterThan(0);
    expect(
      validateRows(
        [
          {
            key: "a",
            cells: [cells[1] ?? "", cells[0] ?? "", ...cells.slice(2)],
          },
        ],
        new Map(),
      ).errors.length,
    ).toBeGreaterThan(0);
  });
  it("kunci unik memasukkan shift end", () => {
    expect(
      validateRows(
        [
          { key: "a", cells },
          {
            key: "b",
            cells: [cells[0] ?? "", "2026-09-04 19:00", ...cells.slice(2)],
          },
        ],
        new Map(),
      ).errors,
    ).toEqual([]);
    expect(
      validateRows(
        [
          { key: "a", cells },
          { key: "b", cells },
        ],
        new Map(),
      ).errors.some((e) => e.message.includes("Duplikat")),
    ).toBe(true);
  });
  it("tidak menebak nama kembar dan menolak formula", () => {
    expect(
      validateRows(
        [
          {
            key: "a",
            cells: [...cells.slice(0, 3), "Budi", ...cells.slice(4)],
          },
        ],
        new Map(),
      ).errors.some((e) => e.field === "Assignee"),
    ).toBe(true);
    expect(
      validateRows(
        [{ key: "a", cells: [...cells.slice(0, 6), "=1+1"] }],
        new Map(),
      ).errors.length,
    ).toBeGreaterThan(0);
  });
  it("clipboard rectangular tidak dipangkas dan mendukung quoted TSV", () => {
    expect(
      parseClipboard('"2026-09-04 07:00"\t51\r\n2026-09-05 07:00\t52\r\n'),
    ).toEqual([
      ["2026-09-04 07:00", "51"],
      ["2026-09-05 07:00", "52"],
    ]);
    expect(() => parseClipboard("a\tb\nc")).toThrow();
    expect(() => parseClipboard("a\tb\tc\td\te\tf\tg\th")).toThrow();
    // Batas tempel sekarang 10.000 baris, bukan kapasitas grid: di atas itu
    // Impor file yang dipakai.
    expect(
      parseClipboard(Array.from({ length: 501 }, () => "1").join("\n")),
    ).toHaveLength(501);
    expect(() =>
      parseClipboard(Array.from({ length: 10_001 }, () => "1").join("\n")),
    ).toThrow(/10.000 baris/);
  });
  it("rowsWithValue membaca isi sel sekarang, bukan nomor baris yang diingat", () => {
    const draft = (assignee: string) => ({
      key: assignee + Math.random(),
      cells: [
        "2026-09-04 07:00",
        "2026-09-04 15:00",
        "51",
        assignee,
        "56",
        "10",
        "0",
      ],
    });
    const drafts = [
      draft("PT2-9217-6896"),
      draft("Budi · 8954"),
      draft("PT2-9217-6896"),
      draft("PT1-0242-2094"),
      draft("PT2-9217-6896"),
    ];
    // 1-based grid rows, and ONLY the rows that still hold that value.
    expect(rowsWithValue(drafts, "Assignee", "PT2-9217-6896")).toEqual([
      1, 3, 5,
    ]);
    expect(rowsWithValue(drafts, "Assignee", "PT1-0242-2094")).toEqual([4]);

    // The bug this replaced: a cell corrected in the grid without revalidating
    // left the panel holding row 3, so deleting "PT2-9217-6896" took the row
    // that had since become someone else's.
    drafts[2] = draft("Siti · 7756");
    expect(rowsWithValue(drafts, "Assignee", "PT2-9217-6896")).toEqual([1, 5]);

    // Exact, never a prefix — correcting one operator must not touch another
    // whose identity starts the same way.
    expect(
      rowsWithValue([draft("PT2-9217-6896-2")], "Assignee", "PT2-9217-6896"),
    ).toEqual([]);
    // Whitespace in the cell is not a different operator.
    expect(
      rowsWithValue([draft("  PT2-9217-6896 ")], "Assignee", "PT2-9217-6896"),
    ).toEqual([1]);
    // An unknown column matches nothing rather than defaulting to column 0.
    expect(rowsWithValue(drafts, "Kolom Asing", "PT2-9217-6896")).toEqual([]);
  });

  it("mengubah serial tanggal spreadsheet menjadi tanggal dan jam WIB", () => {
    expect(normalizeDateInput("46245.958333333336")).toBe(
      "2026-08-11 23:00:00",
    );
    expect(normalizeDateInput("46246.291666666664")).toBe(
      "2026-08-12 07:00:00",
    );
    expect(
      normalizePastedCells(
        [["46245.958333333336", "46246.291666666664", "51", "8954"]],
        1,
      ),
    ).toEqual([["2026-08-11 23:00:00", "2026-08-12 07:00:00", "51", "8954"]]);
    expect(
      validateRows(
        [
          {
            key: "serial-date",
            cells: [
              "46245.958333333336",
              "46246.291666666664",
              ...cells.slice(2),
            ],
          },
        ],
        new Map(),
      ),
    ).toMatchObject({
      errors: [],
      rows: [
        {
          shiftStart: "2026-08-11T23:00:00+07:00",
          shiftEnd: "2026-08-12T07:00:00+07:00",
        },
      ],
    });
  });
  it("mengonversi timezone tanpa mengikuti timezone browser", () => {
    expect(toJakartaInput("2026-09-04T00:00:00Z")).toBe("2026-09-04 07:00:00");
  });
});

describe("impor file Manual Data", () => {
  const header =
    "Shift Start,Shift End,Station,Assignee,Width [cm],Weft [s/in],Result [m]";
  const row = "2026-09-04 07:00,2026-09-04 15:00,51,8954,56,10,982";

  it("membaca CSV berheader dan membuang baris judulnya", () => {
    const result = parseImportFile(`${header}\n${row}\n`);

    expect(result.headerDetected).toBe(true);
    expect(result.delimiter).toBe(",");
    expect(result.cells).toEqual([
      ["2026-09-04 07:00", "2026-09-04 15:00", "51", "8954", "56", "10", "982"],
    ]);
  });

  it("mengurutkan ulang kolom yang tertukar mengikuti header", () => {
    // Kolom tertukar diam-diam masuk ke kolom yang salah adalah cara tercepat
    // membayar lebar sebagai weft.
    const swapped = "Station,Shift Start,Shift End,Assignee,Weft,Width,Result";
    const values = "51,2026-09-04 07:00,2026-09-04 15:00,8954,10,56,982";

    const result = parseImportFile(`${swapped}\n${values}`);

    expect(result.cells[0]).toEqual([
      "2026-09-04 07:00",
      "2026-09-04 15:00",
      "51",
      "8954",
      "56",
      "10",
      "982",
    ]);
  });

  /**
   * Both halves come from a real 15,141-row export that failed entirely:
   * its first header cell was empty and its hours were single-digit.
   */
  it("membaca kolom tanpa judul dari posisinya, bukan membuangnya", () => {
    const blank =
      ",Shift end,Station,Assignee,Width [cm],Weft density [s/in],Result [m]";
    const values = "2026-07-01 7:00,2026-07-01 15:00,1,PT2-9546-0794,59,12.2,0";

    const result = parseImportFile(`${blank}\n${values}`);

    expect(result.headerDetected).toBe(true);
    // Dropping it silently cost every row its Shift Start, and every row then
    // failed as an invalid date with nothing pointing at the cause.
    expect(result.cells[0]?.[0]).toBe("2026-07-01 07:00");
    expect(result.cells[0]?.[1]).toBe("2026-07-01 15:00");
    expect(result.assumedColumns).toEqual(["Shift Start"]);
    expect(result.unknownColumns).toEqual([]);
  });

  /** A titled column we do not know must NOT be guessed by position. */
  it("tetap membuang kolom berjudul asing, tidak menebaknya dari posisi", () => {
    const named =
      "Catatan,Shift end,Station,Assignee,Width [cm],Weft density [s/in],Result [m]";
    const values = "apa saja,2026-07-01 15:00,1,8954,59,12.2,0";

    const result = parseImportFile(`${named}\n${values}`);

    expect(result.cells[0]?.[0]).toBe("");
    expect(result.assumedColumns).toEqual([]);
    expect(result.unknownColumns).toEqual(["Catatan"]);
  });

  it("merapikan jam satu digit yang dipakai ekspor spreadsheet", () => {
    // Google Sheets writes "7:00", never "07:00". The panel promises the
    // format is tidied up; rejecting it failed 15,141 rows at once.
    expect(normalizeDateInput("2026-07-01 7:00")).toBe("2026-07-01 07:00");
    expect(normalizeDateInput("2026-7-1 7:05:09")).toBe("2026-07-01 07:05:09");
    // Already canonical values are left exactly as they are.
    expect(normalizeDateInput("2026-07-01 15:00")).toBe("2026-07-01 15:00");
    expect(normalizeDateInput("bukan tanggal")).toBe("bukan tanggal");
  });

  it("menerima baris yang jamnya satu digit sampai lolos validasi", () => {
    const { errors, rows } = validateRows(
      [
        {
          key: "row-1",
          cells: [
            "2026-07-01 7:00",
            "2026-07-01 15:00",
            "1",
            "8954",
            "59",
            "12.2",
            "0",
          ],
        },
      ],
      new Map(),
    );

    expect(errors).toEqual([]);
    expect(rows[0]?.shiftStart).toBe("2026-07-01T07:00:00+07:00");
  });

  it("mengubah koma desimal jadi titik", () => {
    // 9.435 dari 15.141 baris sebuah ekspor sungguhan menulis weft begini.
    expect(normalizeDecimalInput("12,2")).toBe("12.2");
    expect(normalizeDecimalInput("10,25")).toBe("10.25");
    expect(normalizeDecimalInput("0,5")).toBe("0.5");
    // Sudah benar: jangan disentuh.
    expect(normalizeDecimalInput("1902.4")).toBe("1902.4");
    expect(normalizeDecimalInput("59")).toBe("59");
  });

  it("membaca pemisah ribuan dari posisi pemisah terakhir", () => {
    // Yang paling kanan adalah titik desimalnya, sisanya pengelompok digit.
    expect(normalizeDecimalInput("1,902.4")).toBe("1902.4");
    expect(normalizeDecimalInput("1.902,4")).toBe("1902.4");
    expect(normalizeDecimalInput("1,234,567")).toBe("1234567");
  });

  /**
   * The one shape that must never be guessed: picking wrong misstates a
   * payroll figure by a factor of a thousand.
   */
  it("menolak menebak koma diikuti tepat tiga digit", () => {
    expect(normalizeDecimalInput("1,902")).toBe("1,902");
    expect(isAmbiguousDecimal("1,902")).toBe(true);
    expect(isAmbiguousDecimal("12,2")).toBe(false);

    const { errors } = validateRows(
      [
        {
          key: "row-1",
          cells: [
            "2026-07-01 07:00",
            "2026-07-01 15:00",
            "1",
            "8954",
            "59",
            "12.2",
            "1,902",
          ],
        },
      ],
      new Map(),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("1902");
    expect(errors[0]?.message).toContain("1.902");
  });

  it("merapikan koma desimal saat impor file sampai lolos validasi", () => {
    const parsed = parseImportFile(
      "Shift Start,Shift End,Station,Assignee,Width [cm],Weft [s/in],Result [m]\n" +
        '2026-07-01 7:00,2026-07-01 15:00,1,8954,59,"12,2",0',
    );

    expect(parsed.cells[0]).toEqual([
      "2026-07-01 07:00",
      "2026-07-01 15:00",
      "1",
      "8954",
      "59",
      "12.2",
      "0",
    ]);

    const { errors } = validateRows(
      parsed.cells.map((cells, i) => ({ key: `r${i}`, cells })),
      new Map([["8954", "8954"]]),
    );
    expect(errors).toEqual([]);
  });

  it("memakai titik koma sebagai pemisah ketika file memakainya", () => {
    const result = parseImportFile(
      "Shift Start;Shift End;Station;Assignee;Width;Weft;Result\n" +
        "2026-09-04 07:00;2026-09-04 15:00;51;8954;56;10;982",
    );

    expect(result.delimiter).toBe(";");
    expect(result.cells[0]?.[2]).toBe("51");
  });

  it("menerima file tanpa header selama urutan kolomnya persis", () => {
    const result = parseImportFile(row);

    expect(result.headerDetected).toBe(false);
    expect(result.cells[0]?.[3]).toBe("8954");
  });

  it("menolak file tanpa header yang kolomnya kelebihan", () => {
    expect(() => parseImportFile(`${row},kolom-asing`)).toThrow(/7 kolom/);
  });

  it("melaporkan kolom asing tanpa membatalkan impor", () => {
    const result = parseImportFile(`${header},Catatan\n${row},"perlu dicek"`);

    expect(result.unknownColumns).toEqual(["Catatan"]);
    expect(result.cells[0]?.[6]).toBe("982");
  });

  it("menghormati tanda kutip dan BOM", () => {
    const result = parseImportFile(
      `\uFEFF${header}\n"2026-09-04 07:00","2026-09-04 15:00",51,8954,56,10,982`,
    );

    expect(result.cells[0]?.[0]).toBe("2026-09-04 07:00");
  });

  it("mengubah serial tanggal spreadsheet jadi jam dinding", () => {
    const result = parseImportFile(
      `${header}\n46265.2917,46265.625,51,8954,56,10,982`,
    );

    expect(result.cells[0]?.[0]).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });

  it("membuang baris kosong di akhir file", () => {
    const result = parseImportFile(`${header}\n${row}\n\n\n`);

    expect(result.cells).toHaveLength(1);
  });

  it("membaca file di atas kapasitas grid tanpa menolaknya", () => {
    // Kapasitas workspace bukan batas impor: pemanggil
    // yang memutuskan file sebesar ini dikirim lewat jalur streaming.
    const many = Array.from({ length: 501 }, () => row).join("\n");

    expect(parseImportFile(`${header}\n${many}`).cells).toHaveLength(501);
  });

  it("menolak file kosong", () => {
    expect(() => parseImportFile("   ")).toThrow(/kosong/);
  });

  it("mengembalikan TSV yang bisa dibaca ulang jalur paste", () => {
    const { cells } = parseImportFile(`${header}\n${row}`);

    expect(parseClipboard(toClipboardText(cells))).toEqual(cells);
  });
});

import { describe, expect, it } from "vitest";

import {
  applyRatePaste,
  buildRateRowsPayload,
  validateRateDraft,
  type EditableRateRow,
} from "./rate-draft";

const rows: EditableRateRow[] = [
  {
    clientRowId: "row-1",
    widthFromCm: "30",
    widthToCm: "39",
    variants: {
      "10": { threadWidth: "2.6", baseRatePerMeter: "62.16" },
      "11": { threadWidth: "2.3", baseRatePerMeter: "67.23" },
      "12": { threadWidth: "2.1", baseRatePerMeter: "71.41" },
    },
  },
  {
    clientRowId: "row-2",
    widthFromCm: "40",
    widthToCm: "49",
    variants: {
      "10": { threadWidth: "2.6", baseRatePerMeter: "62.16" },
      "11": { threadWidth: "2.3", baseRatePerMeter: "67.23" },
      "12": { threadWidth: "2.1", baseRatePerMeter: "71.41" },
    },
  },
];

describe("rate draft", () => {
  it("mengulang satu baris TSV ke seluruh range yang dipilih", () => {
    const pasted = applyRatePaste(
      rows,
      ["row-1", "row-2"],
      [["50", "59", "2.6", "64.10", "2.3", "69.42", "2.1", "73.81"]],
    );
    const first = pasted.rows.at(0);
    const second = pasted.rows.at(1);
    if (!first || !second)
      throw new Error("Dua range hasil paste wajib tersedia.");

    expect(first).toMatchObject({
      widthFromCm: "50",
      widthToCm: "59",
      variants: {
        "10": { threadWidth: "2.6", baseRatePerMeter: "64.10" },
        "11": { threadWidth: "2.3", baseRatePerMeter: "69.42" },
        "12": { threadWidth: "2.1", baseRatePerMeter: "73.81" },
      },
    });
    expect(second).toMatchObject({
      widthFromCm: first.widthFromCm,
      widthToCm: first.widthToCm,
      variants: first.variants,
    });
    expect(pasted.error).toBeNull();
  });

  it("menolak paste yang memiliki kolom lebih banyak agar data tidak terpotong diam-diam", () => {
    const pasted = applyRatePaste(
      rows,
      ["row-1"],
      [["30", "39", "2.6", "62.16", "2.3", "67.23", "2.1", "71.41", "lebih"]],
    );

    expect(pasted.rows).toEqual(rows);
    expect(pasted.error).toContain("8 kolom");
  });

  it("menandai range width bertumpuk dan nilai harga yang tidak valid", () => {
    const first = rows.at(0);
    const second = rows.at(1);
    if (!first || !second) throw new Error("Fixture range tidak lengkap.");
    const invalidRows: EditableRateRow[] = [
      first,
      {
        ...second,
        widthFromCm: "39",
        variants: {
          ...second.variants,
          "11": { ...second.variants["11"], baseRatePerMeter: "0" },
        },
      },
    ];

    const errors = validateRateDraft(invalidRows);

    expect(errors.some((error) => error.includes("bertumpuk"))).toBe(true);
    expect(errors.some((error) => error.includes("Harga 11 × 11"))).toBe(true);
  });

  it("membangun payload decimal string tanpa mengubah presisi", () => {
    const payload = buildRateRowsPayload(rows);
    const first = payload.at(0);
    if (!first) throw new Error("Payload range wajib tersedia.");

    expect(first.clientRowId).toBe("row-1");
    expect(first.variants.at(0)).toEqual({
      weftDensity: "10",
      threadWidth: "2.6",
      baseRatePerMeter: "62.16",
      bonusRatePerMeter: null,
    });
    expect(typeof first.variants.at(0)?.baseRatePerMeter).toBe("string");
  });
});

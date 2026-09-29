import type { components } from "../../../api/generated/schema";

export const RATE_DENSITIES = ["10", "11", "12"] as const;
export const RATE_COLUMN_COUNT = 8;

type RateDensity = (typeof RATE_DENSITIES)[number];
type ApiRateRow = components["schemas"]["RateMatrixRow"];
type ApiRateRowInput = components["schemas"]["RateMatrixRowInput"];

interface EditableVariant {
  threadWidth: string;
  baseRatePerMeter: string;
  bonusRatePerMeter?: string | null;
}

export interface EditableRateRow {
  clientRowId: string;
  widthFromCm: string;
  widthToCm: string;
  variants: Record<RateDensity, EditableVariant>;
}

export interface RatePasteResult {
  rows: EditableRateRow[];
  error: string | null;
}

const decimalPattern = /^\d+(?:\.\d+)?$/;

function decimalParts(value: string) {
  const [integer = "0", fraction = ""] = value.split(".");
  return {
    integer: integer.replace(/^0+(?=\d)/, ""),
    fraction: fraction.replace(/0+$/, ""),
  };
}

function compareDecimal(left: string, right: string) {
  const a = decimalParts(left);
  const b = decimalParts(right);
  if (a.integer.length !== b.integer.length)
    return a.integer.length > b.integer.length ? 1 : -1;
  if (a.integer !== b.integer) return a.integer > b.integer ? 1 : -1;
  const width = Math.max(a.fraction.length, b.fraction.length);
  const aFraction = a.fraction.padEnd(width, "0");
  const bFraction = b.fraction.padEnd(width, "0");
  return aFraction === bFraction ? 0 : aFraction > bFraction ? 1 : -1;
}

function isPositiveDecimal(value: string) {
  return decimalPattern.test(value) && compareDecimal(value, "0") > 0;
}

function variantFromApi(row: ApiRateRow, density: RateDensity) {
  const variant = row.variants.find((item) => item.weftDensity === density);
  return {
    threadWidth: variant?.threadWidth ?? "",
    baseRatePerMeter: variant?.baseRatePerMeter ?? "",
    bonusRatePerMeter: variant?.bonusRatePerMeter ?? null,
  };
}

export function toEditableRateRows(rows: ApiRateRow[]): EditableRateRow[] {
  return rows.map((row) => ({
    clientRowId: row.id,
    widthFromCm: row.widthFromCm,
    widthToCm: row.widthToCm,
    variants: {
      "10": variantFromApi(row, "10"),
      "11": variantFromApi(row, "11"),
      "12": variantFromApi(row, "12"),
    },
  }));
}

export function createEmptyRateRow(): EditableRateRow {
  return {
    clientRowId: crypto.randomUUID(),
    widthFromCm: "",
    widthToCm: "",
    variants: {
      "10": { threadWidth: "", baseRatePerMeter: "", bonusRatePerMeter: null },
      "11": { threadWidth: "", baseRatePerMeter: "", bonusRatePerMeter: null },
      "12": { threadWidth: "", baseRatePerMeter: "", bonusRatePerMeter: null },
    },
  };
}

function rowValues(row: EditableRateRow) {
  return [
    row.widthFromCm,
    row.widthToCm,
    row.variants["10"].threadWidth,
    row.variants["10"].baseRatePerMeter,
    row.variants["11"].threadWidth,
    row.variants["11"].baseRatePerMeter,
    row.variants["12"].threadWidth,
    row.variants["12"].baseRatePerMeter,
  ];
}

function withValues(row: EditableRateRow, pasted: string[]) {
  const values = rowValues(row);
  pasted.forEach((value, index) => {
    values[index] = value.trim();
  });
  const [
    widthFromCm = "",
    widthToCm = "",
    threadWidth10 = "",
    baseRate10 = "",
    threadWidth11 = "",
    baseRate11 = "",
    threadWidth12 = "",
    baseRate12 = "",
  ] = values;
  return {
    ...row,
    widthFromCm,
    widthToCm,
    variants: {
      "10": {
        ...row.variants["10"],
        threadWidth: threadWidth10,
        baseRatePerMeter: baseRate10,
      },
      "11": {
        ...row.variants["11"],
        threadWidth: threadWidth11,
        baseRatePerMeter: baseRate11,
      },
      "12": {
        ...row.variants["12"],
        threadWidth: threadWidth12,
        baseRatePerMeter: baseRate12,
      },
    },
  };
}

export function parseRateClipboard(text: string) {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  if (!normalized) return [];
  return normalized.split("\n").map((line) => line.split("\t"));
}

export function applyRatePaste(
  rows: EditableRateRow[],
  selectedRowIds: string[],
  matrix: string[][],
): RatePasteResult {
  if (selectedRowIds.length === 0)
    return { rows, error: "Pilih minimal satu range tujuan." };
  if (matrix.length === 0)
    return { rows, error: "Clipboard tidak berisi data." };
  if (matrix.some((line) => line.length > RATE_COLUMN_COUNT))
    return {
      rows,
      error: `Tabel harga hanya memiliki ${RATE_COLUMN_COUNT} kolom data. Tidak ada nilai yang ditempel.`,
    };
  if (matrix.length !== 1 && matrix.length !== selectedRowIds.length)
    return {
      rows,
      error: `Clipboard berisi ${matrix.length} baris, sedangkan ${selectedRowIds.length} range dipilih.`,
    };

  const selected = new Map(selectedRowIds.map((id, index) => [id, index]));
  return {
    rows: rows.map((row) => {
      const selectedIndex = selected.get(row.clientRowId);
      if (selectedIndex === undefined) return row;
      const pasted =
        matrix.length === 1 ? (matrix[0] ?? []) : (matrix[selectedIndex] ?? []);
      return withValues(row, pasted);
    }),
    error: null,
  };
}

export function copyRateRows(
  rows: EditableRateRow[],
  selectedRowIds: string[],
) {
  const selected = new Set(selectedRowIds);
  return rows
    .filter((row) => selected.has(row.clientRowId))
    .map((row) => rowValues(row).join("\t"))
    .join("\n");
}

export function validateRateDraft(rows: EditableRateRow[]) {
  const errors: string[] = [];
  if (rows.length === 0) return ["Tambahkan minimal satu range harga."];

  rows.forEach((row, index) => {
    const position = index + 1;
    if (!isPositiveDecimal(row.widthFromCm))
      errors.push(`Lebar minimum range ${position} harus lebih dari 0.`);
    if (!isPositiveDecimal(row.widthToCm))
      errors.push(`Lebar maksimum range ${position} harus lebih dari 0.`);
    if (
      decimalPattern.test(row.widthFromCm) &&
      decimalPattern.test(row.widthToCm) &&
      compareDecimal(row.widthFromCm, row.widthToCm) > 0
    )
      errors.push(`Lebar minimum range ${position} melebihi maksimum.`);

    RATE_DENSITIES.forEach((density) => {
      const variant = row.variants[density];
      if (!isPositiveDecimal(variant.threadWidth))
        errors.push(
          `Lebar benang ${density} × ${density} range ${position} harus lebih dari 0.`,
        );
      if (!isPositiveDecimal(variant.baseRatePerMeter))
        errors.push(
          `Harga ${density} × ${density} range ${position} harus lebih dari 0.`,
        );
    });
  });

  rows.forEach((current, index) => {
    if (
      !decimalPattern.test(current.widthFromCm) ||
      !decimalPattern.test(current.widthToCm)
    )
      return;
    rows.slice(index + 1).forEach((next, offset) => {
      const nextIndex = index + offset + 1;
      if (
        !decimalPattern.test(next.widthFromCm) ||
        !decimalPattern.test(next.widthToCm)
      )
        return;
      if (
        compareDecimal(current.widthFromCm, next.widthToCm) <= 0 &&
        compareDecimal(next.widthFromCm, current.widthToCm) <= 0
      ) {
        errors.push(
          `Range ${index + 1} dan ${nextIndex + 1} bertumpuk. Pisahkan batas lebarnya.`,
        );
      }
    });
  });

  return errors;
}

export function buildRateRowsPayload(
  rows: EditableRateRow[],
): ApiRateRowInput[] {
  return rows.map((row) => ({
    clientRowId: row.clientRowId,
    widthFromCm: row.widthFromCm,
    widthToCm: row.widthToCm,
    variants: RATE_DENSITIES.map((density) => ({
      weftDensity: density,
      threadWidth: row.variants[density].threadWidth,
      baseRatePerMeter: row.variants[density].baseRatePerMeter,
      bonusRatePerMeter: row.variants[density].bonusRatePerMeter ?? null,
    })),
  }));
}

export interface OverrideDraftRow {
  pin: string;
  basePay: string;
  bonusPay: string;
}

export { formatRupiah } from "../../../lib/format-money";

export type OverrideField = "basePay" | "bonusPay";

export function normalizeMoneyInput(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^rp\s*/i, "")
    .replace(/[\s\u00a0]/g, "");
  if (!cleaned || !/^[0-9.,]+$/.test(cleaned)) return null;

  const dots = [...cleaned.matchAll(/\./g)].length;
  const commas = [...cleaned.matchAll(/,/g)].length;
  if (dots && commas) {
    const separator =
      cleaned.lastIndexOf(".") > cleaned.lastIndexOf(",") ? "." : ",";
    const last = cleaned.lastIndexOf(separator);
    const fraction = cleaned.slice(last + 1);
    if (fraction.length > 0 && fraction.length <= 2) {
      const integer = cleaned.slice(0, last).replace(/[.,]/g, "");
      return `${integer}.${fraction}`;
    }
    return cleaned.replace(/[.,]/g, "");
  }

  const separator = dots ? "." : commas ? "," : "";
  if (!separator) return cleaned;
  const parts = cleaned.split(separator);
  if (parts.some((part) => !part)) return null;
  if (parts.length > 2)
    return parts.slice(1).every((part) => part.length === 3)
      ? parts.join("")
      : null;
  const fraction = parts[1] ?? "";
  if (fraction.length === 3) return parts.join("");
  if (fraction.length <= 2) return `${parts[0]}.${fraction}`;
  return null;
}

export function parseOverrideMatrix(text: string): string[][] {
  const normalized = text.replace(/\r\n?/g, "\n").trimEnd();
  if (!normalized) return [];
  const rows = normalized.split("\n").map((line) => line.split("\t"));
  if (rows.some((row) => row.length > 2))
    throw new Error("Data override hanya boleh berisi base pay dan bonus pay.");
  return rows;
}

export function applyOverrideMatrix<T extends OverrideDraftRow>(
  rows: T[],
  selectedPins: ReadonlySet<string>,
  startPin: string,
  matrix: string[][],
  startField: OverrideField = "basePay",
): T[] {
  if (!matrix.length) throw new Error("Clipboard tidak berisi data override.");
  const selectedTargets = rows.filter((row) => selectedPins.has(row.pin));
  const startIndex = rows.findIndex((row) => row.pin === startPin);
  const targets = selectedTargets.length
    ? selectedTargets
    : rows.slice(
        Math.max(0, startIndex),
        Math.max(0, startIndex) + matrix.length,
      );
  if (!targets.length)
    throw new Error("Pilih karyawan tujuan terlebih dahulu.");
  if (matrix.length !== 1 && matrix.length !== targets.length)
    throw new Error(
      "Jumlah baris yang ditempel harus sama dengan jumlah pilihan.",
    );

  const values = new Map<string, Pick<OverrideDraftRow, OverrideField>>();
  targets.forEach((target, index) => {
    const source = matrix.length === 1 ? matrix[0] : matrix[index];
    if (!source) return;
    const fields: OverrideField[] =
      startField === "bonusPay" ? ["bonusPay"] : ["basePay", "bonusPay"];
    const next = { basePay: target.basePay, bonusPay: target.bonusPay };
    source.forEach((value, column) => {
      const field = fields[column];
      if (!field || value.trim() === "") return;
      const normalized = normalizeMoneyInput(value);
      if (normalized === null)
        throw new Error(`Nominal "${value}" tidak valid.`);
      next[field] = normalized;
    });
    values.set(target.pin, next);
  });

  return rows.map((row) => {
    const next = values.get(row.pin);
    return next ? { ...row, ...next } : row;
  });
}

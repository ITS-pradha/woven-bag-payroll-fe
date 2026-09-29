const traceLabels: Record<string, string> = {
  formula: "Rumus",
  resultMeter: "Hasil produksi",
  targetMeter: "Target produksi",
  payRatePerMeter: "Tarif per meter",
  baseRatePerMeter: "Tarif dasar per meter",
  bonusRatePerMeter: "Tarif bonus per meter",
  roundedBasePay: "Base pay setelah pembulatan",
  roundedBonusPay: "Bonus setelah pembulatan",
  roundingMode: "Aturan pembulatan",
};

export function formatDateWib(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

export function formatDateTimeWib(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(",", "");
}

export function formatDecimal(value: string) {
  return value.replace(".", ",");
}

export function traceLabel(key: string) {
  return traceLabels[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function traceValue(value: unknown) {
  if (value === null) return "—";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  try {
    return JSON.stringify(value);
  } catch {
    return "Nilai tidak dapat ditampilkan";
  }
}

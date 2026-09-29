import { z } from "zod";

import { formatNumber } from "../../../lib/format-number";

/**
 * Calculation trace dari engine payroll, diterjemahkan jadi langkah hitung
 * yang bisa dibaca admin: "845 m × Rp59,0777 = Rp49.920,66", bukan
 * `{"step":"basePay","expression":"resultMeter * payRatePerMeter"}`.
 *
 * Kontrak menyimpan trace sebagai objek bebas (`additionalProperties`), jadi
 * bentuknya dibaca defensif: yang tidak cocok dengan bentuk engine hari ini
 * dikembalikan `null` dan layar jatuh ke daftar kunci–nilai biasa. Nilai
 * mentah tidak pernah hilang — semuanya ada di "Detail teknis".
 */
const traceSchema = z.object({
  formulaVersion: z.string().optional(),
  formulaStatus: z.string().optional(),
  formulaStrategy: z.string().optional(),
  rateVersionId: z.string().optional(),
  rateVersionCode: z.string().optional(),
  configVersionCode: z.string().optional(),
  rateRowId: z.string().optional(),
  ratePriority: z.union([z.number(), z.string()]).optional(),
  inputs: z.record(z.string(), z.unknown()).optional(),
  steps: z
    .array(
      z.object({
        step: z.string(),
        expression: z.string().optional(),
        value: z.union([z.string(), z.number()]),
      }),
    )
    .min(1),
  rounding: z
    .object({
      mode: z.string().optional(),
      decimals: z.number().optional(),
      appliedAt: z.string().optional(),
    })
    .optional(),
});

export interface TraceStep {
  key: string;
  label: string;
  /** Rumus dengan angka baris ini, dalam kalimat. */
  working: string;
  result: string;
  /** Nilai presisi penuh bila `result` sudah dibulatkan untuk dibaca. */
  exact: string;
  expression: string;
  /** Langkah yang hasilnya nol karena memang tidak berlaku (mis. tanpa bonus). */
  muted: boolean;
}

export interface TraceFact {
  label: string;
  value: string;
}

export interface ReadableTrace {
  steps: TraceStep[];
  inputs: TraceFact[];
  pricing: TraceFact[];
  notes: { tone: "info" | "warning"; text: string }[];
  technical: TraceFact[];
}

const DURATION_MODE: Record<string, string> = {
  SHIFT_ELAPSED: "Lama shift",
  NORMALIZED_RUNTIME: "Runtime mesin (dinormalkan)",
};
const SOURCE_TYPE: Record<string, string> = {
  MANUAL: "Manual Data",
  LDMS: "LDMS",
};
const LOOM_GROUP: Record<string, string> = {
  REGULAR: "Regular",
  CS: "CS",
  SP: "SP",
};
const PPM_SOURCE: Record<string, string> = {
  FIXED: "PPM tetap",
  WIDTH_CURVE: "kurva lebar",
};

export function strategyLabel(strategy: string) {
  if (strategy.startsWith("SPECIAL_RULE:"))
    return `Aturan khusus ${strategy.slice("SPECIAL_RULE:".length)}`;
  return (
    {
      MATRIX: "Matriks tarif",
      MATRIX_INTERPOLATED: "Matriks tarif, weft diinterpolasi",
      MATRIX_EXTRAPOLATED: "Matriks tarif, weft di luar kolom",
      REGULAR_WIDTH_CURVE: "Kurva lebar (Regular)",
      TARGET_BASED: "Diturunkan dari target per jam",
    }[strategy] ?? strategy
  );
}

function roundingLabel(rounding: z.infer<typeof traceSchema>["rounding"]) {
  if (!rounding?.mode) return null;
  const decimals = rounding.decimals ?? 4;
  if (
    rounding.mode === "HALF_UP_AT_PIN_TOTAL" ||
    rounding.appliedAt === "PIN_TOTAL"
  )
    return `Baris ini tidak dibulatkan; total per karyawan dibulatkan setengah ke atas, ${decimals} desimal.`;
  if (rounding.mode === "HALF_UP_PER_LINE" || rounding.appliedAt === "PER_LINE")
    return `Dibulatkan setengah ke atas per baris, ${decimals} desimal.`;
  return rounding.mode;
}

const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

export function readableTrace(raw: unknown): ReadableTrace | null {
  const parsed = traceSchema.safeParse(raw);
  if (!parsed.success) return null;
  const trace = parsed.data;
  const input = (key: string) => text(trace.inputs?.[key]);
  const stepValue = (key: string) =>
    text(trace.steps.find((step) => step.step === key)?.value);

  const meter = (value: string) => `${formatNumber(value, 2)} m`;
  const rupiah = (value: string, digits = 2) =>
    `Rp${formatNumber(value, digits)}`;
  const perMeter = (value: string) => `${rupiah(value, 4)}/m`;

  const resultMeter = input("resultMeter");
  const width = input("widthCm");
  const weft = input("weftDensity");
  const hours = stepValue("durationHours");
  const perHour = stepValue("targetMeterPerHour");
  const target = stepValue("targetMeter");
  const rate = stepValue("payRatePerMeter") || input("payRatePerMeter");
  const excess = stepValue("excessMeter");
  const bonusRate = stepValue("bonusRate");
  const multiplier = input("bonusMultiplier");
  const strategy = trace.formulaStrategy ?? "";
  const interpolation = input("weftInterpolation");

  const describe = (
    key: string,
    expression: string,
    value: string,
  ): Omit<TraceStep, "key" | "expression" | "exact" | "muted"> => {
    switch (key) {
      case "durationHours":
        return {
          label: "Durasi kerja",
          working:
            input("durationMode") === "NORMALIZED_RUNTIME"
              ? "Runtime mesin dari LDMS, dinormalkan ke 100%"
              : "Jam selesai shift dikurangi jam mulai shift",
          result: `${formatNumber(value, 2)} jam`,
        };
      case "targetMeterPerHour":
        return {
          label: "Target per jam",
          working:
            input("targetMeterPerHourSource") === "rate row"
              ? `Target dari baris tarif × faktor sumber ${formatNumber(input("sourceTargetFactor") || "1", 4)}`
              : `${formatNumber(input("targetPpm"), 2)} PPM (${PPM_SOURCE[input("targetPpmSource")] ?? input("targetPpmSource")}) untuk weft ${formatNumber(weft, 2)}, dengan efisiensi dan pembagian mesin dari policy`,
          result: `${formatNumber(value, 2)} m/jam`,
        };
      case "targetMeter":
        return {
          label: "Target shift",
          working: `${formatNumber(perHour, 2)} m/jam × ${formatNumber(hours, 2)} jam`,
          result: meter(value),
        };
      case "payRatePerMeter":
        return {
          label: "Tarif per meter",
          working: payRateWorking(),
          result: perMeter(value),
        };
      case "basePay":
        return {
          label: "Base pay",
          working: `${meter(resultMeter)} × ${perMeter(rate)}`,
          result: rupiah(value),
        };
      case "excessMeter":
        return {
          label: "Kelebihan dari target",
          working: isZero(value)
            ? `${meter(resultMeter)} belum melewati target ${meter(target)}`
            : `${meter(resultMeter)} − ${meter(target)}`,
          result: meter(value),
        };
      case "bonusRate":
        return {
          label: "Tarif bonus",
          working:
            expression === "bonusRatePerMeter"
              ? "Dari kolom bonus di matriks tarif"
              : `${perMeter(rate)} × pengali bonus ${formatNumber(multiplier, 4)}`,
          result: perMeter(value),
        };
      case "bonusPay":
        return {
          label: "Bonus",
          working: `${meter(excess)} × ${perMeter(bonusRate)}`,
          result: rupiah(value),
        };
      default:
        return {
          label: key.replace(/([a-z])([A-Z])/g, "$1 $2"),
          working: expression,
          result: formatNumber(value, 4),
        };
    }
  };

  function payRateWorking() {
    if (strategy === "REGULAR_WIDTH_CURVE")
      return `Kurva lebar Regular untuk lebar ${formatNumber(width, 2)} cm, disesuaikan dengan weft ${formatNumber(weft, 2)}`;
    if (strategy === "TARGET_BASED")
      return `Diturunkan dari target ${formatNumber(perHour, 2)} m/jam`;
    if (strategy.startsWith("SPECIAL_RULE:"))
      return `Tarif tetap dari ${strategyLabel(strategy).toLowerCase()} untuk lebar ${formatNumber(width, 2)} cm`;
    if (strategy.startsWith("MATRIX") && interpolation) {
      const [from, to] = interpolation.split("->").map((part) => part.trim());
      return `Matriks tarif lebar ${formatNumber(width, 2)} cm; weft ${formatNumber(weft, 2)} ${
        input("weftInterpolationMode") === "EXTRAPOLATED"
          ? "di luar kolom, diteruskan dari"
          : "diinterpolasi antara"
      } kolom ${formatNumber(from ?? "", 2)} dan ${formatNumber(to ?? "", 2)}`;
    }
    if (strategy.startsWith("MATRIX"))
      return `Matriks tarif untuk lebar ${formatNumber(width, 2)} cm dan weft ${formatNumber(weft, 2)}`;
    return strategyLabel(strategy);
  }

  const steps: TraceStep[] = trace.steps.map((step) => {
    const value = text(step.value);
    const expression = step.expression ?? "";
    return {
      key: step.step,
      expression,
      exact: value,
      muted: isZero(value) && /bonus|excess/i.test(step.step),
      ...describe(step.step, expression, value),
    };
  });

  const inputs: TraceFact[] = [
    ["Hasil", resultMeter && meter(resultMeter)],
    ["Lebar", width && `${formatNumber(width, 2)} cm`],
    ["Weft", weft && formatNumber(weft, 2)],
    ["Grup mesin", LOOM_GROUP[input("loomGroup")] ?? input("loomGroup")],
    ["Sumber data", SOURCE_TYPE[input("sourceType")] ?? input("sourceType")],
    [
      "Durasi dihitung dari",
      DURATION_MODE[input("durationMode")] ?? input("durationMode"),
    ],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => ({ label: label!, value: value! }));

  const pricing: TraceFact[] = [
    ["Versi harga", trace.configVersionCode ?? trace.rateVersionCode ?? ""],
    ["Cara tarif ditentukan", strategy && strategyLabel(strategy)],
    ["Pengali bonus", multiplier && `${formatNumber(multiplier, 4)}×`],
    ["Pembulatan", roundingLabel(trace.rounding) ?? ""],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => ({ label: label!, value: value! }));

  const notes: ReadableTrace["notes"] = [];
  if (trace.formulaStatus === "PLACEHOLDER")
    notes.push({
      tone: "warning",
      text: `Rumus sementara${input("durationFallback") ? `: ${input("durationFallback")}` : ""}. Periksa ulang sebelum payroll dikunci.`,
    });
  else if (input("durationFallback"))
    notes.push({ tone: "warning", text: input("durationFallback") });

  const technical: TraceFact[] = [
    ["Versi rumus", trace.formulaVersion ?? ""],
    ["Status rumus", trace.formulaStatus ?? ""],
    ["Strategy", strategy],
    ["Kode versi tarif", trace.rateVersionCode ?? ""],
    ["Rate version ID", trace.rateVersionId ?? ""],
    ["Rate row ID", trace.rateRowId ?? ""],
    ["Prioritas baris tarif", text(trace.ratePriority)],
    ["Mode interpolasi", input("interpolationMode")],
    ["Di luar rentang weft", input("outOfRangeMode")],
    ["Anchor interpolasi", input("weftAnchorRateIds")],
    ["Faktor target sumber", input("sourceTargetFactor")],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => ({ label: label!, value: value! }));

  return { steps, inputs, pricing, notes, technical };
}

function isZero(value: string) {
  return /^-?0*(\.0*)?$/.test(value.trim()) && value.trim() !== "";
}

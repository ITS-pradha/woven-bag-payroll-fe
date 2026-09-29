import type { components } from "../../../api/generated/schema";

export type CalculationPolicyDraft =
  components["schemas"]["RateCalculationPolicyWrite"];

export function createDefaultCalculationPolicy(): CalculationPolicyDraft {
  return {
    targetPpmPolicy: { type: "FIXED", fixedTargetPpm: "100" },
    payRateFormula: { type: "MATRIX" },
    targetMeterPolicy: {
      millimetersPerInch: "25.4",
      millimetersPerMeter: "1000",
      baseEfficiencyFactor: "1",
      minutesPerHour: "60",
      loomShareNumerator: "1",
      loomShareDenominator: "1",
    },
    sourceDurationPolicies: [
      {
        sourceType: "MANUAL",
        durationMode: "SHIFT_ELAPSED",
        percentageScale: "100",
        minutesPerHour: "60",
      },
      {
        sourceType: "LDMS",
        durationMode: "NORMALIZED_RUNTIME",
        percentageScale: "100",
        minutesPerHour: "60",
      },
    ],
    sourceTargetFactors: [
      { sourceType: "MANUAL", multiplier: "1" },
      { sourceType: "LDMS", multiplier: "1" },
    ],
    interpolationMode: "LINEAR",
    outOfRangeMode: "CLAMP",
    specialRules: [],
  };
}

const decimalPattern = /^\d+(?:\.\d+)?$/;

export function validateCalculationPolicy(
  policy: CalculationPolicyDraft,
): string | null {
  const decimals: string[] = [
    ...Object.values(policy.targetMeterPolicy),
    ...policy.sourceDurationPolicies.flatMap((item) => [
      item.percentageScale,
      item.minutesPerHour,
    ]),
    ...policy.sourceTargetFactors.map((item) => item.multiplier),
  ];
  if (policy.targetPpmPolicy.type === "FIXED")
    decimals.push(policy.targetPpmPolicy.fixedTargetPpm);
  else
    decimals.push(
      policy.targetPpmPolicy.basePpm,
      policy.targetPpmPolicy.curveNumerator,
      policy.targetPpmPolicy.widthDivisor,
      policy.targetPpmPolicy.exponent,
    );
  if (policy.payRateFormula.type === "REGULAR_WIDTH_CURVE")
    decimals.push(
      policy.payRateFormula.constantA,
      policy.payRateFormula.constantB,
      policy.payRateFormula.curveNumerator,
      policy.payRateFormula.widthDivisor,
      policy.payRateFormula.exponent,
      policy.payRateFormula.densityDivisor,
    );
  if (policy.payRateFormula.type === "TARGET_BASED")
    decimals.push(
      policy.payRateFormula.baseRate,
      policy.payRateFormula.numerator,
      policy.payRateFormula.referenceHours,
      policy.payRateFormula.machinesPerOperator,
    );
  for (const rule of policy.specialRules) {
    decimals.push(rule.widthFromCm, rule.ratePerMeter);
    if (rule.widthOperator === "RANGE" && rule.widthToCm)
      decimals.push(rule.widthToCm);
  }
  if (decimals.some((value) => !decimalPattern.test(value.trim())))
    return "Semua angka wajib diisi dengan format desimal positif atau nol.";
  const priorities = policy.specialRules.map((rule) => rule.priority);
  if (new Set(priorities).size !== priorities.length)
    return "Prioritas aturan khusus tidak boleh sama.";
  if (
    policy.specialRules.some(
      (rule) => rule.widthOperator === "RANGE" && !rule.widthToCm,
    )
  )
    return "Batas lebar akhir wajib diisi untuk aturan rentang.";
  return null;
}

export function changeTargetPpmType(
  type: "FIXED" | "WIDTH_CURVE",
): CalculationPolicyDraft["targetPpmPolicy"] {
  return type === "FIXED"
    ? { type, fixedTargetPpm: "100" }
    : {
        type,
        basePpm: "100",
        curveNumerator: "1",
        widthDivisor: "1",
        exponent: "1",
      };
}

export function changePayFormulaType(
  type: "MATRIX" | "REGULAR_WIDTH_CURVE" | "TARGET_BASED",
): CalculationPolicyDraft["payRateFormula"] {
  if (type === "MATRIX") return { type };
  if (type === "TARGET_BASED")
    return {
      type,
      baseRate: "0",
      numerator: "1",
      referenceHours: "8",
      machinesPerOperator: "3",
    };
  return {
    type,
    constantA: "0",
    constantB: "0",
    curveNumerator: "1",
    widthDivisor: "1",
    exponent: "1",
    densityDivisor: "1",
  };
}

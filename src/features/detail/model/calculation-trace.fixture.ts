/** Trace nyata dari engine (mesin 31, KARUNG, Regular) — bentuk yang disimpan backend. */
export const regularCurveTrace = {
  steps: [
    {
      step: "durationHours",
      value: "8",
      expression: "(shiftEnd - shiftStart) / 3600s",
    },
    {
      step: "targetMeterPerHour",
      value: "130.28022928662",
      expression:
        "targetPpm * (millimetersPerInch / (millimetersPerMeter * weft)) * baseEfficiencyFactor * minutesPerHour * loomShare * sourceTargetFactor",
    },
    {
      step: "targetMeter",
      value: "1042.24183429296",
      expression: "targetMeterPerHour * durationHours",
    },
    {
      step: "payRatePerMeter",
      value: "59.077707",
      expression:
        "(constantA - constantB + curveNumerator / (1 + (width / widthDivisor)^exponent)) * (weft / densityDivisor)",
    },
    {
      step: "basePay",
      value: "49920.662415",
      expression: "resultMeter * payRatePerMeter",
    },
    {
      step: "excessMeter",
      value: "0",
      expression: "max(0, resultMeter - targetMeter)",
    },
    {
      step: "bonusRate",
      value: "70.8932484",
      expression: "payRatePerMeter * bonusMultiplier",
    },
    { step: "bonusPay", value: "0", expression: "excessMeter * bonusRate" },
  ],
  inputs: {
    widthCm: "50.00",
    loomGroup: "REGULAR",
    targetPpm: "1028.399576",
    sourceType: "MANUAL",
    resultMeter: "845.000",
    weftDensity: "10.000",
    durationMode: "SHIFT_ELAPSED",
    outOfRangeMode: "EXTRAPOLATE",
    bonusMultiplier: "1.2000",
    payRatePerMeter: "59.077707",
    targetPpmSource: "WIDTH_CURVE",
    interpolationMode: "LINEAR",
    sourceTargetFactor: "1",
    targetMeterPerHour: "130.28022928662",
    targetMeterPerHourSource: "policy",
  },
  rounding: {
    mode: "HALF_UP_AT_PIN_TOTAL",
    decimals: 4,
    appliedAt: "PIN_TOTAL",
  },
  rateRowId: "4b20af33-513e-4e00-a227-bca9269d7efb",
  ratePriority: 1,
  formulaStatus: "APPROVED",
  rateVersionId: "49b20520-32f5-422b-ab6f-b2fc57ddaf66",
  formulaVersion: "legacy-compatible-2026-09",
  formulaStrategy: "REGULAR_WIDTH_CURVE",
  rateVersionCode: "LOOM_REGULAR:v1",
  configVersionCode: "HB-REG-LEGACY-V1",
};

import { z } from "zod";

import { apiClient } from "../../../api/client/api-client";
import { ApiClientError, unwrapApiData } from "../../../api/client/api-result";
import type { components } from "../../../api/generated/schema";
import type { IdempotentRateMutation } from "./rates-api";

const decimal = z.string().regex(/^\d+(?:\.\d+)?$/);
const sourceType = z.enum(["MANUAL", "LDMS"]);
const targetPpmPolicy = z.discriminatedUnion("type", [
  z.object({ type: z.literal("FIXED"), fixedTargetPpm: decimal }),
  z.object({
    type: z.literal("WIDTH_CURVE"),
    basePpm: decimal,
    curveNumerator: decimal,
    widthDivisor: decimal,
    exponent: decimal,
  }),
]);
const payRateFormula = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MATRIX") }),
  z.object({
    type: z.literal("REGULAR_WIDTH_CURVE"),
    constantA: decimal,
    constantB: decimal,
    curveNumerator: decimal,
    widthDivisor: decimal,
    exponent: decimal,
    densityDivisor: decimal,
  }),
  z.object({
    type: z.literal("TARGET_BASED"),
    baseRate: decimal,
    numerator: decimal,
    referenceHours: decimal,
    machinesPerOperator: decimal,
  }),
]);
const policyWriteSchema = z.object({
  targetPpmPolicy,
  payRateFormula,
  targetMeterPolicy: z.object({
    millimetersPerInch: decimal,
    millimetersPerMeter: decimal,
    baseEfficiencyFactor: decimal,
    minutesPerHour: decimal,
    loomShareNumerator: decimal,
    loomShareDenominator: decimal,
  }),
  sourceDurationPolicies: z.array(
    z.object({
      sourceType,
      durationMode: z.enum(["SHIFT_ELAPSED", "NORMALIZED_RUNTIME"]),
      percentageScale: decimal,
      minutesPerHour: decimal,
    }),
  ),
  sourceTargetFactors: z.array(z.object({ sourceType, multiplier: decimal })),
  interpolationMode: z.literal("LINEAR"),
  outOfRangeMode: z.enum(["EXTRAPOLATE", "CLAMP", "REJECT"]),
  specialRules: z.array(
    z.object({
      clientRuleId: z.string(),
      priority: z.number().int().positive(),
      sourceType: sourceType.nullable().optional(),
      widthOperator: z.enum([
        "EQUALS",
        "GREATER_THAN",
        "GREATER_THAN_OR_EQUAL",
        "RANGE",
      ]),
      widthFromCm: decimal,
      widthToCm: decimal.nullable().optional(),
      ratePerMeter: decimal,
    }),
  ),
});
const policySchema = policyWriteSchema.extend({
  rateVersionId: z.string().uuid(),
  rowVersion: z.number().int().positive(),
  updatedBy: z.string(),
  updatedAt: z.string(),
});

function validatePolicy<T>(data: T): T {
  const parsed = policySchema.safeParse(data);
  if (!parsed.success)
    throw new Error(
      "Respons backend aturan kalkulasi belum sesuai OpenAPI. Data tidak diterapkan.",
    );
  return data;
}

export async function getRateCalculationPolicy(
  rateVersionId: string,
  signal?: AbortSignal,
): Promise<RateCalculationPolicy | null> {
  try {
    return validatePolicy(
      unwrapApiData(
        await apiClient.GET(
          "/pay-rate-versions/{rateVersionId}/calculation-policy",
          {
            params: { path: { rateVersionId } },
            ...(signal ? { signal } : {}),
          },
        ),
      ),
    );
  } catch (cause) {
    if (cause instanceof ApiClientError && cause.status === 404) return null;
    throw cause;
  }
}

export async function replaceRateCalculationPolicy(
  rateVersionId: string,
  attempt: IdempotentRateMutation<ReplaceRateCalculationPolicyRequest>,
  csrfToken: string,
) {
  return validatePolicy(
    unwrapApiData(
      await apiClient.PUT(
        "/pay-rate-versions/{rateVersionId}/calculation-policy",
        {
          params: {
            path: { rateVersionId },
            header: { "Idempotency-Key": attempt.key },
          },
          headers: { "X-CSRF-Token": csrfToken },
          body: attempt.body,
        },
      ),
    ),
  );
}

export type RateCalculationPolicy =
  components["schemas"]["RateCalculationPolicy"];
export type RateCalculationPolicyWrite =
  components["schemas"]["RateCalculationPolicyWrite"];
export type ReplaceRateCalculationPolicyRequest =
  components["schemas"]["ReplaceRateCalculationPolicyRequest"];

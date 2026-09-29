import { z } from "zod";

import { apiClient } from "../../../api/client/api-client";
import { unwrapApiData } from "../../../api/client/api-result";
import type { components } from "../../../api/generated/schema";

const cursorPageSchema = z.object({
  pageSize: z.number().int().positive().max(500),
  hasNextPage: z.boolean(),
  nextCursor: z.string().nullable(),
});
const variantSchema = z.object({
  weftDensity: z.string(),
  threadWidth: z.string(),
  baseRatePerMeter: z.string(),
  bonusRatePerMeter: z.string().nullable().optional(),
});
const rowSchema = z.object({
  id: z.string().uuid(),
  rowVersion: z.number().int().positive(),
  widthFromCm: z.string(),
  widthToCm: z.string(),
  variants: z.array(variantSchema).min(1).max(20),
});
const versionSchema = z.object({
  id: z.string().uuid(),
  scheduleCode: z.string(),
  versionNo: z.number().int().positive(),
  code: z.string(),
  name: z.string(),
  machineGroup: z.enum(["REGULAR", "CS", "SP"]),
  effectiveFrom: z.string(),
  effectiveToExclusive: z.string().nullable().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "RETIRED"]),
  bonusMultiplier: z.string(),
  roundingMode: z.enum(["HALF_UP_PER_LINE", "HALF_UP_AT_PIN_TOTAL"]),
  changeNote: z.string().nullable().optional(),
  rowVersion: z.number().int().positive(),
  createdBy: z.string(),
  createdAt: z.string(),
  approvedBy: z.string().nullable().optional(),
  approvedAt: z.string().nullable().optional(),
});
const versionWithRowsSchema = versionSchema.extend({
  rows: z.array(rowSchema).max(10_000),
});
const versionListSchema = z.object({
  data: z.array(versionSchema).max(500),
  page: cursorPageSchema,
});

function contract<T>(schema: z.ZodType<unknown>, data: T): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new Error(
      "Respons backend konfigurasi harga belum sesuai OpenAPI. Data tidak diterapkan.",
    );
  return data;
}

export function listRateVersions(signal: AbortSignal, after?: string) {
  return apiClient
    .GET("/pay-rate-versions", {
      params: { query: { pageSize: 50, ...(after ? { after } : {}) } },
      signal,
    })
    .then(unwrapApiData)
    .then((data) => contract(versionListSchema, data));
}

export function getRateVersion(rateVersionId: string, signal?: AbortSignal) {
  return apiClient
    .GET("/pay-rate-versions/{rateVersionId}", {
      params: { path: { rateVersionId } },
      ...(signal ? { signal } : {}),
    })
    .then(unwrapApiData)
    .then((data) => contract(versionWithRowsSchema, data));
}

export interface IdempotentRateMutation<TBody> {
  key: string;
  body: TBody;
}

export async function createRateVersion(
  attempt: IdempotentRateMutation<
    components["schemas"]["CreateRateVersionRequest"]
  >,
  csrfToken: string,
) {
  return contract(
    versionSchema,
    unwrapApiData(
      await apiClient.POST("/pay-rate-versions", {
        params: { header: { "Idempotency-Key": attempt.key } },
        headers: { "X-CSRF-Token": csrfToken },
        body: attempt.body,
      }),
    ),
  );
}

export async function updateRateVersion(
  rateVersionId: string,
  body: components["schemas"]["UpdateRateVersionRequest"],
  csrfToken: string,
) {
  return contract(
    versionSchema,
    unwrapApiData(
      await apiClient.PATCH("/pay-rate-versions/{rateVersionId}", {
        params: { path: { rateVersionId } },
        headers: { "X-CSRF-Token": csrfToken },
        body,
      }),
    ),
  );
}

export async function replaceRateBatch(
  rateVersionId: string,
  attempt: IdempotentRateMutation<components["schemas"]["RateBatchRequest"]>,
  csrfToken: string,
) {
  return contract(
    versionWithRowsSchema,
    unwrapApiData(
      await apiClient.POST("/pay-rate-versions/{rateVersionId}/rate-batches", {
        params: {
          path: { rateVersionId },
          header: { "Idempotency-Key": attempt.key },
        },
        headers: { "X-CSRF-Token": csrfToken },
        body: attempt.body,
      }),
    ),
  );
}

export async function activateRateVersion(
  rateVersionId: string,
  attempt: IdempotentRateMutation<
    components["schemas"]["ActivateRateVersionRequest"]
  >,
  csrfToken: string,
) {
  return contract(
    versionWithRowsSchema,
    unwrapApiData(
      await apiClient.POST("/pay-rate-versions/{rateVersionId}/activations", {
        params: {
          path: { rateVersionId },
          header: { "Idempotency-Key": attempt.key },
        },
        headers: { "X-CSRF-Token": csrfToken },
        body: attempt.body,
      }),
    ),
  );
}

export type RateVersion = components["schemas"]["RateVersion"];
export type RateVersionWithRows = components["schemas"]["RateVersionWithRows"];

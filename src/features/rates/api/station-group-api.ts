import { z } from "zod";

import { apiClient } from "../../../api/client/api-client";
import { unwrapApiData } from "../../../api/client/api-result";
import type { components } from "../../../api/generated/schema";
import type { IdempotentRateMutation } from "./rates-api";

const cursorPageSchema = z.object({
  pageSize: z.number().int().positive().max(500),
  hasNextPage: z.boolean(),
  nextCursor: z.string().nullable(),
});
const stationVersionSchema = z.object({
  id: z.string().uuid(),
  versionNo: z.number().int().positive(),
  code: z.string(),
  name: z.string(),
  effectiveFrom: z.string(),
  effectiveToExclusive: z.string().nullable().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "RETIRED"]),
  changeNote: z.string().nullable().optional(),
  rowVersion: z.number().int().positive(),
  createdBy: z.string(),
  createdAt: z.string(),
  approvedBy: z.string().nullable().optional(),
  approvedAt: z.string().nullable().optional(),
});
const stationMappingSchema = z.object({
  id: z.string().uuid(),
  rowVersion: z.number().int().positive(),
  clientRowId: z.string(),
  stationNo: z.number().int().positive(),
  loomGroup: z.enum(["REGULAR", "CS", "SP"]),
});
const stationVersionWithMappingsSchema = stationVersionSchema.extend({
  mappings: z.array(stationMappingSchema).max(10_000),
});
const stationVersionListSchema = z.object({
  data: z.array(stationVersionSchema).max(500),
  page: cursorPageSchema,
});

function validate<T>(schema: z.ZodType<unknown>, data: T): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new Error(
      "Respons backend kelompok mesin belum sesuai OpenAPI. Data tidak diterapkan.",
    );
  return data;
}

export function listStationGroupVersions(signal: AbortSignal, after?: string) {
  return apiClient
    .GET("/station-group-versions", {
      params: { query: { pageSize: 50, ...(after ? { after } : {}) } },
      signal,
    })
    .then(unwrapApiData)
    .then((data) => validate(stationVersionListSchema, data));
}

export function getStationGroupVersion(id: string, signal?: AbortSignal) {
  return apiClient
    .GET("/station-group-versions/{stationGroupVersionId}", {
      params: { path: { stationGroupVersionId: id } },
      ...(signal ? { signal } : {}),
    })
    .then(unwrapApiData)
    .then((data) => validate(stationVersionWithMappingsSchema, data));
}

export async function createStationGroupVersion(
  attempt: IdempotentRateMutation<CreateStationGroupVersionRequest>,
  csrfToken: string,
) {
  return validate(
    stationVersionSchema,
    unwrapApiData(
      await apiClient.POST("/station-group-versions", {
        params: { header: { "Idempotency-Key": attempt.key } },
        headers: { "X-CSRF-Token": csrfToken },
        body: attempt.body,
      }),
    ),
  );
}

export async function replaceStationGroupMappingBatch(
  id: string,
  attempt: IdempotentRateMutation<StationGroupMappingBatchRequest>,
  csrfToken: string,
) {
  return validate(
    stationVersionWithMappingsSchema,
    unwrapApiData(
      await apiClient.POST(
        "/station-group-versions/{stationGroupVersionId}/mapping-batches",
        {
          params: {
            path: { stationGroupVersionId: id },
            header: { "Idempotency-Key": attempt.key },
          },
          headers: { "X-CSRF-Token": csrfToken },
          body: attempt.body,
        },
      ),
    ),
  );
}

export async function activateStationGroupVersion(
  id: string,
  attempt: IdempotentRateMutation<ActivateStationGroupVersionRequest>,
  csrfToken: string,
) {
  return validate(
    stationVersionWithMappingsSchema,
    unwrapApiData(
      await apiClient.POST(
        "/station-group-versions/{stationGroupVersionId}/activations",
        {
          params: {
            path: { stationGroupVersionId: id },
            header: { "Idempotency-Key": attempt.key },
          },
          headers: { "X-CSRF-Token": csrfToken },
          body: attempt.body,
        },
      ),
    ),
  );
}

export type StationGroupVersion = components["schemas"]["StationGroupVersion"];
export type StationGroupVersionWithMappings =
  components["schemas"]["StationGroupVersionWithMappings"];
export type CreateStationGroupVersionRequest =
  components["schemas"]["CreateStationGroupVersionRequest"];
export type StationGroupMappingBatchRequest =
  components["schemas"]["StationGroupMappingBatchRequest"];
export type ActivateStationGroupVersionRequest =
  components["schemas"]["ActivateStationGroupVersionRequest"];

import { z } from "zod";

import { apiClient } from "../../../api/client/api-client";
import { unwrapApiData } from "../../../api/client/api-result";
import type { components } from "../../../api/generated/schema";

const cursorPageSchema = z.object({
  pageSize: z.number().int().positive().max(500),
  hasNextPage: z.boolean(),
  nextCursor: z.string().nullable(),
});
const payrollPeriodSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  departmentCode: z.string(),
  status: z.enum(["OPEN", "CLOSED"]),
  createdAt: z.string(),
  closedAt: z.string().nullable().optional(),
});
const attendancePeriodSchema = z.object({
  id: z.string().uuid(),
  periodStart: z.string(),
  periodEnd: z.string(),
  departmentCode: z.string(),
  hrisRevision: z.number().int().positive(),
  status: z.enum(["SYNCING", "FINAL", "SUPERSEDED", "FAILED", "REVOKED"]),
  finalizedAt: z.string(),
  finalizedBy: z.string(),
  checksum: z.string(),
  recordCount: z.number().int().nonnegative(),
  syncedAt: z.string(),
});
const payrollRunSchema = z.object({
  id: z.string().uuid(),
  periodId: z.string().uuid(),
  attendancePeriodId: z.string().uuid(),
  runNo: z.number().int().positive(),
  status: z.enum([
    "QUEUED",
    "CALCULATING",
    "GENERATED",
    "REVIEWED",
    "LOCKED",
    "FAILED",
    "CANCELLED",
  ]),
  rateResolutionMode: z.enum(["BY_SHIFT_START", "PINNED_VERSION"]),
  rateVersionCodes: z.array(z.string()),
  sourceCutoffAt: z.string(),
  sourceRowCount: z.number().int().nonnegative(),
  pinCount: z.number().int().nonnegative(),
  blockingExceptionCount: z.number().int().nonnegative(),
  runVersion: z.number().int().positive(),
  createdAt: z.string(),
  generatedAt: z.string().nullable().optional(),
  reviewedAt: z.string().nullable().optional(),
  lockedAt: z.string().nullable().optional(),
  statusUrl: z.string(),
  failure: z.unknown().nullable().optional(),
});
const summarySchema = z.object({
  pin: z.string(),
  employeeName: z.string(),
  calculatedBasePay: z.string(),
  calculatedBonusPay: z.string(),
  basePay: z.string(),
  bonusPay: z.string(),
  attendanceAdjustment: z.string(),
  otherAdjustment: z.string(),
  totalPay: z.string(),
  workingDays: z.string(),
  workingHours: z.string(),
  overtimeHours: z.string(),
  hasOverride: z.boolean(),
  hasBlockingException: z.boolean(),
  rowVersion: z.number().int().positive(),
});
const hrisSyncSchema = z.object({
  syncId: z.string().uuid(),
  status: z.enum(["QUEUED", "SYNCING", "COMPLETED", "FAILED"]),
  progressPercent: z.number(),
  attendancePeriodId: z.string().uuid().nullable().optional(),
  hrisRevision: z.number().int().nullable().optional(),
  recordCount: z.number().int().nullable().optional(),
  checksum: z.string().nullable().optional(),
  statusUrl: z.string(),
  createdAt: z.string(),
  completedAt: z.string().nullable().optional(),
  failure: z
    .object({ error: z.object({ code: z.string(), message: z.string() }) })
    .passthrough()
    .nullable()
    .optional(),
});
const payrollRunListSchema = z.object({
  data: z.array(payrollRunSchema).max(500),
  page: cursorPageSchema,
});
const payrollPeriodListSchema = z.object({
  data: z.array(payrollPeriodSchema).max(500),
  page: cursorPageSchema,
});
const attendancePeriodListSchema = z.object({
  data: z.array(attendancePeriodSchema).max(500),
  page: cursorPageSchema,
});
const summaryListSchema = z.object({
  data: z.array(summarySchema).max(500),
  page: cursorPageSchema,
  aggregate: z.object({
    totalBasePay: z.string(),
    totalBonusPay: z.string(),
    totalPay: z.string(),
    totalWorkingDays: z.string(),
  }),
});
const overrideResultSchema = z.object({
  runVersion: z.number().int().positive(),
  updated: z.array(summarySchema),
  rejected: z.array(
    z.object({
      clientRowId: z.string(),
      fieldErrors: z.array(
        z.object({ field: z.string(), code: z.string(), message: z.string() }),
      ),
    }),
  ),
});

function contract<T>(schema: z.ZodType<unknown>, data: T): T {
  if (!schema.safeParse(data).success)
    throw new Error(
      "Respons backend Summary belum sesuai OpenAPI. Data tidak diterapkan.",
    );
  return data;
}

export interface PeriodFilter {
  periodStart: string;
  periodEnd: string;
  departmentCode: string;
}

export interface SummaryFilter {
  query: string;
  hasOverride?: boolean;
  hasBlockingException?: boolean;
  pageSize: number;
  after?: string;
}

export async function listPayrollPeriods(
  filter: PeriodFilter,
  signal?: AbortSignal,
) {
  const data = unwrapApiData(
    await apiClient.GET("/payroll-periods", {
      params: { query: { ...filter, pageSize: 100 } },
      ...(signal ? { signal } : {}),
    }),
  );
  return contract(payrollPeriodListSchema, data);
}

export async function listFinalAttendancePeriods(
  filter: PeriodFilter,
  signal?: AbortSignal,
) {
  const data = unwrapApiData(
    await apiClient.GET("/attendance-periods", {
      params: { query: { ...filter, status: "FINAL", pageSize: 100 } },
      ...(signal ? { signal } : {}),
    }),
  );
  return contract(attendancePeriodListSchema, data);
}

export async function listPayrollRuns(signal: AbortSignal, after?: string) {
  const data = unwrapApiData(
    await apiClient.GET("/payroll-runs", {
      params: { query: { pageSize: 25, ...(after ? { after } : {}) } },
      signal,
    }),
  );
  return contract(payrollRunListSchema, data);
}

/**
 * Just the fields the generate picker needs. Its own schema rather than an
 * import from the rates feature: features do not depend on each other.
 */
const rateVersionOptionSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  machineGroup: z.enum(["REGULAR", "CS", "SP"]),
  versionNo: z.number().int().positive(),
  effectiveFrom: z.string(),
  effectiveToExclusive: z.string().nullable().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "RETIRED"]),
});
const rateVersionOptionListSchema = z.object({
  data: z.array(rateVersionOptionSchema),
  page: z.object({
    hasNextPage: z.boolean(),
    nextCursor: z.string().nullable().optional(),
  }),
});
export type RateVersionOption = z.infer<typeof rateVersionOptionSchema>;

/**
 * Every version that generate accepts (ACTIVE and RETIRED — never DRAFT),
 * all pages. The list is short (a handful per machine group per year), and a
 * picker that silently drops page two would hide exactly the old versions a
 * re-price needs.
 */
export async function listSelectableRateVersions(signal?: AbortSignal) {
  const versions: RateVersionOption[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const data = unwrapApiData(
      await apiClient.GET("/pay-rate-versions", {
        params: { query: { pageSize: 50, ...(after ? { after } : {}) } },
        ...(signal ? { signal } : {}),
      }),
    );
    const parsed = contract(rateVersionOptionListSchema, data);
    versions.push(
      ...parsed.data.filter((version) => version.status !== "DRAFT"),
    );
    if (!parsed.page.hasNextPage || !parsed.page.nextCursor) break;
    after = parsed.page.nextCursor;
  }
  return versions;
}

export async function getPayrollRun(runId: string, signal?: AbortSignal) {
  const data = unwrapApiData(
    await apiClient.GET("/payroll-runs/{payrollRunId}", {
      params: { path: { payrollRunId: runId } },
      ...(signal ? { signal } : {}),
    }),
  );
  return contract(payrollRunSchema, data);
}

export async function listPayrollSummaries(
  runId: string,
  filter: SummaryFilter,
  signal?: AbortSignal,
) {
  const data = unwrapApiData(
    await apiClient.GET("/payroll-runs/{payrollRunId}/summaries", {
      params: {
        path: { payrollRunId: runId },
        query: {
          pageSize: filter.pageSize,
          ...(filter.query ? { query: filter.query } : {}),
          ...(filter.hasOverride === undefined
            ? {}
            : { hasOverride: filter.hasOverride }),
          ...(filter.hasBlockingException === undefined
            ? {}
            : { hasBlockingException: filter.hasBlockingException }),
          ...(filter.after ? { after: filter.after } : {}),
        },
      },
      ...(signal ? { signal } : {}),
    }),
  );
  return contract(summaryListSchema, data);
}

export interface IdempotentSummaryMutation<TBody> {
  key: string;
  body: TBody;
}

export async function createPayrollPeriod(
  attempt: IdempotentSummaryMutation<
    components["schemas"]["CreatePayrollPeriodRequest"]
  >,
  csrfToken: string,
) {
  const data = unwrapApiData(
    await apiClient.POST("/payroll-periods", {
      params: { header: { "Idempotency-Key": attempt.key } },
      headers: { "X-CSRF-Token": csrfToken },
      body: attempt.body,
    }),
  );
  return contract(payrollPeriodSchema, data);
}

export async function createHrisSync(
  attempt: IdempotentSummaryMutation<
    components["schemas"]["CreateHrisSyncRequest"]
  >,
  csrfToken: string,
) {
  const data = unwrapApiData(
    await apiClient.POST("/hris-syncs", {
      params: { header: { "Idempotency-Key": attempt.key } },
      headers: { "X-CSRF-Token": csrfToken },
      body: attempt.body,
    }),
  );
  return contract(hrisSyncSchema, data);
}

export async function getHrisSync(syncId: string, signal?: AbortSignal) {
  const data = unwrapApiData(
    await apiClient.GET("/hris-syncs/{syncId}", {
      params: { path: { syncId } },
      ...(signal ? { signal } : {}),
    }),
  );
  return contract(hrisSyncSchema, data);
}

export async function createPayrollRun(
  attempt: IdempotentSummaryMutation<
    components["schemas"]["CreatePayrollRunRequest"]
  >,
  csrfToken: string,
) {
  const data = unwrapApiData(
    await apiClient.POST("/payroll-runs", {
      params: { header: { "Idempotency-Key": attempt.key } },
      headers: { "X-CSRF-Token": csrfToken },
      body: attempt.body,
    }),
  );
  return contract(payrollRunSchema, data);
}

export async function savePayrollOverrides(
  runId: string,
  attempt: IdempotentSummaryMutation<
    components["schemas"]["PayrollOverrideBatchRequest"]
  >,
  csrfToken: string,
) {
  const data = unwrapApiData(
    await apiClient.POST("/payroll-runs/{payrollRunId}/override-batches", {
      params: {
        path: { payrollRunId: runId },
        header: { "Idempotency-Key": attempt.key },
      },
      headers: { "X-CSRF-Token": csrfToken },
      body: attempt.body,
    }),
  );
  return contract(overrideResultSchema, data);
}

async function transitionPayrollRun(
  endpoint: "reviews" | "locks",
  runId: string,
  attempt: IdempotentSummaryMutation<
    components["schemas"]["PayrollTransitionRequest"]
  >,
  csrfToken: string,
) {
  const request = {
    params: {
      path: { payrollRunId: runId },
      header: { "Idempotency-Key": attempt.key },
    },
    headers: { "X-CSRF-Token": csrfToken },
    body: attempt.body,
  } as const;
  const result =
    endpoint === "reviews"
      ? await apiClient.POST("/payroll-runs/{payrollRunId}/reviews", request)
      : await apiClient.POST("/payroll-runs/{payrollRunId}/locks", request);
  return contract(payrollRunSchema, unwrapApiData(result));
}

export const reviewPayrollRun = (
  runId: string,
  attempt: IdempotentSummaryMutation<
    components["schemas"]["PayrollTransitionRequest"]
  >,
  csrfToken: string,
) => transitionPayrollRun("reviews", runId, attempt, csrfToken);

export const lockPayrollRun = (
  runId: string,
  attempt: IdempotentSummaryMutation<
    components["schemas"]["PayrollTransitionRequest"]
  >,
  csrfToken: string,
) => transitionPayrollRun("locks", runId, attempt, csrfToken);

export type PayrollPeriod = components["schemas"]["PayrollPeriod"];
export type AttendancePeriod = components["schemas"]["AttendancePeriod"];
export type PayrollRun = components["schemas"]["PayrollRun"];
export type PayrollSummary = components["schemas"]["PayrollSummary"];
export type PayrollSummaryListResponse =
  components["schemas"]["PayrollSummaryListResponse"];

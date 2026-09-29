import { http, HttpResponse } from "msw";
import type { components } from "../../../api/generated/schema";

type PayrollRun = components["schemas"]["PayrollRun"];
type PayrollSummary = components["schemas"]["PayrollSummary"];

const period: components["schemas"]["PayrollPeriod"] = {
  id: "40000000-0000-4000-8000-000000000001",
  code: "LOOM-2026-09",
  periodStart: "2026-08-24",
  periodEnd: "2026-09-23",
  departmentCode: "LOOM",
  status: "OPEN",
  createdAt: "2026-08-24T07:00:00+07:00",
  closedAt: null,
};
const attendance: components["schemas"]["AttendancePeriod"] = {
  id: "50000000-0000-4000-8000-000000000001",
  periodStart: period.periodStart,
  periodEnd: period.periodEnd,
  departmentCode: "LOOM",
  hrisRevision: 3,
  status: "FINAL",
  finalizedAt: "2026-09-24T08:00:00+07:00",
  finalizedBy: "HRD Demo",
  checksum: "demo-attendance-final-r3",
  recordCount: 288,
  syncedAt: "2026-09-24T08:02:00+07:00",
};
const initialRun: PayrollRun = {
  id: "60000000-0000-4000-8000-000000000001",
  periodId: period.id,
  attendancePeriodId: attendance.id,
  runNo: 1,
  status: "GENERATED",
  rateResolutionMode: "BY_SHIFT_START",
  rateVersionCodes: ["HB-CS-2026-V2"],
  sourceCutoffAt: "2026-09-24T08:05:00+07:00",
  sourceRowCount: 4568,
  pinCount: 12,
  blockingExceptionCount: 1,
  runVersion: 1,
  createdAt: "2026-09-24T08:05:00+07:00",
  generatedAt: "2026-09-24T08:06:00+07:00",
  reviewedAt: null,
  lockedAt: null,
  statusUrl: "/api/v1/payroll-runs/60000000-0000-4000-8000-000000000001",
  failure: null,
};

const names = [
  "Komariyah",
  "Mokhamad Imam Gozali",
  "Khalimatus Sadiyah",
  "Kurniawati",
  "Saiful Khoirul Anam",
  "Sutri",
  "Arip Lukman",
  "Abdul Somad",
  "Fauni Ernawati Ningsih",
  "Slamet Fitria",
  "Lilis Susana",
  "Pujianto",
];
const summaries = new Map<string, PayrollSummary>();
names.forEach((employeeName, index) => {
  const basePay = String(3_650_000 + index * 47_825);
  const bonusPay = index % 4 === 0 ? String(index * 325) : "0";
  const attendanceAdjustment = index === 3 ? "-75000" : "0";
  summaries.set(String(1500 + index), {
    pin: String(1500 + index),
    employeeName,
    calculatedBasePay: basePay,
    calculatedBonusPay: bonusPay,
    basePay,
    bonusPay,
    attendanceAdjustment,
    otherAdjustment: "0",
    totalPay: String(
      BigInt(basePay) + BigInt(bonusPay) + BigInt(attendanceAdjustment),
    ),
    workingDays: index === 3 ? "23" : "25",
    workingHours: index === 3 ? "184" : "200",
    overtimeHours: index % 3 === 0 ? "4" : "0",
    hasOverride: false,
    hasBlockingException: index === 3,
    rowVersion: 1,
  });
});

const runs = new Map<string, PayrollRun>([[initialRun.id, initialRun]]);
const pollCounts = new Map<string, number>();

function page(pageSize: number, count: number, offset: number) {
  const hasNextPage = offset + pageSize < count;
  return {
    pageSize,
    hasNextPage,
    nextCursor: hasNextPage ? String(offset + pageSize) : null,
  };
}

function sum(field: "basePay" | "bonusPay" | "totalPay") {
  return String(
    [...summaries.values()].reduce(
      (total, row) => total + BigInt(row[field]),
      0n,
    ),
  );
}

function fail(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status });
}

function validMutation(request: Request) {
  return (
    Boolean(request.headers.get("Idempotency-Key")) &&
    request.headers.get("X-CSRF-Token") === "demo-only-not-a-real-token"
  );
}

async function transitionRun(
  runId: string,
  transition: "reviews" | "locks",
  request: Request,
) {
  if (!validMutation(request))
    return fail(403, "MUTATION_FORBIDDEN", "Header mutasi demo tidak valid.");
  const run = runs.get(runId);
  if (!run) return fail(404, "NOT_FOUND", "Payroll run tidak ditemukan.");
  const body =
    (await request.json()) as components["schemas"]["PayrollTransitionRequest"];
  if (body.expectedRunVersion !== run.runVersion)
    return fail(409, "RUN_VERSION_CONFLICT", "Payroll sudah berubah.");
  if (transition === "locks" && run.blockingExceptionCount > 0)
    return fail(
      422,
      "BLOCKING_EXCEPTION_OPEN",
      "Selesaikan exception blocking sebelum lock.",
    );
  const next: PayrollRun = {
    ...run,
    status: transition === "reviews" ? "REVIEWED" : "LOCKED",
    runVersion: run.runVersion + 1,
    ...(transition === "reviews"
      ? { reviewedAt: new Date().toISOString() }
      : { lockedAt: new Date().toISOString() }),
  };
  runs.set(run.id, next);
  return HttpResponse.json(next);
}

const HRIS_SYNC_ID = "70000000-0000-4000-8000-000000000001";

function hrisSync(
  status: components["schemas"]["HrisSync"]["status"],
): components["schemas"]["HrisSync"] {
  const completed = status === "COMPLETED";
  return {
    syncId: HRIS_SYNC_ID,
    status,
    progressPercent: completed ? 100 : 0,
    attendancePeriodId: completed ? attendance.id : null,
    hrisRevision: completed ? attendance.hrisRevision : null,
    recordCount: completed ? attendance.recordCount : null,
    checksum: completed ? attendance.checksum : null,
    statusUrl: `/api/v1/hris-syncs/${HRIS_SYNC_ID}`,
    createdAt: "2026-09-24T08:01:00+07:00",
    completedAt: completed ? "2026-09-24T08:02:00+07:00" : null,
    failure: null,
  };
}

export const summaryHandlers = [
  http.get("*/payroll-periods", ({ request }) => {
    const query = new URL(request.url).searchParams;
    const match =
      (!query.get("periodStart") ||
        query.get("periodStart") === period.periodStart) &&
      (!query.get("periodEnd") ||
        query.get("periodEnd") === period.periodEnd) &&
      (!query.get("departmentCode") ||
        query.get("departmentCode") === period.departmentCode);
    return HttpResponse.json({
      data: match ? [period] : [],
      page: page(100, match ? 1 : 0, 0),
    } satisfies components["schemas"]["PayrollPeriodListResponse"]);
  }),
  http.post("*/payroll-periods", async ({ request }) => {
    if (!validMutation(request))
      return fail(403, "MUTATION_FORBIDDEN", "Header mutasi demo tidak valid.");
    return HttpResponse.json(period, { status: 201 });
  }),
  http.get("*/attendance-periods", ({ request }) => {
    const query = new URL(request.url).searchParams;
    const match =
      query.get("status") === "FINAL" &&
      query.get("periodStart") === attendance.periodStart &&
      query.get("periodEnd") === attendance.periodEnd &&
      query.get("departmentCode") === attendance.departmentCode;
    return HttpResponse.json({
      data: match ? [attendance] : [],
      page: page(100, match ? 1 : 0, 0),
    } satisfies components["schemas"]["AttendancePeriodListResponse"]);
  }),
  http.post("*/hris-syncs", ({ request }) => {
    if (!validMutation(request))
      return fail(403, "MUTATION_FORBIDDEN", "Header mutasi demo tidak valid.");
    return HttpResponse.json(hrisSync("QUEUED"), { status: 202 });
  }),
  http.get("*/hris-syncs/:syncId", () =>
    HttpResponse.json(hrisSync("COMPLETED")),
  ),
  http.get("*/payroll-runs", ({ request }) => {
    const query = new URL(request.url).searchParams;
    const size = Math.min(500, Number(query.get("pageSize")) || 25);
    const offset = Number(query.get("after")) || 0;
    const all = [...runs.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    return HttpResponse.json({
      data: all.slice(offset, offset + size),
      page: page(size, all.length, offset),
    } satisfies components["schemas"]["PayrollRunListResponse"]);
  }),
  http.post("*/payroll-runs", async ({ request }) => {
    if (!validMutation(request))
      return fail(403, "MUTATION_FORBIDDEN", "Header mutasi demo tidak valid.");
    const body = (await request.json()) as { attendancePeriodId?: string };
    if (body.attendancePeriodId !== attendance.id)
      return fail(
        422,
        "ATTENDANCE_NOT_FINAL",
        "Attendance FINAL belum tersedia.",
      );
    const id = crypto.randomUUID();
    const run: PayrollRun = {
      ...initialRun,
      id,
      runNo: runs.size + 1,
      status: "QUEUED",
      rateVersionCodes: [],
      sourceRowCount: 0,
      pinCount: 0,
      blockingExceptionCount: 0,
      runVersion: 1,
      createdAt: new Date().toISOString(),
      generatedAt: null,
      statusUrl: `/api/v1/payroll-runs/${id}`,
    };
    runs.set(id, run);
    pollCounts.set(id, 0);
    return HttpResponse.json(run, { status: 202 });
  }),
  http.get("*/payroll-runs/:runId", ({ params }) => {
    const id = String(params.runId);
    const run = runs.get(id);
    if (!run) return fail(404, "NOT_FOUND", "Payroll run tidak ditemukan.");
    if (run.status === "QUEUED" || run.status === "CALCULATING") {
      const polls = (pollCounts.get(id) ?? 0) + 1;
      pollCounts.set(id, polls);
      const next: PayrollRun = {
        ...run,
        status: polls < 2 ? "CALCULATING" : "GENERATED",
        sourceRowCount: polls < 2 ? 0 : initialRun.sourceRowCount,
        pinCount: polls < 2 ? 0 : summaries.size,
        blockingExceptionCount: polls < 2 ? 0 : 1,
        rateVersionCodes: polls < 2 ? [] : initialRun.rateVersionCodes,
        generatedAt: polls < 2 ? null : new Date().toISOString(),
        runVersion: polls < 2 ? run.runVersion : run.runVersion + 1,
      };
      runs.set(id, next);
      return HttpResponse.json(next);
    }
    return HttpResponse.json(run);
  }),
  http.get("*/payroll-runs/:runId/summaries", ({ params, request }) => {
    if (!runs.has(String(params.runId)))
      return fail(404, "NOT_FOUND", "Payroll run tidak ditemukan.");
    const query = new URL(request.url).searchParams;
    const search = query.get("query")?.toLowerCase() ?? "";
    const hasOverride = query.get("hasOverride");
    const hasBlocking = query.get("hasBlockingException");
    const size = Math.min(500, Number(query.get("pageSize")) || 100);
    const offset = Number(query.get("after")) || 0;
    const data = [...summaries.values()].filter(
      (row) =>
        (!search ||
          `${row.pin} ${row.employeeName}`.toLowerCase().includes(search)) &&
        (hasOverride === null || String(row.hasOverride) === hasOverride) &&
        (hasBlocking === null ||
          String(row.hasBlockingException) === hasBlocking),
    );
    return HttpResponse.json({
      data: data.slice(offset, offset + size),
      page: page(size, data.length, offset),
      aggregate: {
        totalBasePay: sum("basePay"),
        totalBonusPay: sum("bonusPay"),
        totalPay: sum("totalPay"),
        totalWorkingDays: String(
          [...summaries.values()].reduce(
            (total, row) => total + BigInt(row.workingDays),
            0n,
          ),
        ),
      },
    } satisfies components["schemas"]["PayrollSummaryListResponse"]);
  }),
  http.post(
    "*/payroll-runs/:runId/override-batches",
    async ({ params, request }) => {
      if (!validMutation(request))
        return fail(
          403,
          "MUTATION_FORBIDDEN",
          "Header mutasi demo tidak valid.",
        );
      const run = runs.get(String(params.runId));
      if (!run) return fail(404, "NOT_FOUND", "Payroll run tidak ditemukan.");
      if (run.status !== "GENERATED")
        return fail(409, "PAYROLL_NOT_EDITABLE", "Payroll tidak dapat diedit.");
      const body =
        (await request.json()) as components["schemas"]["PayrollOverrideBatchRequest"];
      if (body.expectedRunVersion !== run.runVersion)
        return fail(409, "RUN_VERSION_CONFLICT", "Payroll sudah berubah.");
      const updated: PayrollSummary[] = [];
      for (const input of body.rows) {
        const row = summaries.get(input.pin);
        if (!row || row.rowVersion !== input.expectedRowVersion) continue;
        const next = {
          ...row,
          ...(input.basePay === undefined ? {} : { basePay: input.basePay }),
          ...(input.bonusPay === undefined ? {} : { bonusPay: input.bonusPay }),
          hasOverride: true,
          rowVersion: row.rowVersion + 1,
        };
        next.totalPay = String(
          BigInt(next.basePay) +
            BigInt(next.bonusPay) +
            BigInt(next.attendanceAdjustment) +
            BigInt(next.otherAdjustment),
        );
        summaries.set(next.pin, next);
        updated.push(next);
      }
      const nextRun = { ...run, runVersion: run.runVersion + 1 };
      runs.set(run.id, nextRun);
      return HttpResponse.json({
        runVersion: nextRun.runVersion,
        updated,
        rejected: [],
      } satisfies components["schemas"]["PayrollOverrideBatchResult"]);
    },
  ),
  http.post("*/payroll-runs/:runId/reviews", ({ params, request }) =>
    transitionRun(String(params.runId), "reviews", request),
  ),
  http.post("*/payroll-runs/:runId/locks", ({ params, request }) =>
    transitionRun(String(params.runId), "locks", request),
  ),
];

import { http, HttpResponse } from "msw";
import { z } from "zod";
import type { components } from "../../../api/generated/schema";

type Entry = components["schemas"]["ProductionEntry"];
type Result = components["schemas"]["ProductionEntryBatchResult"];
const date = "2026-09-11T07:00:00+07:00";
const employees: components["schemas"]["Employee"][] = [
  "Operator Contoh A",
  "Operator Contoh B",
  "Operator Contoh C",
  "Operator Contoh D",
].map((fullName, index) => ({
  pin: String(9001 + index),
  fullName,
  employmentStatus: "ACTIVE",
  updatedAt: date,
}));
const records = new Map<string, Entry>();
for (let index = 0; index < 12; index++) {
  const id = crypto.randomUUID();
  records.set(id, {
    id,
    shiftStart: date,
    shiftEnd: "2026-09-11T15:00:00+07:00",
    stationNo: index + 1,
    pin: String(9001 + Math.floor(index / 3)),
    widthCm: "56",
    weftDensity: "10",
    resultMeter: String(850 + index * 11),
    rowVersion: 1,
    sourceType: "MANUAL",
    status: "ACTIVE",
    createdAt: date,
    updatedAt: date,
  });
}
const history = new Map<string, { payload: string; result: Result }>();
const voidHistory = new Map<string, { payload: string; result: Entry }>();
let revision = 1;
const schema = z.object({
  rows: z
    .array(
      z.object({
        clientRowId: z.string(),
        shiftStart: z.string(),
        shiftEnd: z.string(),
        stationNo: z.number().int().positive(),
        pin: z.string(),
        widthCm: z.string(),
        weftDensity: z.string(),
        resultMeter: z.string(),
        expectedRowVersion: z.number().nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
});
const voidSchema = z.object({
  expectedRowVersion: z.number().int().positive(),
  reason: z.string().trim().min(5).max(500),
});
const fail = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status });

/** Development only: imported by the MSW worker, never enabled implicitly. */
export const manualDataHandlers = [
  http.post("*/auth/logout", () =>
    HttpResponse.json({
      success: true,
    } satisfies components["schemas"]["LogoutResponse"]),
  ),
  http.get("*/auth/session", () =>
    HttpResponse.json({
      user: {
        userId: "10000000-0000-4000-8000-000000000001",
        hrisUserId: 1,
        email: "demo",
        displayName: "Admin Demo",
      },
      permissions: [
        "bag.production.read",
        "bag.production.write",
        "bag.employees.read",
        "bag.rates.read",
        "bag.rates.write",
        "bag.rates.approve",
        "bag.attendance.read",
        "bag.payroll.read",
        "bag.payroll.generate",
        "bag.payroll.override",
        "bag.payroll.review",
        "bag.payroll.lock",
      ],
      roles: ["DEMO"],
      isSuperAdmin: false,
      expiresAt: "2099-01-01T00:00:00Z",
      csrfToken: "demo-only-not-a-real-token",
    }),
  ),
  http.get("*/production-entries", ({ request }) => {
    const query = new URL(request.url).searchParams;
    const size = Math.min(
      500,
      Math.max(1, Number(query.get("pageSize")) || 100),
    );
    const offset = Number(query.get("after")) || 0;
    const start = Date.parse(query.get("startAt") ?? "");
    const end = Date.parse(query.get("endAt") ?? "");
    const search = query.get("query")?.toLowerCase() ?? "";
    const status = query.get("status");
    const all = [...records.values()]
      .filter(
        (row) =>
          (!status || row.status === status) &&
          (!Number.isFinite(start) || Date.parse(row.shiftStart) >= start) &&
          (!Number.isFinite(end) || Date.parse(row.shiftStart) <= end) &&
          (!search || `${row.pin} ${row.stationNo}`.includes(search)),
      )
      .sort((a, b) => a.stationNo - b.stationNo);
    const data = all.slice(offset, offset + size);
    const hasNextPage = offset + size < all.length;
    return HttpResponse.json({
      data,
      sourceRevision: String(revision),
      page: {
        pageSize: size,
        hasNextPage,
        nextCursor: hasNextPage ? String(offset + size) : null,
      },
    } satisfies components["schemas"]["ProductionEntryListResponse"]);
  }),
  http.get("*/production-entries/:id", ({ params }) => {
    const row = records.get(String(params.id));
    return row
      ? HttpResponse.json(row)
      : fail(404, "NOT_FOUND", "Data contoh tidak ditemukan.");
  }),
  http.get("*/employees", ({ request }) => {
    const search =
      new URL(request.url).searchParams.get("query")?.toLowerCase() ?? "";
    return HttpResponse.json({
      data: employees.filter((employee) =>
        `${employee.fullName} ${employee.pin}`.toLowerCase().includes(search),
      ),
      page: { pageSize: 20, hasNextPage: false, nextCursor: null },
    } satisfies components["schemas"]["EmployeeListResponse"]);
  }),
  http.get("*/employees/:pin", ({ params }) => {
    const employee = employees.find((employee) => employee.pin === params.pin);
    return employee
      ? HttpResponse.json(employee)
      : fail(404, "NOT_FOUND", "PIN tidak ditemukan di direktori contoh.");
  }),
  http.post("*/production-entry-batches", async ({ request }) => {
    const key = request.headers.get("Idempotency-Key");
    if (!key)
      return fail(400, "IDEMPOTENCY_REQUIRED", "Idempotency key wajib diisi.");
    if (request.headers.get("X-CSRF-Token") !== "demo-only-not-a-real-token")
      return fail(403, "CSRF_INVALID", "CSRF demo tidak cocok.");
    const raw: unknown = await request.json();
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
      return fail(422, "VALIDATION_ERROR", "Payload batch tidak valid.");
    const payload = JSON.stringify(raw);
    const previous = history.get(key);
    if (previous)
      return previous.payload === payload
        ? HttpResponse.json(previous.result)
        : fail(409, "IDEMPOTENCY_CONFLICT", "Payload retry berbeda.");
    const result: Result = {
      batchId: crypto.randomUUID(),
      sourceRevision: String(++revision),
      counts: { inserted: 0, updated: 0, unchanged: 0, rejected: 0 },
      rows: [],
    };
    for (const input of parsed.data.rows) {
      const existing = [...records.values()].find(
        (row) =>
          row.shiftStart === input.shiftStart &&
          row.shiftEnd === input.shiftEnd &&
          row.stationNo === input.stationNo,
      );
      const code = !employees.some((employee) => employee.pin === input.pin)
        ? "PIN_NOT_FOUND"
        : existing && existing.rowVersion !== input.expectedRowVersion
          ? "ROW_VERSION_CONFLICT"
          : undefined;
      if (code) {
        result.counts.rejected++;
        result.rows.push({
          clientRowId: input.clientRowId,
          outcome: "REJECTED",
          fieldErrors: [
            {
              field: code === "PIN_NOT_FOUND" ? "pin" : "expectedRowVersion",
              code,
              message:
                code === "PIN_NOT_FOUND"
                  ? "PIN tidak ditemukan."
                  : "Versi baris berubah. Bandingkan dengan server.",
            },
          ],
        });
        continue;
      }
      const row: Entry = {
        ...input,
        id: existing?.id ?? crypto.randomUUID(),
        rowVersion: (existing?.rowVersion ?? 0) + 1,
        sourceType: existing?.sourceType ?? "MANUAL",
        status: "ACTIVE",
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      records.set(row.id, row);
      result.counts[existing ? "updated" : "inserted"]++;
      result.rows.push({
        clientRowId: input.clientRowId,
        productionEntryId: row.id,
        rowVersion: row.rowVersion,
        outcome: existing ? "UPDATED" : "INSERTED",
      });
    }
    history.set(key, { payload, result });
    return HttpResponse.json(result);
  }),
  http.post("*/production-entries/:id/voids", async ({ params, request }) => {
    const key = request.headers.get("Idempotency-Key");
    if (!key)
      return fail(400, "IDEMPOTENCY_REQUIRED", "Idempotency key wajib diisi.");
    if (request.headers.get("X-CSRF-Token") !== "demo-only-not-a-real-token")
      return fail(403, "CSRF_INVALID", "CSRF demo tidak cocok.");
    const raw: unknown = await request.json();
    const parsed = voidSchema.safeParse(raw);
    if (!parsed.success)
      return fail(422, "VALIDATION_ERROR", "Alasan pembatalan tidak valid.");
    const payload = JSON.stringify(raw);
    const previous = voidHistory.get(key);
    if (previous)
      return previous.payload === payload
        ? HttpResponse.json(previous.result)
        : fail(409, "IDEMPOTENCY_CONFLICT", "Payload retry berbeda.");
    const existing = records.get(String(params.id));
    if (!existing)
      return fail(404, "NOT_FOUND", "Data contoh tidak ditemukan.");
    if (existing.rowVersion !== parsed.data.expectedRowVersion)
      return fail(
        409,
        "ROW_VERSION_CONFLICT",
        "Versi baris berubah. Muat ulang data sebelum membatalkan.",
      );
    const result: Entry = {
      ...existing,
      status: "VOID",
      rowVersion: existing.rowVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    records.set(result.id, result);
    revision++;
    voidHistory.set(key, { payload, result });
    return HttpResponse.json(result);
  }),
];

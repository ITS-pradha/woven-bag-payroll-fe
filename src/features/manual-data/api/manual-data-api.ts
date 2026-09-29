import { z } from "zod";
import { apiClient } from "../../../api/client/api-client";
import { unwrapApiData } from "../../../api/client/api-result";
import type { components } from "../../../api/generated/schema";
import { env } from "../../../config/env";

const page = z.object({
  pageSize: z.number().int().min(1).max(500),
  hasNextPage: z.boolean(),
  nextCursor: z.string().nullable(),
});
const employee = z.object({
  pin: z.string(),
  fullName: z.string(),
  employmentStatus: z.enum(["ACTIVE", "INACTIVE", "RESIGNED"]),
  updatedAt: z.string(),
  departmentCode: z.string().nullable().optional(),
});
const entry: z.ZodType<components["schemas"]["ProductionEntry"]> = z.object({
  id: z.string().uuid(),
  shiftStart: z.string(),
  shiftEnd: z.string(),
  stationNo: z.number().int(),
  pin: z.string(),
  widthCm: z.string(),
  weftDensity: z.string(),
  resultMeter: z.string(),
  sourceType: z.enum(["MANUAL", "LDMS"]),
  status: z.enum(["ACTIVE", "VOID"]),
  rowVersion: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const list: z.ZodType<components["schemas"]["ProductionEntryListResponse"]> =
  z.object({ data: z.array(entry).max(500), page, sourceRevision: z.string() });
const batch = z.object({
  batchId: z.string().uuid(),
  sourceRevision: z.string(),
  counts: z.object({
    inserted: z.number(),
    updated: z.number(),
    unchanged: z.number(),
    rejected: z.number(),
  }),
  rows: z.array(
    z.object({
      clientRowId: z.string(),
      outcome: z.enum(["INSERTED", "UPDATED", "UNCHANGED", "REJECTED"]),
      productionEntryId: z.string().uuid().nullable().optional(),
      rowVersion: z.number().nullable().optional(),
      fieldErrors: z
        .array(
          z.object({
            field: z.string(),
            code: z.string(),
            message: z.string(),
            clientRowId: z.string().nullable().optional(),
          }),
        )
        .optional(),
    }),
  ),
});

function contract<T>(schema: z.ZodType, data: T): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new Error(
      "Respons backend belum sesuai OpenAPI. Data tidak diterapkan; minta backend menyelaraskan kontrak.",
    );
  return data;
}
/**
 * Buku periode — satu layar Manual Data = satu buku.
 *
 * Periodenya milik payroll (`payroll_periods`), bukan tabel kedua: dua
 * timeline yang bisa berbeda pendapat akan membuat produksi tutup sementara
 * payroll masih buka. Backend memakai buku yang sama untuk menolak tulis ke
 * periode yang sudah CLOSED, jadi apa yang dinonaktifkan layar ini persis apa
 * yang ditolak service — bukan dua aturan yang harus dijaga tetap sama.
 */
const payrollPeriod: z.ZodType<components["schemas"]["PayrollPeriod"]> =
  z.object({
    id: z.string().uuid(),
    code: z.string(),
    periodStart: z.string(),
    periodEnd: z.string(),
    departmentCode: z.string(),
    status: z.enum(["OPEN", "CLOSED"]),
    createdAt: z.string(),
    // `closedAt` sengaja tidak divalidasi: kontrak menandainya opsional, dan
    // di bawah `exactOptionalPropertyTypes` field opsional pada Zod
    // menghasilkan `| undefined` yang tidak dipunyai tipe generated. Pola yang
    // sama dipakai `entry` untuk field opsionalnya. Tidak ada layar yang
    // membacanya.
  });
export type PayrollPeriod = components["schemas"]["PayrollPeriod"];

export const PERIOD_PAGE_SIZE = 200;
/**
 * Hanya buku departemen produksi. `payroll_periods` juga memuat periode
 * departemen lain (Summary membuat periode `LOOM`), dan backend menilai baris
 * Manual Data terhadap buku departemen produksi saja — menampilkan buku lain
 * berarti menawarkan buku "Terbuka" yang Simpan-nya tetap ditolak.
 */
export async function listPeriods(signal: AbortSignal) {
  return contract(
    z.object({ data: z.array(payrollPeriod), page }),
    unwrapApiData(
      await apiClient.GET("/payroll-periods", {
        params: {
          query: {
            pageSize: PERIOD_PAGE_SIZE,
            departmentCode: env.VITE_PRODUCTION_DEPARTMENT_CODE,
          },
        },
        signal,
      }),
    ),
  );
}

export interface CreatePeriodAttempt {
  key: string;
  body: Omit<
    components["schemas"]["CreatePayrollPeriodRequest"],
    "departmentCode"
  >;
}

/** Departemen dipaku dari konfigurasi, tidak pernah dari isian pengguna. */
export async function createPeriod(
  attempt: CreatePeriodAttempt,
  csrfToken: string,
) {
  return contract(
    payrollPeriod,
    unwrapApiData(
      await apiClient.POST("/payroll-periods", {
        params: { header: { "Idempotency-Key": attempt.key } },
        headers: { "X-CSRF-Token": csrfToken },
        body: {
          ...attempt.body,
          departmentCode: env.VITE_PRODUCTION_DEPARTMENT_CODE,
        },
      }),
    ),
  );
}

export async function closePeriod(periodId: string, csrfToken: string) {
  const result = contract(
    payrollPeriod,
    unwrapApiData(
      await apiClient.POST("/payroll-periods/{payrollPeriodId}/closures", {
        params: { path: { payrollPeriodId: periodId } },
        headers: { "X-CSRF-Token": csrfToken },
      }),
    ),
  );
  if (result.status !== "CLOSED")
    throw new Error(
      "Respons tutup buku belum berstatus CLOSED. Status buku tidak diubah di layar.",
    );
  return result;
}

/**
 * Rentang yang dikirim ke `/production-entries` untuk sebuah buku.
 *
 * Batas periode inklusif di KEDUA sisi dan dinyatakan dalam hari bisnis
 * Asia/Jakarta — aturan yang sama dengan yang dipakai backend saat memilih
 * buku dari `shift_start`. Membacanya sebagai UTC akan menggeser tiap batas
 * tujuh jam dan membuang baris shift malam di hari pertama dan terakhir.
 */
export function periodRange(period: PayrollPeriod) {
  return {
    startAt: `${period.periodStart}T00:00:00+07:00`,
    // .999, bukan :59: backend menurunkan batas akhir `?periodId=` sampai
    // milidetik terakhir hari itu, dan shift yang mulai di detik terakhir
    // hari penutup tetap milik buku ini.
    endAt: `${period.periodEnd}T23:59:59.999+07:00`,
  };
}

export interface ProductionFilter {
  startAt: string;
  endAt: string;
  query: string;
  pageSize: number;
  after?: string;
}
export async function listProduction(
  filter: ProductionFilter,
  signal: AbortSignal,
) {
  return contract(
    list,
    unwrapApiData(
      await apiClient.GET("/production-entries", {
        params: { query: { ...filter, status: "ACTIVE" } },
        signal,
      }),
    ),
  );
}
/**
 * The reference directory shown beside the grid.
 *
 * Also feeds the "Ganti dengan…" search in the problem panel.
 *
 * - **Active employees only** (product-owner decision 2026-09-28): every
 *   employee list in this app shows only people who still work here, so a
 *   replacement is never picked from someone who has left. This is a LIST
 *   rule, not an identity rule — an EID or PIN typed or imported for a former
 *   employee still resolves through `/employee-lookups` and still saves,
 *   because they must be paid for the rolls they wove.
 * - **A larger window** than `searchEmployees`, because this is read as a
 *   list rather than picked from a dropdown.
 *
 * No cursor is passed: `HrisEmployeeDirectory.findMany` ignores it and slices
 * to `pageSize`, so `hasNextPage` can never be true. A "load more" here would
 * be a button that does nothing.
 */
export const DIRECTORY_PAGE_SIZE = 50;
export async function browseEmployees(query: string, signal: AbortSignal) {
  return contract(
    z.object({ data: z.array(employee), page }),
    unwrapApiData(
      await apiClient.GET("/employees", {
        params: {
          query: {
            query,
            employmentStatus: "ACTIVE",
            pageSize: DIRECTORY_PAGE_SIZE,
          },
        },
        signal,
      }),
    ),
  );
}
export async function searchEmployees(query: string, signal: AbortSignal) {
  return contract(
    z.object({ data: z.array(employee), page }),
    unwrapApiData(
      await apiClient.GET("/employees", {
        params: { query: { query, employmentStatus: "ACTIVE", pageSize: 20 } },
        signal,
      }),
    ),
  );
}
const employeeLookup = z.object({
  resolved: z.array(
    z.object({
      ref: z.string(),
      pin: z.string(),
      fullName: z.string(),
      employmentStatus: z.enum(["ACTIVE", "INACTIVE", "RESIGNED"]),
    }),
  ),
  unresolved: z.array(
    z.object({
      ref: z.string(),
      reason: z.enum(["NOT_FOUND", "AMBIGUOUS"]),
      candidatePins: z.array(z.string()).optional(),
    }),
  ),
});

export type EmployeeLookup = z.infer<typeof employeeLookup>;

/**
 * Resolves every assignee cell of a paste in ONE request.
 *
 * The previous shape asked `/employees/{pin}` once per distinct value, eight
 * at a time: importing a sheet with 40 operators meant 40 round trips. The
 * backend resolves the whole list against its own store first and only asks
 * HRIS about what it has never seen.
 *
 * POST for a read — the identities of a 500-row paste do not fit a query
 * string — so it needs the CSRF header like every other POST. The rule has no
 * exemption for safe methods, and it is worth more without one.
 */
export async function lookupEmployees(
  refs: string[],
  csrfToken: string,
  signal: AbortSignal,
) {
  return contract(
    employeeLookup,
    unwrapApiData(
      await apiClient.POST("/employee-lookups", {
        headers: { "X-CSRF-Token": csrfToken },
        body: { refs },
        signal,
      }),
    ),
  );
}

export async function getEmployee(pin: string, signal: AbortSignal) {
  return contract(
    employee,
    unwrapApiData(
      await apiClient.GET("/employees/{pin}", {
        params: { path: { pin } },
        signal,
      }),
    ),
  );
}
export async function getProduction(id: string) {
  return contract(
    entry,
    unwrapApiData(
      await apiClient.GET("/production-entries/{productionEntryId}", {
        params: { path: { productionEntryId: id } },
      }),
    ),
  );
}
export interface SaveAttempt {
  key: string;
  rows: components["schemas"]["ProductionEntryInput"][];
}
/**
 * Rows per request when the grid is saved.
 *
 * Two ceilings, and this has to clear both. The contract caps a batch at 10.000
 * rows (`ProductionEntryBatchRequest.maxItems`), and the endpoint's body limit
 * is 8 MiB — measured at 218 bytes for a typical row and 441 for the widest one
 * the schema permits, so 10.000 rows is 2,08 MiB typical and 4,21 MiB worst
 * case.
 *
 * Before this, Simpan sent EVERYTHING as one request. A grid holding 15.141
 * rows arrived as 3,15 MiB and Fastify's 1 MiB default answered
 * `FST_ERR_CTP_BODY_TOO_LARGE`; above 10.000 rows the contract would have
 * refused it anyway.
 *
 * 5.000 matches `IMPORT_BATCH_ROWS`, which the file-import stream already uses:
 * fewer round trips than a small batch, while a failure stays cheap to retry
 * and progress moves visibly.
 */
export const SAVE_BATCH_ROWS = 5_000;

/* Taken from `saveProduction`, not from `z.infer<typeof batch>`: the two differ
   under `exactOptionalPropertyTypes`, and the grid's `accept` wants this one. */
type BatchResult = Awaited<ReturnType<typeof saveProduction>>;

/**
 * Splits one save into requests, each with its own idempotency key.
 *
 * The keys are DERIVED from the attempt key, never random. Pressing "Ulangi
 * simpan yang sama" after a partial failure therefore re-sends identical keys
 * with identical payloads, so chunks that already landed replay their stored
 * response instead of being written a second time. Random keys per attempt
 * would turn a retry into a duplicate insert.
 */
export function saveChunks(
  attempt: SaveAttempt,
  size = SAVE_BATCH_ROWS,
): SaveAttempt[] {
  if (attempt.rows.length <= size) return [attempt];

  const chunks: SaveAttempt[] = [];
  for (let start = 0; start < attempt.rows.length; start += size) {
    chunks.push({
      key: `${attempt.key}-${start / size}`,
      rows: attempt.rows.slice(start, start + size),
    });
  }
  return chunks;
}

/** Counts add up; the LAST chunk's revision wins — it is the newest state. */
function mergeBatches(first: BatchResult, next: BatchResult): BatchResult {
  return {
    batchId: next.batchId,
    sourceRevision: next.sourceRevision,
    counts: {
      inserted: first.counts.inserted + next.counts.inserted,
      updated: first.counts.updated + next.counts.updated,
      unchanged: first.counts.unchanged + next.counts.unchanged,
      rejected: first.counts.rejected + next.counts.rejected,
    },
    rows: [...first.rows, ...next.rows],
  };
}

/**
 * Saves a whole grid, in requests the server will actually accept.
 *
 * Sequential, not parallel: each batch is one transaction, and concurrent
 * chunks would race on the `(shift_start, shift_end, station_no)` unique key
 * while multiplying the load on the same connection pool.
 */
export async function saveProductionBatched(
  attempt: SaveAttempt,
  csrfToken: string,
  onProgress?: (sent: number, total: number) => void,
) {
  if (attempt.rows.length <= SAVE_BATCH_ROWS) {
    return saveProduction(attempt, csrfToken);
  }

  let merged: BatchResult | null = null;
  let sent = 0;
  for (const chunk of saveChunks(attempt)) {
    const result = await saveProduction(chunk, csrfToken);
    merged = merged ? mergeBatches(merged, result) : result;
    sent += chunk.rows.length;
    onProgress?.(sent, attempt.rows.length);
  }

  // Unreachable: the early return above covers the empty and single-chunk case.
  if (!merged) throw new Error("Batch kosong.");
  return merged;
}

export async function saveProduction(attempt: SaveAttempt, csrfToken: string) {
  return contract(
    batch,
    unwrapApiData(
      await apiClient.POST("/production-entry-batches", {
        params: { header: { "Idempotency-Key": attempt.key } },
        headers: { "X-CSRF-Token": csrfToken },
        body: { rows: attempt.rows },
      }),
    ),
  );
}

export interface VoidAttempt {
  key: string;
  productionEntryId: string;
  body: components["schemas"]["VoidProductionEntryRequest"];
}

export async function voidProduction(attempt: VoidAttempt, csrfToken: string) {
  const result = contract(
    entry,
    unwrapApiData(
      await apiClient.POST("/production-entries/{productionEntryId}/voids", {
        params: {
          path: { productionEntryId: attempt.productionEntryId },
          header: { "Idempotency-Key": attempt.key },
        },
        headers: { "X-CSRF-Token": csrfToken },
        body: attempt.body,
      }),
    ),
  );
  if (result.status !== "VOID")
    throw new Error(
      "Respons pembatalan belum berstatus VOID. Data lokal tidak diubah.",
    );
  return result;
}

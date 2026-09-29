import { http, HttpResponse } from "msw";

import type { components } from "../../../api/generated/schema";

type RateVersion = components["schemas"]["RateVersion"];
type RateDetails = components["schemas"]["RateVersionWithRows"];
type RateRow = components["schemas"]["RateMatrixRow"];

const createdAt = "2026-08-19T04:39:30.000Z";
const currentRateData: ReadonlyArray<
  readonly [string, string, string, string, string]
> = [
  ["30", "39", "62.16", "67.23", "71.41"],
  ["40", "49", "62.16", "67.23", "71.41"],
  ["50", "59", "64.10", "69.42", "73.81"],
  ["60", "64", "65.15", "70.60", "75.11"],
  ["65", "69", "66.25", "71.85", "76.47"],
  ["70", "74", "71.30", "77.56", "82.72"],
  ["75", "79", "71.30", "77.56", "82.72"],
  ["80", "89", "77.71", "84.79", "90.64"],
];
const csRows: RateRow[] = currentRateData.map(
  ([widthFromCm, widthToCm, rate10, rate11, rate12]) => ({
    id: crypto.randomUUID(),
    rowVersion: 1,
    widthFromCm,
    widthToCm,
    variants: [
      {
        weftDensity: "10",
        threadWidth: "2.6",
        baseRatePerMeter: rate10,
        bonusRatePerMeter: null,
      },
      {
        weftDensity: "11",
        threadWidth: "2.3",
        baseRatePerMeter: rate11,
        bonusRatePerMeter: null,
      },
      {
        weftDensity: "12",
        threadWidth: "2.1",
        baseRatePerMeter: rate12,
        bonusRatePerMeter: null,
      },
    ],
  }),
);

const oldRateData: ReadonlyArray<readonly [string, string, string]> = [
  ["53.84", "58.91", "63.09"],
  ["53.84", "58.91", "63.09"],
  ["55.78", "61.10", "65.49"],
  ["56.83", "62.28", "66.79"],
  ["57.93", "63.53", "68.15"],
  ["62.98", "69.24", "74.40"],
  ["62.98", "69.24", "74.40"],
  ["69.39", "76.47", "82.32"],
];
const oldRows: RateRow[] = csRows.map((row, index) => ({
  ...row,
  id: crypto.randomUUID(),
  variants: row.variants.map((variant) => ({
    ...variant,
    baseRatePerMeter:
      oldRateData[index]?.[
        variant.weftDensity === "10" ? 0 : variant.weftDensity === "11" ? 1 : 2
      ] ?? "",
  })),
}));

const versions = new Map<string, RateDetails>();
const oldId = "10000000-0000-4000-8000-000000000100";
const activeId = "10000000-0000-4000-8000-000000000101";
versions.set(oldId, {
  id: oldId,
  scheduleCode: "LOOM_CS",
  versionNo: 1,
  code: "HB-CS-2021-V1",
  name: "Harga Borongan Lama",
  machineGroup: "CS",
  effectiveFrom: "2021-01-25",
  effectiveToExclusive: "2026-08-24",
  status: "RETIRED",
  bonusMultiplier: "1.2",
  roundingMode: "HALF_UP_AT_PIN_TOTAL",
  changeNote: "Tarif lama sebelum penyesuaian 2026.",
  rowVersion: 2,
  createdBy: "Admin Karung",
  createdAt,
  approvedBy: "Supervisor Karung",
  approvedAt: "2021-01-24T03:00:00.000Z",
  rows: oldRows,
});
versions.set(activeId, {
  id: activeId,
  scheduleCode: "LOOM_CS",
  versionNo: 2,
  code: "HB-CS-2026-V2",
  name: "Harga Borongan Loom 2026 V2",
  machineGroup: "CS",
  effectiveFrom: "2026-08-24",
  effectiveToExclusive: null,
  status: "ACTIVE",
  bonusMultiplier: "1.2",
  roundingMode: "HALF_UP_AT_PIN_TOTAL",
  changeNote:
    "Penyesuaian harga borongan berdasarkan persetujuan Agustus 2026.",
  rowVersion: 2,
  createdBy: "Admin Karung",
  createdAt,
  approvedBy: "Supervisor Karung",
  approvedAt: "2026-08-20T02:00:00.000Z",
  rows: csRows,
});

const fail = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status });
const validMutation = (request: Request) =>
  request.headers.get("Idempotency-Key") && request.headers.get("X-CSRF-Token");
const publicVersion = (details: RateDetails): RateVersion => {
  const { rows, ...version } = details;
  void rows;
  return version;
};

export const rateHandlers = [
  http.get("*/pay-rate-versions", ({ request }) => {
    const pageSize = Math.min(
      50,
      Math.max(
        1,
        Number(new URL(request.url).searchParams.get("pageSize")) || 50,
      ),
    );
    const data = [...versions.values()]
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
      .slice(0, pageSize)
      .map(publicVersion);
    return HttpResponse.json({
      data,
      page: { pageSize, hasNextPage: false, nextCursor: null },
    } satisfies components["schemas"]["RateVersionListResponse"]);
  }),
  http.post("*/pay-rate-versions", async ({ request }) => {
    if (!validMutation(request))
      return fail(403, "CSRF_INVALID", "Header mutasi belum lengkap.");
    const body =
      (await request.json()) as components["schemas"]["CreateRateVersionRequest"];
    const source = body.cloneFromRateVersionId
      ? versions.get(body.cloneFromRateVersionId)
      : undefined;
    const id = crypto.randomUUID();
    const details: RateDetails = {
      id,
      scheduleCode: body.scheduleCode,
      versionNo:
        Math.max(
          ...[...versions.values()].map((version) => version.versionNo),
        ) + 1,
      code: body.code,
      name: body.name,
      machineGroup: body.machineGroup,
      effectiveFrom: body.effectiveFrom,
      effectiveToExclusive: null,
      status: "DRAFT",
      bonusMultiplier: body.bonusMultiplier,
      roundingMode: body.roundingMode,
      changeNote: body.changeNote ?? null,
      rowVersion: 1,
      createdBy: "Admin Demo",
      createdAt: new Date().toISOString(),
      approvedBy: null,
      approvedAt: null,
      rows:
        source?.rows.map((row) => ({
          ...row,
          id: crypto.randomUUID(),
          rowVersion: 1,
        })) ?? [],
    };
    versions.set(id, details);
    return HttpResponse.json(publicVersion(details), { status: 201 });
  }),
  http.get("*/pay-rate-versions/:id", ({ params }) => {
    const details = versions.get(String(params.id));
    return details
      ? HttpResponse.json(details)
      : fail(404, "NOT_FOUND", "Versi harga tidak ditemukan.");
  }),
  http.patch("*/pay-rate-versions/:id", async ({ params, request }) => {
    const details = versions.get(String(params.id));
    if (!details) return fail(404, "NOT_FOUND", "Versi harga tidak ditemukan.");
    const body =
      (await request.json()) as components["schemas"]["UpdateRateVersionRequest"];
    if (
      details.status !== "DRAFT" &&
      body.effectiveFrom !== undefined &&
      body.effectiveFrom !== details.effectiveFrom
    )
      return fail(
        422,
        "RATE_VERSION_ACTIVE_START_DATE",
        "Tanggal mulai versi aktif tidak dapat diubah.",
      );
    if (body.expectedRowVersion !== details.rowVersion)
      return fail(409, "ROW_VERSION_CONFLICT", "Versi harga sudah berubah.");
    const updated: RateDetails = {
      ...details,
      ...body,
      rowVersion: details.rowVersion + 1,
    };
    versions.set(updated.id, updated);
    return HttpResponse.json(publicVersion(updated));
  }),
  http.post(
    "*/pay-rate-versions/:id/rate-batches",
    async ({ params, request }) => {
      if (!validMutation(request))
        return fail(403, "CSRF_INVALID", "Header mutasi belum lengkap.");
      const details = versions.get(String(params.id));
      if (!details)
        return fail(404, "NOT_FOUND", "Versi harga tidak ditemukan.");
      const body =
        (await request.json()) as components["schemas"]["RateBatchRequest"];
      if (body.expectedRowVersion !== details.rowVersion)
        return fail(409, "ROW_VERSION_CONFLICT", "Versi harga sudah berubah.");
      const updated: RateDetails = {
        ...details,
        rowVersion: details.rowVersion + 1,
        rows: body.rows.map((input) => {
          const { clientRowId, ...row } = input;
          void clientRowId;
          return { ...row, id: crypto.randomUUID(), rowVersion: 1 };
        }),
      };
      versions.set(updated.id, updated);
      return HttpResponse.json(updated);
    },
  ),
  http.post(
    "*/pay-rate-versions/:id/activations",
    async ({ params, request }) => {
      if (!validMutation(request))
        return fail(403, "CSRF_INVALID", "Header mutasi belum lengkap.");
      const details = versions.get(String(params.id));
      if (!details)
        return fail(404, "NOT_FOUND", "Versi harga tidak ditemukan.");
      const body =
        (await request.json()) as components["schemas"]["ActivateRateVersionRequest"];
      if (body.expectedRowVersion !== details.rowVersion)
        return fail(409, "ROW_VERSION_CONFLICT", "Versi harga sudah berubah.");
      for (const [id, version] of versions) {
        if (
          version.status === "ACTIVE" &&
          version.scheduleCode === details.scheduleCode
        )
          versions.set(id, {
            ...version,
            status: "RETIRED",
            effectiveToExclusive: details.effectiveFrom,
            rowVersion: version.rowVersion + 1,
          });
      }
      const active: RateDetails = {
        ...details,
        status: "ACTIVE",
        approvedBy: "Admin Demo",
        approvedAt: new Date().toISOString(),
        rowVersion: details.rowVersion + 1,
      };
      versions.set(active.id, active);
      return HttpResponse.json(active);
    },
  ),
];

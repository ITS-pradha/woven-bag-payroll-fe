import { http, HttpResponse } from "msw";

import type { components } from "../../../api/generated/schema";

type Policy = components["schemas"]["RateCalculationPolicy"];
type StationVersion = components["schemas"]["StationGroupVersionWithMappings"];

const activeRateId = "10000000-0000-4000-8000-000000000101";
const policy: Policy = {
  rateVersionId: activeRateId,
  rowVersion: 1,
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
  updatedBy: "Admin Demo",
  updatedAt: "2026-08-20T01:00:00.000Z",
};

const stationId = "40000000-0000-4000-8000-000000000101";
const stationVersions = new Map<string, StationVersion>([
  [
    stationId,
    {
      id: stationId,
      versionNo: 1,
      code: "LOOM-GROUP-2026-V1",
      name: "Mapping Mesin 2026",
      effectiveFrom: "2026-09-01",
      effectiveToExclusive: null,
      status: "DRAFT",
      changeNote: "Mapping awal kelompok mesin.",
      rowVersion: 1,
      createdBy: "Admin Demo",
      createdAt: "2026-08-20T01:00:00.000Z",
      approvedBy: null,
      approvedAt: null,
      mappings: [51, 52, 53].map((stationNo) => ({
        id: crypto.randomUUID(),
        rowVersion: 1,
        clientRowId: `station-${stationNo}`,
        stationNo,
        loomGroup: stationNo === 53 ? "CS" : "REGULAR",
      })),
    },
  ],
]);

const fail = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status });
const validMutation = (request: Request) =>
  request.headers.get("Idempotency-Key") && request.headers.get("X-CSRF-Token");
const publicStationVersion = (details: StationVersion) => {
  const { mappings, ...version } = details;
  void mappings;
  return version;
};

export const advancedRateHandlers = [
  http.get("*/pay-rate-versions/:id/calculation-policy", ({ params }) =>
    String(params.id) === activeRateId
      ? HttpResponse.json(policy)
      : fail(404, "NOT_FOUND", "Aturan kalkulasi belum dibuat."),
  ),
  http.put(
    "*/pay-rate-versions/:id/calculation-policy",
    async ({ params, request }) => {
      if (!validMutation(request))
        return fail(403, "CSRF_INVALID", "Header mutasi belum lengkap.");
      const body =
        (await request.json()) as components["schemas"]["ReplaceRateCalculationPolicyRequest"];
      return HttpResponse.json({
        ...body,
        rateVersionId: String(params.id),
        rowVersion: body.expectedRowVersion + 1,
        updatedBy: "Admin Demo",
        updatedAt: new Date().toISOString(),
      } satisfies Policy);
    },
  ),
  http.get("*/station-group-versions", () =>
    HttpResponse.json({
      data: [...stationVersions.values()].map(publicStationVersion),
      page: { pageSize: 50, hasNextPage: false, nextCursor: null },
    } satisfies components["schemas"]["StationGroupVersionListResponse"]),
  ),
  http.post("*/station-group-versions", async ({ request }) => {
    if (!validMutation(request))
      return fail(403, "CSRF_INVALID", "Header mutasi belum lengkap.");
    const body =
      (await request.json()) as components["schemas"]["CreateStationGroupVersionRequest"];
    const source = body.cloneFromStationGroupVersionId
      ? stationVersions.get(body.cloneFromStationGroupVersionId)
      : undefined;
    const id = crypto.randomUUID();
    const created: StationVersion = {
      id,
      versionNo: stationVersions.size + 1,
      code: body.code,
      name: body.name,
      effectiveFrom: body.effectiveFrom,
      effectiveToExclusive: null,
      status: "DRAFT",
      changeNote: body.changeNote ?? null,
      rowVersion: 1,
      createdBy: "Admin Demo",
      createdAt: new Date().toISOString(),
      approvedBy: null,
      approvedAt: null,
      mappings:
        source?.mappings.map((mapping) => ({
          ...mapping,
          id: crypto.randomUUID(),
          rowVersion: 1,
        })) ?? [],
    };
    stationVersions.set(id, created);
    return HttpResponse.json(publicStationVersion(created), { status: 201 });
  }),
  http.get("*/station-group-versions/:id", ({ params }) => {
    const version = stationVersions.get(String(params.id));
    return version
      ? HttpResponse.json(version)
      : fail(404, "NOT_FOUND", "Versi kelompok mesin tidak ditemukan.");
  }),
  http.post(
    "*/station-group-versions/:id/mapping-batches",
    async ({ params, request }) => {
      if (!validMutation(request))
        return fail(403, "CSRF_INVALID", "Header mutasi belum lengkap.");
      const current = stationVersions.get(String(params.id));
      if (!current)
        return fail(404, "NOT_FOUND", "Versi kelompok mesin tidak ditemukan.");
      const body =
        (await request.json()) as components["schemas"]["StationGroupMappingBatchRequest"];
      if (body.expectedRowVersion !== current.rowVersion)
        return fail(409, "ROW_VERSION_CONFLICT", "Versi sudah berubah.");
      const saved: StationVersion = {
        ...current,
        rowVersion: current.rowVersion + 1,
        mappings: body.mappings.map((mapping) => ({
          ...mapping,
          id: crypto.randomUUID(),
          rowVersion: 1,
        })),
      };
      stationVersions.set(saved.id, saved);
      return HttpResponse.json(saved);
    },
  ),
  http.post(
    "*/station-group-versions/:id/activations",
    async ({ params, request }) => {
      if (!validMutation(request))
        return fail(403, "CSRF_INVALID", "Header mutasi belum lengkap.");
      const current = stationVersions.get(String(params.id));
      if (!current)
        return fail(404, "NOT_FOUND", "Versi kelompok mesin tidak ditemukan.");
      const active: StationVersion = {
        ...current,
        status: "ACTIVE",
        rowVersion: current.rowVersion + 1,
        approvedBy: "Admin Demo",
        approvedAt: new Date().toISOString(),
      };
      stationVersions.set(active.id, active);
      return HttpResponse.json(active);
    },
  ),
];

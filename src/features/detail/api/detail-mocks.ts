import { http, HttpResponse } from "msw";
import type { components } from "../../../api/generated/schema";

const pin = "1500";
const summary: components["schemas"]["PayrollSummary"] = {
  pin,
  employeeName: "Komariyah",
  calculatedBasePay: "3650000",
  calculatedBonusPay: "0",
  basePay: "3650000",
  bonusPay: "0",
  attendanceAdjustment: "0",
  otherAdjustment: "0",
  totalPay: "3650000",
  workingDays: "25",
  workingHours: "200",
  overtimeHours: "4",
  hasOverride: false,
  hasBlockingException: false,
  rowVersion: 1,
};

const productionLines: components["schemas"]["PayrollProductionLine"][] = [
  {
    id: "70000000-0000-4000-8000-000000000001",
    productionEntryId: "71000000-0000-4000-8000-000000000001",
    productionRowVersion: 1,
    pin,
    stationNo: 1,
    sourceType: "MANUAL",
    shiftStart: "2026-08-24T07:00:00+07:00",
    shiftEnd: "2026-08-24T19:00:00+07:00",
    widthCm: "75",
    weftDensity: "9.7",
    resultMeter: "1052",
    durationHours: "12",
    targetMeter: "1328.22",
    payRatePerMeter: "55.36",
    calculatedBasePay: "58240",
    calculatedBonusPay: "0",
    calculatedTotalPay: "58240",
    appliedPayRateId: "72000000-0000-4000-8000-000000000001",
    rateVersionCode: "HB-CS-2026-V2",
    calculationTrace: {
      formula: "resultMeter × payRatePerMeter",
      resultMeter: "1052",
      payRatePerMeter: "55.36",
      roundedBasePay: "58240",
    },
  },
  {
    id: "70000000-0000-4000-8000-000000000002",
    productionEntryId: "71000000-0000-4000-8000-000000000002",
    productionRowVersion: 1,
    pin,
    stationNo: 2,
    sourceType: "LDMS",
    shiftStart: "2026-08-24T07:00:00+07:00",
    shiftEnd: "2026-08-24T19:00:00+07:00",
    widthCm: "59",
    weftDensity: "12.2",
    resultMeter: "1137",
    durationHours: "12",
    targetMeter: "1239.24",
    payRatePerMeter: "71.61",
    calculatedBasePay: "81422",
    calculatedBonusPay: "0",
    calculatedTotalPay: "81422",
    appliedPayRateId: "72000000-0000-4000-8000-000000000002",
    rateVersionCode: "HB-CS-2026-V2",
    calculationTrace: { formula: "1137 × 71.61" },
  },
];

const attendanceLines: components["schemas"]["PayrollAttendanceLine"][] = [
  {
    id: "80000000-0000-4000-8000-000000000001",
    hrisWorkDayId: "81000000-0000-4000-8000-000000000001",
    pin,
    workingDate: "2026-08-24",
    shiftCode: "SHIFT_1",
    workingDays: "1",
    workingHours: "8",
    overtimeHours: "0",
    attendanceStatus: "PRESENT",
    decisionReason: null,
  },
  {
    id: "80000000-0000-4000-8000-000000000002",
    hrisWorkDayId: "81000000-0000-4000-8000-000000000002",
    pin,
    workingDate: "2026-08-25",
    shiftCode: "SHIFT_1",
    workingDays: "0",
    workingHours: "0",
    overtimeHours: "0",
    attendanceStatus: "MISSING_FINGER",
    decisionReason: "Form gagal finger tidak dibuat sampai H+1",
  },
];

function page(pageSize: number) {
  return { pageSize, hasNextPage: false, nextCursor: null };
}

function notFound() {
  return HttpResponse.json(
    { error: { code: "NOT_FOUND", message: "Detail PIN tidak ditemukan." } },
    { status: 404 },
  );
}

export const detailHandlers = [
  http.get("*/payroll-runs/:runId/pins/:requestedPin", ({ params }) => {
    if (String(params.requestedPin) !== pin) return notFound();
    return HttpResponse.json({
      summary,
      productionLineCount: productionLines.length,
      attendanceLineCount: attendanceLines.length,
    } satisfies components["schemas"]["PayrollPinDetail"]);
  }),
  http.get(
    "*/payroll-runs/:runId/pins/:requestedPin/production-lines",
    ({ params, request }) => {
      if (String(params.requestedPin) !== pin) return notFound();
      const pageSize = Math.min(
        500,
        Number(new URL(request.url).searchParams.get("pageSize")) || 100,
      );
      return HttpResponse.json({
        data: productionLines,
        page: page(pageSize),
      } satisfies components["schemas"]["PayrollProductionLineListResponse"]);
    },
  ),
  http.get(
    "*/payroll-runs/:runId/pins/:requestedPin/attendance-lines",
    ({ params, request }) => {
      if (String(params.requestedPin) !== pin) return notFound();
      const pageSize = Math.min(
        500,
        Number(new URL(request.url).searchParams.get("pageSize")) || 100,
      );
      return HttpResponse.json({
        data: attendanceLines,
        page: page(pageSize),
      } satisfies components["schemas"]["PayrollAttendanceLineListResponse"]);
    },
  ),
];

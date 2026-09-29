import { z } from "zod";

const decimal = z.string().regex(/^\d+(?:\.\d+)?$/);
const money = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const page = z.object({
  pageSize: z.number().int().positive().max(500),
  hasNextPage: z.boolean(),
  nextCursor: z.string().nullable(),
});
const run = z.object({
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
const summary = z.object({
  pin: z.string().min(1),
  employeeName: z.string().min(1),
  calculatedBasePay: money,
  calculatedBonusPay: money,
  basePay: money,
  bonusPay: money,
  attendanceAdjustment: money,
  otherAdjustment: money,
  totalPay: money,
  workingDays: decimal,
  workingHours: decimal,
  overtimeHours: decimal,
  hasOverride: z.boolean(),
  hasBlockingException: z.boolean(),
  rowVersion: z.number().int().positive(),
});
const productionLine = z.object({
  id: z.string().uuid(),
  productionEntryId: z.string().uuid(),
  productionRowVersion: z.number().int().positive(),
  pin: z.string().min(1),
  stationNo: z.number().int().positive(),
  sourceType: z.enum(["MANUAL", "LDMS"]),
  shiftStart: z.string(),
  shiftEnd: z.string(),
  widthCm: decimal,
  weftDensity: decimal,
  resultMeter: decimal,
  durationHours: decimal,
  targetMeter: decimal,
  payRatePerMeter: decimal,
  calculatedBasePay: money,
  calculatedBonusPay: money,
  calculatedTotalPay: money,
  appliedPayRateId: z.string().uuid(),
  rateVersionCode: z.string(),
  calculationTrace: z.record(z.string(), z.unknown()),
});
const attendanceLine = z.object({
  id: z.string().uuid(),
  hrisWorkDayId: z.string().uuid(),
  pin: z.string().min(1),
  workingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shiftCode: z.string(),
  workingDays: decimal,
  workingHours: decimal,
  overtimeHours: decimal,
  attendanceStatus: z.string(),
  decisionReason: z.string().nullable().optional(),
});

export const runListContract = z.object({ data: z.array(run).max(500), page });
export const summaryListContract = z.object({
  data: z.array(summary).max(500),
  page,
  aggregate: z.object({
    totalBasePay: money,
    totalBonusPay: money,
    totalPay: money,
    totalWorkingDays: decimal,
  }),
});
export const pinDetailContract = z.object({
  summary,
  productionLineCount: z.number().int().nonnegative(),
  attendanceLineCount: z.number().int().nonnegative(),
});
export const productionLineListContract = z.object({
  data: z.array(productionLine).max(500),
  page,
});
export const attendanceLineListContract = z.object({
  data: z.array(attendanceLine).max(500),
  page,
});

export function enforceContract<T>(schema: z.ZodType<unknown>, data: T): T {
  if (!schema.safeParse(data).success)
    throw new Error(
      "Respons backend Detail belum sesuai OpenAPI. Data tidak diterapkan.",
    );
  return data;
}

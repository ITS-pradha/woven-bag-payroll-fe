import { queryOptions } from "@tanstack/react-query";

import {
  getPayrollPinDetail,
  listPayrollAttendanceLines,
  listPayrollProductionLines,
  searchPayrollEmployees,
} from "./detail-api";

export const detailQueryKey = ["payroll-detail"] as const;

export function payrollEmployeeSearchOptions(runId: string, query: string) {
  return queryOptions({
    queryKey: [...detailQueryKey, runId, "employees", query],
    queryFn: ({ signal }) => searchPayrollEmployees(runId, query, signal),
    enabled: Boolean(runId),
    staleTime: 30_000,
  });
}

export function payrollPinDetailOptions(runId: string, pin: string) {
  return queryOptions({
    queryKey: [...detailQueryKey, runId, pin, "header"],
    queryFn: ({ signal }) => getPayrollPinDetail(runId, pin, signal),
    enabled: Boolean(runId && pin),
  });
}

export function payrollProductionLinesOptions(
  runId: string,
  pin: string,
  after?: string,
) {
  return queryOptions({
    queryKey: [...detailQueryKey, runId, pin, "production", after ?? "first"],
    queryFn: ({ signal }) =>
      listPayrollProductionLines(runId, pin, after, signal),
    enabled: Boolean(runId && pin),
    placeholderData: (previous) => previous,
  });
}

export function payrollAttendanceLinesOptions(
  runId: string,
  pin: string,
  after?: string,
) {
  return queryOptions({
    queryKey: [...detailQueryKey, runId, pin, "attendance", after ?? "first"],
    queryFn: ({ signal }) =>
      listPayrollAttendanceLines(runId, pin, after, signal),
    enabled: Boolean(runId && pin),
    placeholderData: (previous) => previous,
  });
}

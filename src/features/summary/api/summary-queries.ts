import { queryOptions } from "@tanstack/react-query";

import {
  listPeriodBooks,
  getPayrollRun,
  listFinalAttendancePeriods,
  listPayrollSummaries,
  listSelectableRateVersions,
  type PeriodFilter,
  type SummaryFilter,
} from "./summary-api";

export const payrollRunsQueryKey = ["payroll-runs"] as const;

export function payrollRunQueryOptions(runId: string) {
  return queryOptions({
    queryKey: [...payrollRunsQueryKey, runId],
    queryFn: ({ signal }) => getPayrollRun(runId, signal),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "QUEUED" || status === "CALCULATING" ? 1_000 : false;
    },
  });
}

/** Prefiks `payroll-periods`: invalidasi dari Manual Data ikut menyegarkannya. */
export function periodBooksQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: ["payroll-periods", "books"],
    queryFn: ({ signal }) => listPeriodBooks(signal),
    enabled,
    staleTime: 60_000,
  });
}

export function finalAttendanceQueryOptions(filter: PeriodFilter) {
  return queryOptions({
    queryKey: ["attendance-periods", "FINAL", filter],
    queryFn: ({ signal }) => listFinalAttendancePeriods(filter, signal),
  });
}

export function payrollSummariesQueryOptions(
  runId: string,
  filter: SummaryFilter,
) {
  return queryOptions({
    queryKey: [...payrollRunsQueryKey, runId, "summaries", filter],
    queryFn: ({ signal }) => listPayrollSummaries(runId, filter, signal),
    enabled: Boolean(runId),
    placeholderData: (previous) => previous,
  });
}

export function selectableRateVersionsQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: ["pay-rate-versions", "selectable"],
    queryFn: ({ signal }) => listSelectableRateVersions(signal),
    enabled,
  });
}

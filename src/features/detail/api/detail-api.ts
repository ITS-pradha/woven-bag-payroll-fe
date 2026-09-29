import { apiClient } from "../../../api/client/api-client";
import { unwrapApiData } from "../../../api/client/api-result";
import type { components } from "../../../api/generated/schema";
import {
  attendanceLineListContract,
  enforceContract,
  pinDetailContract,
  productionLineListContract,
  runListContract,
  summaryListContract,
} from "./detail-contracts";

export async function listDetailPayrollRuns(
  signal: AbortSignal,
  after?: string,
) {
  const data = unwrapApiData(
    await apiClient.GET("/payroll-runs", {
      params: { query: { pageSize: 25, ...(after ? { after } : {}) } },
      signal,
    }),
  );
  return enforceContract(runListContract, data);
}

export async function searchPayrollEmployees(
  runId: string,
  query: string,
  signal?: AbortSignal,
) {
  const data = unwrapApiData(
    await apiClient.GET("/payroll-runs/{payrollRunId}/summaries", {
      params: {
        path: { payrollRunId: runId },
        query: { pageSize: 20, ...(query ? { query } : {}) },
      },
      ...(signal ? { signal } : {}),
    }),
  );
  return enforceContract(summaryListContract, data);
}

export async function getPayrollPinDetail(
  runId: string,
  pin: string,
  signal?: AbortSignal,
) {
  const data = unwrapApiData(
    await apiClient.GET("/payroll-runs/{payrollRunId}/pins/{pin}", {
      params: { path: { payrollRunId: runId, pin } },
      ...(signal ? { signal } : {}),
    }),
  );
  return enforceContract(pinDetailContract, data);
}

export async function listPayrollProductionLines(
  runId: string,
  pin: string,
  after?: string,
  signal?: AbortSignal,
) {
  const data = unwrapApiData(
    await apiClient.GET(
      "/payroll-runs/{payrollRunId}/pins/{pin}/production-lines",
      {
        params: {
          path: { payrollRunId: runId, pin },
          query: { pageSize: 100, ...(after ? { after } : {}) },
        },
        ...(signal ? { signal } : {}),
      },
    ),
  );
  return enforceContract(productionLineListContract, data);
}

export async function listPayrollAttendanceLines(
  runId: string,
  pin: string,
  after?: string,
  signal?: AbortSignal,
) {
  const data = unwrapApiData(
    await apiClient.GET(
      "/payroll-runs/{payrollRunId}/pins/{pin}/attendance-lines",
      {
        params: {
          path: { payrollRunId: runId, pin },
          query: { pageSize: 100, ...(after ? { after } : {}) },
        },
        ...(signal ? { signal } : {}),
      },
    ),
  );
  return enforceContract(attendanceLineListContract, data);
}

export type PayrollRun = components["schemas"]["PayrollRun"];
export type PayrollSummary = components["schemas"]["PayrollSummary"];
export type PayrollPinDetail = components["schemas"]["PayrollPinDetail"];
export type PayrollProductionLine =
  components["schemas"]["PayrollProductionLine"];
export type PayrollAttendanceLine =
  components["schemas"]["PayrollAttendanceLine"];

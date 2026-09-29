import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  payrollAttendanceLinesOptions,
  payrollPinDetailOptions,
  payrollProductionLinesOptions,
} from "../api/detail-queries";
import { AttendanceLinesTable } from "./attendance-lines-table";
import { DetailPagination } from "./detail-pagination";
import {
  DetailError,
  DetailLineState,
  DetailLoading,
  DetailTabButton,
} from "./detail-states";
import { DetailSummary } from "./detail-summary";
import { ProductionLinesTable } from "./production-lines-table";

export type DetailTab = "production" | "attendance";

export function DetailWorkspace({
  runId,
  pin,
  tab,
  onTabChange,
}: {
  runId: string;
  pin: string;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
}) {
  const [productionCursors, setProductionCursors] = useState<
    (string | undefined)[]
  >([undefined]);
  const [productionPage, setProductionPage] = useState(0);
  const [attendanceCursors, setAttendanceCursors] = useState<
    (string | undefined)[]
  >([undefined]);
  const [attendancePage, setAttendancePage] = useState(0);
  const detail = useQuery(payrollPinDetailOptions(runId, pin));
  const production = useQuery({
    ...payrollProductionLinesOptions(
      runId,
      pin,
      productionCursors[productionPage],
    ),
    enabled: tab === "production",
  });
  const attendance = useQuery({
    ...payrollAttendanceLinesOptions(
      runId,
      pin,
      attendanceCursors[attendancePage],
    ),
    enabled: tab === "attendance",
  });

  if (detail.isPending) return <DetailLoading />;
  if (detail.isError)
    return <DetailError onRetry={() => void detail.refetch()} />;

  const employeeName = detail.data.summary.employeeName;
  return (
    <div className="flex min-h-[calc(100vh-13rem)] flex-col gap-1.5">
      <DetailSummary detail={detail.data} />
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          role="tablist"
          aria-label="Jenis rincian payroll"
          className="flex border-b border-border bg-surface"
        >
          <DetailTabButton
            active={tab === "production"}
            controls="detail-production-panel"
            onClick={() => onTabChange("production")}
          >
            Produksi ({detail.data.productionLineCount})
          </DetailTabButton>
          <DetailTabButton
            active={tab === "attendance"}
            controls="detail-attendance-panel"
            onClick={() => onTabChange("attendance")}
          >
            Attendance ({detail.data.attendanceLineCount})
          </DetailTabButton>
        </div>
        {tab === "production" ? (
          <div
            id="detail-production-panel"
            role="tabpanel"
            aria-label="Produksi"
            className="flex min-h-0 flex-1 flex-col"
          >
            <DetailLineState
              pending={production.isPending}
              error={production.isError}
              empty={production.isSuccess && production.data.data.length === 0}
              onRetry={() => void production.refetch()}
            >
              {production.data ? (
                <>
                  <ProductionLinesTable
                    employeeName={employeeName}
                    rows={production.data.data}
                  />
                  <DetailPagination
                    pageIndex={productionPage}
                    hasNext={production.data.page.hasNextPage}
                    onPrevious={() =>
                      setProductionPage((current) => Math.max(0, current - 1))
                    }
                    onNext={() => {
                      const cursor = production.data.page.nextCursor;
                      if (!cursor) return;
                      setProductionCursors((current) => {
                        const next = current.slice();
                        next[productionPage + 1] = cursor;
                        return next;
                      });
                      setProductionPage((current) => current + 1);
                    }}
                  />
                </>
              ) : null}
            </DetailLineState>
          </div>
        ) : (
          <div
            id="detail-attendance-panel"
            role="tabpanel"
            aria-label="Attendance"
            className="flex min-h-0 flex-1 flex-col"
          >
            <DetailLineState
              pending={attendance.isPending}
              error={attendance.isError}
              empty={attendance.isSuccess && attendance.data.data.length === 0}
              onRetry={() => void attendance.refetch()}
            >
              {attendance.data ? (
                <>
                  <AttendanceLinesTable
                    employeeName={employeeName}
                    rows={attendance.data.data}
                  />
                  <DetailPagination
                    pageIndex={attendancePage}
                    hasNext={attendance.data.page.hasNextPage}
                    onPrevious={() =>
                      setAttendancePage((current) => Math.max(0, current - 1))
                    }
                    onNext={() => {
                      const cursor = attendance.data.page.nextCursor;
                      if (!cursor) return;
                      setAttendanceCursors((current) => {
                        const next = current.slice();
                        next[attendancePage + 1] = cursor;
                        return next;
                      });
                      setAttendancePage((current) => current + 1);
                    }}
                  />
                </>
              ) : null}
            </DetailLineState>
          </div>
        )}
      </div>
    </div>
  );
}

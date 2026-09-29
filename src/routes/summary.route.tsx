import { useQuery } from "@tanstack/react-query";

import { sessionQueryOptions } from "../features/auth/api/session-query";
import { hasUiCapability } from "../features/auth/model/ui-capabilities";
import { SummaryPage } from "../features/summary/components/summary-page";

export function Component() {
  const { data: session } = useQuery(sessionQueryOptions);
  return (
    <SummaryPage
      canRead={hasUiCapability(session, "bag.payroll.read")}
      canGenerate={hasUiCapability(session, "bag.payroll.generate")}
      canOverride={hasUiCapability(session, "bag.payroll.override")}
      canReview={hasUiCapability(session, "bag.payroll.review")}
      canLock={hasUiCapability(session, "bag.payroll.lock")}
      canSync={hasUiCapability(session, "bag.attendance.sync")}
      canReadRates={hasUiCapability(session, "bag.rates.read")}
      csrfToken={session?.csrfToken ?? ""}
    />
  );
}

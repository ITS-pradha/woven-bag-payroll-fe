import { useQuery } from "@tanstack/react-query";

import { sessionQueryOptions } from "../features/auth/api/session-query";
import { hasUiCapability } from "../features/auth/model/ui-capabilities";
import { DetailPage } from "../features/detail/components/detail-page";

export function Component() {
  const { data: session } = useQuery(sessionQueryOptions);
  const canRead = hasUiCapability(session, "bag.payroll.read");
  return <DetailPage canRead={canRead} />;
}

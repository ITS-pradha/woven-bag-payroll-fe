import { useQuery } from "@tanstack/react-query";

import { sessionQueryOptions } from "../features/auth/api/session-query";
import { hasUiCapability } from "../features/auth/model/ui-capabilities";
import { RatesPage } from "../features/rates/components/rates-page";

export function Component() {
  const { data: session } = useQuery(sessionQueryOptions);
  return (
    <RatesPage
      canRead={hasUiCapability(
        session,
        "bag.rates.read",
        "bag.rates.write",
        "bag.rates.approve",
      )}
      canWrite={hasUiCapability(session, "bag.rates.write")}
      canApprove={hasUiCapability(session, "bag.rates.approve")}
      csrfToken={session?.csrfToken ?? ""}
    />
  );
}

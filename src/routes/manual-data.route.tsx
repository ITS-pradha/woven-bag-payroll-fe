import { useQuery } from "@tanstack/react-query";
import { sessionQueryOptions } from "../features/auth/api/session-query";
import { hasUiCapability } from "../features/auth/model/ui-capabilities";
import { ManualDataPage } from "../features/manual-data/components/manual-data-page";

export function Component() {
  const { data: session } = useQuery(sessionQueryOptions);
  const canWrite = hasUiCapability(
    session,
    "bag.production.write",
    "bag.production.all.access",
  );
  return (
    <ManualDataPage
      // Remount saat user berganti: buku terakhir dibuka dibaca sekali saat
      // halaman dipasang, dan milik user sebelumnya tidak boleh terbawa.
      key={session?.user.userId ?? "anonymous"}
      userId={session?.user.userId ?? ""}
      canWrite={canWrite}
      canCreateBook={hasUiCapability(session, "bag.payroll.generate")}
      canCloseBook={hasUiCapability(session, "bag.payroll.lock")}
      csrfToken={session?.csrfToken ?? ""}
    />
  );
}

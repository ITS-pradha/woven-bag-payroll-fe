import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { sessionQueryOptions } from "../api/session-query";

export function ProtectedRoute() {
  const location = useLocation();
  const sessionQuery = useQuery(sessionQueryOptions);

  if (sessionQuery.isPending) {
    return (
      <main className="grid min-h-screen place-items-center bg-app px-6">
        <div
          className="flex items-center gap-3 text-sm font-medium text-muted"
          role="status"
        >
          <span
            className="size-4 animate-spin rounded-full border-2 border-border-strong border-t-brand"
            aria-hidden="true"
          />
          Memeriksa sesi…
        </div>
      </main>
    );
  }

  if (sessionQuery.isError) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <Outlet />;
}

import { queryOptions } from "@tanstack/react-query";

import { getSession } from "./auth-api";

export const sessionQueryKey = ["auth", "session"] as const;

export const sessionQueryOptions = queryOptions({
  queryKey: sessionQueryKey,
  queryFn: getSession,
  staleTime: 30_000,
  retry: false,
});

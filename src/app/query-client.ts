import { QueryClient } from "@tanstack/react-query";

import { ApiClientError } from "../api/client/api-result";

const MAX_RETRY_COUNT = 2;

export function shouldRetryRequest(failureCount: number, error: Error) {
  if (failureCount >= MAX_RETRY_COUNT) {
    return false;
  }

  if (!(error instanceof ApiClientError)) {
    return true;
  }

  return error.status === 408 || error.status === 429 || error.status >= 500;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: shouldRetryRequest,
        retryDelay: (attemptIndex) =>
          Math.min(1_000 * 2 ** attemptIndex, 10_000),
      },
      mutations: {
        retry: false,
      },
    },
  });
}

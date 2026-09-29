import { describe, expect, it } from "vitest";

import { ApiClientError } from "../api/client/api-result";
import { shouldRetryRequest } from "./query-client";

describe("shouldRetryRequest", () => {
  it("tidak mengulang client error", () => {
    expect(shouldRetryRequest(0, new ApiClientError({ status: 409 }))).toBe(
      false,
    );
  });

  it("mengulang transient error paling banyak dua kali", () => {
    const error = new ApiClientError({ status: 503 });

    expect(shouldRetryRequest(0, error)).toBe(true);
    expect(shouldRetryRequest(1, error)).toBe(true);
    expect(shouldRetryRequest(2, error)).toBe(false);
  });
});

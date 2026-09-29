import { describe, expect, it } from "vitest";

import { ApiClientError, unwrapApiData } from "./api-result";

describe("unwrapApiData", () => {
  it("mengembalikan data pada response sukses", () => {
    const result = unwrapApiData({
      data: { pin: "2264" },
      response: new Response(null, { status: 200 }),
    });

    expect(result).toEqual({ pin: "2264" });
  });

  it("mempertahankan code dan requestId dari error API terstruktur", () => {
    expect(() =>
      unwrapApiData({
        error: {
          error: {
            code: "ROW_VERSION_CONFLICT",
            message: "Data telah berubah.",
            requestId: "req-123",
          },
        },
        response: new Response(null, { status: 409 }),
      }),
    ).toThrow(
      expect.objectContaining<Partial<ApiClientError>>({
        status: 409,
        code: "ROW_VERSION_CONFLICT",
        requestId: "req-123",
      }),
    );
  });

  it("menggunakan error aman ketika payload tidak mengikuti kontrak", () => {
    expect(() =>
      unwrapApiData({
        error: "<html>gateway error</html>",
        response: new Response(null, { status: 502 }),
      }),
    ).toThrow(
      expect.objectContaining<Partial<ApiClientError>>({
        status: 502,
        code: "UNEXPECTED_API_ERROR",
      }),
    );
  });
});

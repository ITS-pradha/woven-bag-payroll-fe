import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../../api/client/api-result";
import { env } from "../../../config/env";
import {
  getSession,
  loginWithPassword,
  loginWithSso,
  logout,
} from "./auth-api";

const sessionSnapshot = {
  user: {
    userId: "d890801f-4a1c-4fc1-a03d-187faaf4f75a",
    hrisUserId: 42,
    email: "1027",
    displayName: "Komariyah",
  },
  permissions: ["production.read", "production.write"],
  roles: ["PAYROLL_ADMIN"],
  isSuperAdmin: false,
  expiresAt: "2026-09-24T02:11:40.000Z",
  csrfToken: "csrf-token-in-memory",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("auth API", () => {
  it("mengirim PIN sebagai field email sesuai kontrak backend", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(sessionSnapshot), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await loginWithPassword({
      pin: "PT1-0153-4600",
      password: "rahasia",
      rememberMe: true,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${env.VITE_API_BASE_URL}/auth/login`);
    expect(request).toMatchObject({
      method: "POST",
      credentials: "include",
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      email: "PT1-0153-4600",
      password: "rahasia",
      rememberMe: true,
    });
  });

  it("menukar sesi portal melalui endpoint SSO", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(sessionSnapshot), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await loginWithSso({ rememberMe: false });

    expect(fetchMock).toHaveBeenCalledWith(
      `${env.VITE_API_BASE_URL}/auth/sso-login`,
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ rememberMe: false }),
      }),
    );
  });

  it("membaca ulang sesi dengan cookie browser", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(sessionSnapshot), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSession()).resolves.toEqual(sessionSnapshot);
    expect(fetchMock).toHaveBeenCalledWith(
      `${env.VITE_API_BASE_URL}/auth/session`,
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("mengakhiri sesi perangkat aktif menggunakan cookie browser", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(logout()).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledWith(
      `${env.VITE_API_BASE_URL}/auth/logout`,
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("mempertahankan kode error terstruktur dari backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "INVALID_CREDENTIALS",
              message: "Email/Pin atau password salah",
              requestId: "req-login-1",
            },
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    await expect(
      loginWithPassword({ pin: "1027", password: "salah", rememberMe: false }),
    ).rejects.toMatchObject<Partial<ApiClientError>>({
      status: 401,
      code: "INVALID_CREDENTIALS",
      requestId: "req-login-1",
    });
  });
});

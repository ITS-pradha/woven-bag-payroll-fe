import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProtectedRoute } from "./protected-route";

const sessionSnapshot = {
  user: {
    userId: "d890801f-4a1c-4fc1-a03d-187faaf4f75a",
    hrisUserId: 42,
    email: "1027",
    displayName: "Komariyah",
  },
  permissions: ["production.read"],
  roles: ["PAYROLL_ADMIN"],
  isSuperAdmin: false,
  expiresAt: "2026-09-24T02:11:40.000Z",
  csrfToken: "csrf-token-in-memory",
};

function renderProtectedRoute() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/manual-data"]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="manual-data" element={<h1>Manual Data</h1>} />
          </Route>
          <Route path="login" element={<h1>Login</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProtectedRoute", () => {
  it("mengarahkan tamu ke login saat sesi tidak tersedia", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "SESSION_ENDED",
              message: "Belum login",
              requestId: "req-session-1",
            },
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    renderProtectedRoute();

    expect(
      await screen.findByRole("heading", { name: "Login" }),
    ).toBeInTheDocument();
  });

  it("mengarahkan ke login ketika pemeriksaan sesi tidak dapat dilakukan", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    renderProtectedRoute();

    expect(
      await screen.findByRole("heading", { name: "Login" }),
    ).toBeInTheDocument();
  });

  it("menampilkan route aplikasi saat sesi valid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(sessionSnapshot), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    renderProtectedRoute();

    expect(
      await screen.findByRole("heading", { name: "Manual Data" }),
    ).toBeInTheDocument();
  });
});

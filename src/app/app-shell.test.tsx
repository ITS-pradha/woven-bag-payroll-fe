import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sessionQueryKey } from "../features/auth/api/session-query";
import { AppShell } from "./app-shell";
import { createQueryClient } from "./query-client";

const session = {
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

describe("AppShell", () => {
  it("menampilkan navigasi domain utama dan area konten", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(sessionQueryKey, session);
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/manual-data"]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="manual-data" element={<h1>Manual Data</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("navigation", { name: "Menu utama" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manual Data" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Detail" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "LDMS Data" })).toBeNull();
    expect(screen.getByRole("link", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toContainElement(
      screen.getByRole("heading", { name: "Manual Data" }),
    );
  });

  it("menampilkan profil dan melepas seluruh cache meski request logout gagal", async () => {
    const user = userEvent.setup();
    const queryClient = createQueryClient();
    queryClient.setQueryData(sessionQueryKey, session);
    queryClient.setQueryData(["production", "sensitive"], { rows: [1] });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/manual-data"]}>
          <Routes>
            <Route path="login" element={<h1>Halaman login</h1>} />
            <Route element={<AppShell />}>
              <Route path="manual-data" element={<h1>Manual Data</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: "Buka menu profil Komariyah" }),
    );
    const profile = screen.getByRole("region", { name: "Profil pengguna" });
    expect(within(profile).getByText("Komariyah")).toBeInTheDocument();
    expect(within(profile).getByText("Payroll Admin")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Keluar" }));

    expect(
      await screen.findByRole("heading", { name: "Halaman login" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(queryClient.getQueryData(sessionQueryKey)).toBeUndefined();
      expect(
        queryClient.getQueryData(["production", "sensitive"]),
      ).toBeUndefined();
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it } from "vitest";

import type { AuthSession } from "../api/auth-api";
import { hasUiCapability } from "./ui-capabilities";

const baseSession: AuthSession = {
  user: {
    userId: "d890801f-4a1c-4fc1-a03d-187faaf4f75a",
    hrisUserId: 42,
    email: "1027",
    displayName: "Admin Karung",
  },
  permissions: [],
  roles: [],
  isSuperAdmin: false,
  expiresAt: "2026-09-24T02:11:40.000Z",
  csrfToken: "csrf-test",
};

describe("hasUiCapability", () => {
  it("menampilkan seluruh kapabilitas UI untuk superadmin", () => {
    const session = Object.freeze({ ...baseSession, isSuperAdmin: true });

    expect(hasUiCapability(session, "bag.production.write")).toBe(true);
    expect(hasUiCapability(session, "bag.rates.approve")).toBe(true);
    expect(hasUiCapability(session, "bag.payroll.lock")).toBe(true);
    expect(session.permissions).toEqual([]);
  });

  it("menghormati permission UI khusus dan bag.all.access", () => {
    expect(
      hasUiCapability(
        { ...baseSession, permissions: ["bag.payroll.read"] },
        "bag.payroll.read",
      ),
    ).toBe(true);
    expect(
      hasUiCapability(
        { ...baseSession, permissions: ["bag.all.access"] },
        "bag.rates.approve",
      ),
    ).toBe(true);
  });

  it("menyembunyikan kapabilitas UI tanpa permission yang sesuai", () => {
    expect(hasUiCapability(baseSession, "bag.payroll.read")).toBe(false);
    expect(hasUiCapability(undefined, "bag.production.write")).toBe(false);
  });
});

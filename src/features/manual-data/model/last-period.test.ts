import { afterEach, describe, expect, it, vi } from "vitest";
import { readLastPeriod, writeLastPeriod } from "./last-period";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("buku terakhir dibuka", () => {
  it("mengingat buku per user dan per departemen", () => {
    writeLastPeriod("user-a", "KARUNG", "period-1");
    writeLastPeriod("user-b", "KARUNG", "period-2");
    expect(readLastPeriod("user-a", "KARUNG")).toBe("period-1");
    expect(readLastPeriod("user-b", "KARUNG")).toBe("period-2");
    expect(readLastPeriod("user-a", "LOOM")).toBeNull();
  });

  it("tanpa user tidak menyimpan apa pun", () => {
    writeLastPeriod("", "KARUNG", "period-1");
    expect(readLastPeriod("", "KARUNG")).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("penyimpanan yang diblokir jatuh ke pilihan bawaan, tidak melempar", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => writeLastPeriod("user-a", "KARUNG", "p")).not.toThrow();
    expect(readLastPeriod("user-a", "KARUNG")).toBeNull();
  });
});

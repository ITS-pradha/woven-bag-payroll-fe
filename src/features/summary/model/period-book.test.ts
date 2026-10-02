import { describe, expect, it } from "vitest";

import type { PayrollPeriod } from "../api/summary-api";
import { periodBookLabel, selectPeriodBook } from "./period-book";

function book(
  id: string,
  periodStart: string,
  periodEnd: string,
): PayrollPeriod {
  return {
    id,
    code: `KARUNG-${periodEnd.slice(0, 7)}`,
    periodStart,
    periodEnd,
    departmentCode: "KARUNG",
    status: "OPEN",
    rowVersion: 1,
    createdAt: "2026-08-24T08:00:00+07:00",
    closedAt: null,
  };
}

const august = book("a", "2026-07-24", "2026-08-23");
const september = book("b", "2026-08-24", "2026-09-23");

describe("selectPeriodBook", () => {
  it("memakai pilihan pengguna selama bukunya masih ada", () => {
    expect(selectPeriodBook([august, september], "a", "2026-09-01")).toBe(
      august,
    );
  });

  it("jatuh ke buku yang mencakup hari ini, termasuk tanggal 23 sebagai hari terakhir", () => {
    expect(selectPeriodBook([august, september], null, "2026-09-23")).toBe(
      september,
    );
    expect(selectPeriodBook([august, september], "hilang", "2026-08-23")).toBe(
      august,
    );
  });

  it("jatuh ke buku terbaru bila tidak ada yang mencakup hari ini", () => {
    expect(selectPeriodBook([august, september], null, "2026-10-01")).toBe(
      september,
    );
    expect(selectPeriodBook([], null, "2026-10-01")).toBeNull();
  });
});

describe("periodBookLabel", () => {
  it("menandai buku yang sudah ditutup", () => {
    expect(periodBookLabel({ ...september, status: "CLOSED" })).toBe(
      "KARUNG-2026-09 · 24 Agu 2026 – 23 Sep 2026 · TUTUP",
    );
  });
});

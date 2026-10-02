import { describe, expect, it } from "vitest";
import {
  periodWarning,
  periodWarningMessage,
  suggestNextPeriod,
} from "./period-book";

const sep = {
  code: "2026-09",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
};
const oct = {
  code: "2026-10",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
};

describe("periodWarning", () => {
  it("diam saat hari ini tercakup dan akhir buku masih jauh", () => {
    expect(periodWarning([sep], "2026-09-10")).toBeNull();
  });

  it("hari ini di luar semua buku tidak diperingatkan: buku lampau sah", () => {
    expect(periodWarning([sep], "2026-10-02")).toBeNull();
    expect(
      periodWarning(
        [
          {
            code: "lampau",
            periodStart: "2026-08-24",
            periodEnd: "2026-09-23",
          },
        ],
        "2026-09-28",
      ),
    ).toBeNull();
  });

  it("memperingatkan ≤3 hari sebelum akhir buku kalau periode berikutnya belum ada", () => {
    expect(periodWarning([sep], "2026-09-26")).toBeNull();
    const warning = periodWarning([sep], "2026-09-27");
    expect(warning).toMatchObject({
      kind: "NEXT_MISSING",
      nextDate: "2026-10-01",
    });
    expect(periodWarningMessage(warning!)).toContain(
      "Buat periode yang mencakup 2026-10-01",
    );
    expect(periodWarning([sep], "2026-09-30")).toMatchObject({
      kind: "NEXT_MISSING",
    });
  });

  it("diam saat periode berikutnya sudah dibuat", () => {
    expect(periodWarning([sep, oct], "2026-09-29")).toBeNull();
  });

  it("tidak menggandakan pesan 'belum ada buku sama sekali'", () => {
    expect(periodWarning([], "2026-09-29")).toBeNull();
  });
});

describe("suggestNextPeriod", () => {
  it("tanpa buku: siklus 24–23 yang mencakup hari ini", () => {
    expect(suggestNextPeriod([], "2026-10-01", "KARUNG")).toEqual({
      code: "KARUNG-2026-10",
      periodStart: "2026-09-24",
      periodEnd: "2026-10-23",
    });
    // Tanggal 23 masih siklus lama, tanggal 24 sudah siklus baru.
    expect(suggestNextPeriod([], "2026-10-23", "KARUNG")).toMatchObject({
      periodStart: "2026-09-24",
      periodEnd: "2026-10-23",
    });
    expect(suggestNextPeriod([], "2026-10-24", "KARUNG")).toMatchObject({
      periodStart: "2026-10-24",
      periodEnd: "2026-11-23",
    });
  });

  it("melanjutkan tepat setelah buku terakhir, bukan dari hari ini", () => {
    const aug = {
      code: "KARUNG-2026-08",
      periodStart: "2026-07-24",
      periodEnd: "2026-08-23",
    };
    const sepCycle = {
      code: "KARUNG-2026-09",
      periodStart: "2026-08-24",
      periodEnd: "2026-09-23",
    };
    expect(suggestNextPeriod([sepCycle, aug], "2026-08-01", "KARUNG")).toEqual({
      code: "KARUNG-2026-10",
      periodStart: "2026-09-24",
      periodEnd: "2026-10-23",
    });
  });

  it("buku terakhir di luar siklus: buku peralihan sampai tanggal 23, tanpa celah", () => {
    expect(suggestNextPeriod([oct, sep], "2026-09-28", "KARUNG")).toEqual({
      code: "KARUNG-2026-11",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-23",
    });
  });

  it("buku terakhir berakhir tanggal 22: mulai tanggal 23, berakhir 23 bulan berikutnya", () => {
    const odd = {
      code: "KARUNG-ODD",
      periodStart: "2026-09-01",
      periodEnd: "2026-10-22",
    };
    expect(suggestNextPeriod([odd], "2026-10-20", "KARUNG")).toMatchObject({
      periodStart: "2026-10-23",
      periodEnd: "2026-11-23",
    });
  });

  it("tidak menyarankan kode yang sudah dipakai buku lain", () => {
    const namedByStart = {
      code: "KARUNG-2026-10",
      periodStart: "2026-08-24",
      periodEnd: "2026-09-23",
    };
    expect(suggestNextPeriod([namedByStart], "2026-09-28", "KARUNG")).toEqual({
      code: "KARUNG-2026-09",
      periodStart: "2026-09-24",
      periodEnd: "2026-10-23",
    });

    const bothTaken = [
      namedByStart,
      {
        code: "KARUNG-2026-09",
        periodStart: "2025-01-01",
        periodEnd: "2025-01-31",
      },
    ];
    expect(suggestNextPeriod(bothTaken, "2026-09-28", "KARUNG").code).toBe(
      "KARUNG-2026-10-2",
    );
  });

  it("melewati pergantian tahun", () => {
    const dec = {
      code: "KARUNG-2026-12",
      periodStart: "2026-11-24",
      periodEnd: "2026-12-23",
    };
    expect(suggestNextPeriod([dec], "2026-12-10", "KARUNG")).toEqual({
      code: "KARUNG-2027-01",
      periodStart: "2026-12-24",
      periodEnd: "2027-01-23",
    });
    expect(suggestNextPeriod([], "2027-01-05", "KARUNG")).toMatchObject({
      periodStart: "2026-12-24",
      periodEnd: "2027-01-23",
    });
  });
});

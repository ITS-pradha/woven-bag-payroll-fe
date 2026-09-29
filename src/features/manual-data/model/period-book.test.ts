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
  it("tanpa buku: bulan berjalan penuh", () => {
    expect(suggestNextPeriod([], "2026-09-28", "KARUNG")).toEqual({
      code: "KARUNG-2026-09",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    });
  });

  it("melanjutkan tepat setelah buku terakhir, bukan setelah bulan ini", () => {
    expect(suggestNextPeriod([oct, sep], "2026-09-28", "KARUNG")).toEqual({
      code: "KARUNG-2026-11",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
    });
  });

  it("mengikuti siklus buku terakhir, bukan bulan kalender", () => {
    const cycle = {
      code: "KARUNG-2026-08",
      periodStart: "2026-08-24",
      periodEnd: "2026-09-23",
    };
    expect(suggestNextPeriod([cycle], "2026-09-28", "KARUNG")).toEqual({
      code: "KARUNG-2026-09",
      periodStart: "2026-09-24",
      periodEnd: "2026-10-23",
    });
    // Mulai tanggal 31: bulan depan yang lebih pendek dipotong, tidak
    // meloncat ke bulan berikutnya lagi.
    const jan = {
      code: "z",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-30",
    };
    expect(suggestNextPeriod([jan], "2026-01-10", "KARUNG")).toMatchObject({
      periodStart: "2026-01-31",
      periodEnd: "2026-02-27",
    });
  });

  it("menghitung akhir Februari kabisat dan pergantian tahun", () => {
    const jan = {
      code: "x",
      periodStart: "2028-01-01",
      periodEnd: "2028-01-31",
    };
    expect(suggestNextPeriod([jan], "2028-01-10", "KARUNG").periodEnd).toBe(
      "2028-02-29",
    );
    const dec = {
      code: "y",
      periodStart: "2026-12-01",
      periodEnd: "2026-12-31",
    };
    expect(suggestNextPeriod([dec], "2026-12-10", "KARUNG")).toMatchObject({
      code: "KARUNG-2027-01",
      periodEnd: "2027-01-31",
    });
  });
});

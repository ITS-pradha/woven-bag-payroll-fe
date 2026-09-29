import { describe, expect, it } from "vitest";

import type { RateVersionOption } from "../api/summary-api";
import {
  defaultRateSelection,
  effectiveRangeLabel,
  selectedRateVersionIds,
} from "./rate-selection";

function version(overrides: Partial<RateVersionOption>): RateVersionOption {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    code: "HB-CS-2026-V1",
    name: "Harga CS",
    machineGroup: "CS",
    versionNo: 1,
    effectiveFrom: "2026-08-01",
    effectiveToExclusive: null,
    status: "ACTIVE",
    ...overrides,
  };
}

describe("defaultRateSelection", () => {
  it("memilih versi terbaru yang sedang berlaku per machine group", () => {
    const selection = defaultRateSelection(
      [
        version({
          id: "cs-1",
          versionNo: 1,
          effectiveFrom: "2026-08-01",
          effectiveToExclusive: "2026-09-01",
          status: "RETIRED",
        }),
        version({ id: "cs-2", versionNo: 2, effectiveFrom: "2026-09-01" }),
        version({ id: "sp-1", machineGroup: "SP", code: "HB-SP-V1" }),
      ],
      "2026-09-29",
    );
    expect(selection).toEqual({ CS: "cs-2", SP: "sp-1" });
    expect(selectedRateVersionIds(selection)).toEqual(["cs-2", "sp-1"]);
  });

  it("melewati versi ACTIVE yang baru berlaku di masa depan", () => {
    const selection = defaultRateSelection(
      [
        version({
          id: "cs-2",
          versionNo: 2,
          effectiveFrom: "2026-09-01",
          effectiveToExclusive: "2026-10-01",
        }),
        version({ id: "cs-3", versionNo: 3, effectiveFrom: "2026-10-01" }),
      ],
      "2026-09-29",
    );
    expect(selection.CS).toBe("cs-2");
  });

  it("tanpa versi yang berlaku hari ini, jatuh ke yang terbaru", () => {
    const selection = defaultRateSelection(
      [
        version({
          id: "cs-1",
          effectiveToExclusive: "2026-09-01",
          status: "RETIRED",
        }),
      ],
      "2026-09-29",
    );
    expect(selection.CS).toBe("cs-1");
  });
});

describe("effectiveRangeLabel", () => {
  it("menampilkan akhir eksklusif sebagai tanggal terakhir berlaku", () => {
    expect(
      effectiveRangeLabel(
        version({
          effectiveFrom: "2026-08-24",
          effectiveToExclusive: "2026-09-01",
        }),
      ),
    ).toBe("24 Agu 2026 – 31 Agu 2026");
    expect(effectiveRangeLabel(version({ effectiveFrom: "2026-09-01" }))).toBe(
      "sejak 1 Sep 2026",
    );
  });
});

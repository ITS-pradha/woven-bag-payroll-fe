import { describe, expect, it } from "vitest";

import { formatNumber } from "../../../lib/format-number";
import { regularCurveTrace } from "./calculation-trace.fixture";
import { readableTrace } from "./calculation-trace";

describe("formatNumber", () => {
  it("membulatkan string desimal tanpa Number dan membuang nol di ujung", () => {
    expect(formatNumber("130.28022928662", 2)).toBe("130,28");
    expect(formatNumber("1042.24183429296", 2)).toBe("1.042,24");
    expect(formatNumber("845.000", 2)).toBe("845");
    expect(formatNumber("49920.665", 2)).toBe("49.920,67");
    expect(formatNumber("999.995", 2)).toBe("1.000");
    expect(formatNumber("-0.001", 2)).toBe("0");
    expect(formatNumber("900719925474099312345.5", 0)).toBe(
      "900.719.925.474.099.312.346",
    );
    expect(formatNumber("bukan angka")).toBe("bukan angka");
  });
});

describe("readableTrace", () => {
  const readable = readableTrace(regularCurveTrace)!;

  it("menulis setiap langkah dengan angka baris ini, bukan nama variabel", () => {
    expect(
      readable.steps.map((step) => [step.label, step.working, step.result]),
    ).toEqual([
      ["Durasi kerja", "Jam selesai shift dikurangi jam mulai shift", "8 jam"],
      [
        "Target per jam",
        "1.028,4 PPM (kurva lebar) untuk weft 10, dengan efisiensi dan pembagian mesin dari policy",
        "130,28 m/jam",
      ],
      ["Target shift", "130,28 m/jam × 8 jam", "1.042,24 m"],
      [
        "Tarif per meter",
        "Kurva lebar Regular untuk lebar 50 cm, disesuaikan dengan weft 10",
        "Rp59,0777/m",
      ],
      ["Base pay", "845 m × Rp59,0777/m", "Rp49.920,66"],
      [
        "Kelebihan dari target",
        "845 m belum melewati target 1.042,24 m",
        "0 m",
      ],
      ["Tarif bonus", "Rp59,0777/m × pengali bonus 1,2", "Rp70,8932/m"],
      ["Bonus", "0 m × Rp70,8932/m", "Rp0"],
    ]);
  });

  it("menyimpan nilai persis dan rumus mentah untuk audit", () => {
    const base = readable.steps.find((step) => step.key === "basePay")!;
    expect(base.exact).toBe("49920.662415");
    expect(base.expression).toBe("resultMeter * payRatePerMeter");
    expect(readable.technical).toContainEqual({
      label: "Rate row ID",
      value: "4b20af33-513e-4e00-a227-bca9269d7efb",
    });
  });

  it("langkah bonus yang nol diredam, bukan disembunyikan", () => {
    expect(
      readable.steps.filter((step) => step.muted).map((step) => step.key),
    ).toEqual(["excessMeter", "bonusPay"]);
  });

  it("menjelaskan versi harga dan pembulatan dalam kalimat", () => {
    expect(readable.pricing).toEqual([
      { label: "Versi harga", value: "HB-REG-LEGACY-V1" },
      { label: "Cara tarif ditentukan", value: "Kurva lebar (Regular)" },
      { label: "Pengali bonus", value: "1,2×" },
      {
        label: "Pembulatan",
        value:
          "Baris ini tidak dibulatkan; total per karyawan dibulatkan setengah ke atas, 4 desimal.",
      },
    ]);
    expect(readable.inputs).toContainEqual({
      label: "Sumber data",
      value: "Manual Data",
    });
  });

  it("menandai rumus sementara", () => {
    const placeholder = readableTrace({
      ...regularCurveTrace,
      formulaStatus: "PLACEHOLDER",
      inputs: {
        ...regularCurveTrace.inputs,
        durationFallback: "runtime LDMS tidak tersedia, memakai rentang shift",
      },
    })!;
    expect(placeholder.notes[0]).toMatchObject({ tone: "warning" });
    expect(placeholder.notes[0]?.text).toMatch(/runtime LDMS tidak tersedia/);
  });

  it("bentuk trace yang tidak dikenal jatuh ke daftar biasa", () => {
    expect(readableTrace({ formula: "1137 × 71.61" })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  applyOverrideMatrix,
  formatRupiah,
  normalizeMoneyInput,
  parseOverrideMatrix,
} from "./summary-draft";
import { formatRupiahRate } from "../../../lib/format-money";

describe("normalizeMoneyInput", () => {
  it("menormalkan format Rupiah dari spreadsheet tanpa Number", () => {
    expect(normalizeMoneyInput("Rp 4.008.285")).toBe("4008285");
    expect(normalizeMoneyInput("4,008,285")).toBe("4008285");
    expect(normalizeMoneyInput("900719925474099312345")).toBe(
      "900719925474099312345",
    );
    expect(normalizeMoneyInput("1200.50")).toBe("1200.50");
  });

  it("menolak nilai negatif dan teks yang bukan nominal", () => {
    expect(normalizeMoneyInput("-100")).toBeNull();
    expect(normalizeMoneyInput("empat juta")).toBeNull();
  });
});

describe("formatRupiah", () => {
  it("memformat nominal besar dan negatif tanpa kehilangan presisi", () => {
    expect(formatRupiah("900719925474099312345")).toBe(
      "Rp900.719.925.474.099.312.345",
    );
    expect(formatRupiah("-75000.50")).toBe("-Rp75.001");
  });

  it("membulatkan ke rupiah utuh tanpa kehilangan presisi", () => {
    expect(formatRupiah("3916104.1029")).toBe("Rp3.916.104");
    expect(formatRupiah("3916104.5")).toBe("Rp3.916.105");
    expect(formatRupiah("999999.9")).toBe("Rp1.000.000");
    expect(formatRupiah("900719925474099312345.7")).toBe(
      "Rp900.719.925.474.099.312.346",
    );
    expect(formatRupiah("-0.4")).toBe("Rp0");
    expect(formatRupiah("4008285")).toBe("Rp4.008.285");
  });

  it("tarif per meter tetap menampilkan desimalnya", () => {
    expect(formatRupiahRate("55.36")).toBe("Rp55,36");
  });
});

describe("override matrix", () => {
  it("menerapkan satu baris clipboard ke semua karyawan terpilih", () => {
    const matrix = parseOverrideMatrix("4.500.000\t125.000");
    const rows = [
      { pin: "8954", basePay: "4000000", bonusPay: "0" },
      { pin: "9001", basePay: "4100000", bonusPay: "10000" },
    ];

    expect(
      applyOverrideMatrix(rows, new Set(["8954", "9001"]), "8954", matrix),
    ).toEqual([
      { pin: "8954", basePay: "4500000", bonusPay: "125000" },
      { pin: "9001", basePay: "4500000", bonusPay: "125000" },
    ]);
  });

  it("menolak jumlah baris clipboard yang tidak sama dengan seleksi", () => {
    const rows = [
      { pin: "8954", basePay: "4000000", bonusPay: "0" },
      { pin: "9001", basePay: "4100000", bonusPay: "10000" },
    ];
    const matrix = parseOverrideMatrix("4500000\t0\n4600000\t0\n4700000\t0");

    expect(() =>
      applyOverrideMatrix(rows, new Set(["8954", "9001"]), "8954", matrix),
    ).toThrow("Jumlah baris yang ditempel harus sama dengan jumlah pilihan");
  });
});

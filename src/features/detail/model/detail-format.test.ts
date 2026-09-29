import { describe, expect, it } from "vitest";

import {
  formatDateTimeWib,
  formatDateWib,
  formatDecimal,
  traceLabel,
} from "./detail-format";

describe("formatter Detail", () => {
  it("menampilkan tanggal snapshot dalam WIB", () => {
    expect(formatDateTimeWib("2026-08-24T07:00:00+07:00")).toBe(
      "24/08/2026 07.00",
    );
    expect(formatDateWib("2026-08-24")).toBe("24/08/2026");
  });

  it("menampilkan decimal tanpa mengubah presisi menjadi Number", () => {
    expect(formatDecimal("900719925474099312345.50")).toBe(
      "900719925474099312345,50",
    );
  });

  it("mengubah key calculation trace menjadi label ramah admin", () => {
    expect(traceLabel("payRatePerMeter")).toBe("Tarif per meter");
    expect(traceLabel("roundedBasePay")).toBe("Base pay setelah pembulatan");
  });
});

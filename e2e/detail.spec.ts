import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { regularCurveTrace } from "../src/features/detail/model/calculation-trace.fixture";

const runId = "60000000-0000-4000-8000-000000000001";
const pin = "1500";
const createdAt = "2026-09-24T08:05:00+07:00";

const run = {
  id: runId,
  periodId: "40000000-0000-4000-8000-000000000001",
  attendancePeriodId: "50000000-0000-4000-8000-000000000001",
  runNo: 1,
  status: "LOCKED",
  rateResolutionMode: "BY_SHIFT_START",
  rateVersionCodes: ["HB-CS-2026-V2"],
  sourceCutoffAt: createdAt,
  sourceRowCount: 128,
  pinCount: 2,
  blockingExceptionCount: 0,
  runVersion: 3,
  createdAt,
  generatedAt: createdAt,
  reviewedAt: createdAt,
  lockedAt: createdAt,
  statusUrl: `/api/v1/payroll-runs/${runId}`,
  failure: null,
};

const employeeSummary = {
  pin,
  employeeName: "Komariyah",
  calculatedBasePay: "4008285",
  calculatedBonusPay: "0",
  basePay: "4008285",
  bonusPay: "0",
  attendanceAdjustment: "-75000",
  otherAdjustment: "0",
  totalPay: "3933285",
  workingDays: "24",
  workingHours: "192",
  overtimeHours: "4",
  hasOverride: false,
  hasBlockingException: false,
  rowVersion: 1,
};

test.beforeEach(async ({ page }) => {
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      json: {
        user: {
          userId: "30000000-0000-4000-8000-000000000001",
          hrisUserId: 1,
          email: "8954",
          displayName: "Admin Karung",
        },
        permissions: ["bag.payroll.read"],
        roles: ["PAYROLL_ADMIN"],
        isSuperAdmin: false,
        expiresAt: "2099-01-01T00:00:00Z",
        csrfToken: "csrf-detail",
      },
    }),
  );
  await page.route("**/payroll-runs?pageSize=25", (route) =>
    route.fulfill({
      json: {
        data: [run],
        page: { pageSize: 25, hasNextPage: false, nextCursor: null },
      },
    }),
  );
  await page.route(`**/payroll-runs/${runId}/summaries?*`, (route) =>
    route.fulfill({
      json: {
        data: [employeeSummary],
        page: { pageSize: 20, hasNextPage: false, nextCursor: null },
        aggregate: {
          totalBasePay: employeeSummary.basePay,
          totalBonusPay: employeeSummary.bonusPay,
          totalPay: employeeSummary.totalPay,
          totalWorkingDays: employeeSummary.workingDays,
        },
      },
    }),
  );
  await page.route(`**/payroll-runs/${runId}/pins/${pin}`, (route) =>
    route.fulfill({
      json: {
        summary: employeeSummary,
        productionLineCount: 2,
        attendanceLineCount: 2,
      },
    }),
  );
  await page.route(
    `**/payroll-runs/${runId}/pins/${pin}/production-lines?*`,
    (route) =>
      route.fulfill({
        json: {
          data: [
            {
              id: "70000000-0000-4000-8000-000000000001",
              productionEntryId: "71000000-0000-4000-8000-000000000001",
              productionRowVersion: 1,
              pin,
              stationNo: 1,
              sourceType: "MANUAL",
              shiftStart: "2026-08-24T07:00:00+07:00",
              shiftEnd: "2026-08-24T19:00:00+07:00",
              widthCm: "75",
              weftDensity: "9.7",
              resultMeter: "1052",
              durationHours: "12",
              targetMeter: "1328.22",
              payRatePerMeter: "55.36",
              calculatedBasePay: "58240",
              calculatedBonusPay: "0",
              calculatedTotalPay: "58240",
              appliedPayRateId: "72000000-0000-4000-8000-000000000001",
              rateVersionCode: "HB-CS-2026-V2",
              calculationTrace: regularCurveTrace,
            },
            {
              id: "70000000-0000-4000-8000-000000000002",
              productionEntryId: "71000000-0000-4000-8000-000000000002",
              productionRowVersion: 1,
              pin,
              stationNo: 2,
              sourceType: "LDMS",
              shiftStart: "2026-08-24T07:00:00+07:00",
              shiftEnd: "2026-08-24T19:00:00+07:00",
              widthCm: "59",
              weftDensity: "12.2",
              resultMeter: "1137",
              durationHours: "12",
              targetMeter: "1239.24",
              payRatePerMeter: "71.61",
              calculatedBasePay: "81422",
              calculatedBonusPay: "0",
              calculatedTotalPay: "81422",
              appliedPayRateId: "72000000-0000-4000-8000-000000000002",
              rateVersionCode: "HB-CS-2026-V2",
              calculationTrace: { formula: "1137 × 71.61" },
            },
          ],
          page: { pageSize: 100, hasNextPage: false, nextCursor: null },
        },
      }),
  );
  await page.route(
    `**/payroll-runs/${runId}/pins/${pin}/attendance-lines?*`,
    (route) =>
      route.fulfill({
        json: {
          data: [
            {
              id: "80000000-0000-4000-8000-000000000001",
              hrisWorkDayId: "81000000-0000-4000-8000-000000000001",
              pin,
              workingDate: "2026-08-24",
              shiftCode: "SHIFT_1",
              workingDays: "1",
              workingHours: "8",
              overtimeHours: "0",
              attendanceStatus: "PRESENT",
              decisionReason: null,
            },
            {
              id: "80000000-0000-4000-8000-000000000002",
              hrisWorkDayId: "81000000-0000-4000-8000-000000000002",
              pin,
              workingDate: "2026-08-25",
              shiftCode: "SHIFT_1",
              workingDays: "0",
              workingHours: "0",
              overtimeHours: "0",
              attendanceStatus: "MISSING_FINGER",
              decisionReason: "Form gagal finger tidak dibuat sampai H+1",
            },
          ],
          page: { pageSize: 100, hasNextPage: false, nextCursor: null },
        },
      }),
  );
});

test("menampilkan snapshot produksi dan calculation trace per PIN", async ({
  page,
}) => {
  await page.goto(`/detail?run=${runId}&pin=${pin}`);

  await expect(page.getByRole("heading", { name: "Komariyah" })).toBeVisible();
  await expect(page.getByText("PIN 1500")).toBeVisible();
  await expect(page.getByText("Rp3.933.285")).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Rincian produksi Komariyah" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Sumber", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "LDMS", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "Rp58.240", exact: true }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Lihat trace mesin 1" }).click();
  const trace = page.getByRole("region", { name: "Cara menghitung · mesin 1" });
  const steps = trace.getByRole("list", { name: "Langkah perhitungan" });
  // Worked with this row's numbers, in words — not variable names or JSON.
  await expect(steps.getByRole("listitem")).toHaveCount(8);
  await expect(steps).toContainText("Base pay845 m × Rp59,0777/mRp49.920,66");
  await expect(trace).toContainText("Kurva lebar (Regular)");
  await expect(trace.getByText('"step"')).toHaveCount(0);
  // The raw formula is still one click away for an audit.
  await expect(trace.getByText("resultMeter * payRatePerMeter")).toBeHidden();
  await trace.getByText("Detail teknis untuk audit").click();
  await expect(trace.getByText("resultMeter * payRatePerMeter")).toBeVisible();
  await expect(trace.getByText("49920.662415")).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);

  // A trace in a shape this screen does not know still shows, as a plain list.
  await page.getByRole("button", { name: "Lihat trace mesin 2" }).click();
  const legacy = page.getByRole("region", {
    name: "Cara menghitung · mesin 2",
  });
  await expect(legacy).toContainText("Rumus");
  await expect(legacy).toContainText("1137 × 71.61");
});

test("tab attendance menjelaskan pengurangan working day", async ({ page }) => {
  await page.goto(`/detail?run=${runId}&pin=${pin}`);
  await page.getByRole("tab", { name: "Attendance (2)" }).click();

  await expect(
    page.getByRole("table", { name: "Rincian attendance Komariyah" }),
  ).toBeVisible();
  await expect(page.getByText("MISSING FINGER")).toBeVisible();
  await expect(
    page.getByText("Form gagal finger tidak dibuat sampai H+1"),
  ).toBeVisible();
  await expect(page).toHaveURL(/tab=attendance/);
});

test("menu Detail dapat mencari karyawan berdasarkan nama", async ({
  page,
}) => {
  let summaryQuery = "";
  await page.route(`**/payroll-runs/${runId}/summaries?*`, async (route) => {
    summaryQuery =
      new URL(route.request().url()).searchParams.get("query") ?? "";
    await route.fulfill({
      json: {
        data: [employeeSummary],
        page: { pageSize: 20, hasNextPage: false, nextCursor: null },
        aggregate: {
          totalBasePay: employeeSummary.basePay,
          totalBonusPay: employeeSummary.bonusPay,
          totalPay: employeeSummary.totalPay,
          totalWorkingDays: employeeSummary.workingDays,
        },
      },
    });
  });
  await page.goto("/detail");
  await page.getByRole("combobox", { name: "Cari karyawan" }).fill("Koma");
  await expect.poll(() => summaryQuery).toBe("Koma");
  await page.getByRole("option", { name: "Komariyah · PIN 1500" }).click();

  await expect(page.getByRole("heading", { name: "Komariyah" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`run=${runId}.*pin=${pin}`));
});

test("klik kolom Cari karyawan langsung membuka daftar, juga setelah memilih", async ({
  page,
}) => {
  const other = {
    ...employeeSummary,
    pin: "1501",
    employeeName: "Mokhamad Imam Gozali",
  };
  const queries: string[] = [];
  await page.route(`**/payroll-runs/${runId}/summaries?*`, async (route) => {
    const query =
      new URL(route.request().url()).searchParams.get("query") ?? "";
    queries.push(query);
    const everyone = [employeeSummary, other];
    await route.fulfill({
      json: {
        data: query
          ? everyone.filter((employee) => employee.employeeName.includes(query))
          : everyone,
        page: { pageSize: 20, hasNextPage: false, nextCursor: null },
        aggregate: {
          totalBasePay: employeeSummary.basePay,
          totalBonusPay: employeeSummary.bonusPay,
          totalPay: employeeSummary.totalPay,
          totalWorkingDays: employeeSummary.workingDays,
        },
      },
    });
  });
  await page.goto("/detail");
  const search = page.getByRole("combobox", { name: "Cari karyawan" });
  const list = page.getByRole("listbox", {
    name: "Karyawan dalam payroll run",
  });

  // Focus alone opens the list — no typing needed.
  await search.click();
  await expect(list.getByRole("option")).toHaveCount(2);
  await list.getByRole("option", { name: /Mokhamad Imam Gozali/ }).click();
  await expect(list).toHaveCount(0);
  await expect(search).toHaveValue("Mokhamad Imam Gozali");

  // Clicking the box again, while it still has focus, reopens it — with
  // everyone in the run, not just the name already in the box.
  await search.click();
  await expect(list.getByRole("option")).toHaveCount(2);
  await expect(
    list.getByRole("option", { name: /Mokhamad Imam Gozali/ }),
  ).toHaveAttribute("aria-selected", "true");

  // Typing replaces the chosen name rather than appending to it.
  await page.keyboard.type("Koma");
  await expect(search).toHaveValue("Koma");
  await expect(list.getByRole("option")).toHaveCount(1);
  expect(queries).toContain("Koma");
});

test("Detail tidak membuat halaman melebar pada viewport target", async ({
  page,
}) => {
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/detail?run=${runId}&pin=${pin}`);
    await expect(
      page.getByRole("heading", { name: "Komariyah" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      `viewport ${viewport.width}px`,
    ).toBe(false);
  }
});

test("tanpa payroll, Detail menunjukkan satu langkah: buka Summary", async ({
  page,
}) => {
  await page.route("**/payroll-runs?pageSize=25", (route) =>
    route.fulfill({
      json: {
        data: [],
        page: { pageSize: 25, hasNextPage: false, nextCursor: null },
      },
    }),
  );
  await page.goto("/detail");
  const empty = page.getByRole("region", { name: "Belum ada payroll" });
  await expect(empty).toBeVisible();
  // The run picker and employee search have nothing to offer yet.
  await expect(page.getByLabel("Pilih payroll run")).toHaveCount(0);
  for (const [name, width, height] of [
    ["desktop", 1440, 900],
    ["mobile", 390, 780],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `test-results/empty-detail-${name}.png` });
  }
  await empty.getByRole("link", { name: "Buka Summary" }).click();
  await expect(page).toHaveURL(/\/summary/);
});

test("pagination Detail menempel di bawah layar saat rincian produksinya panjang", async ({
  page,
}) => {
  const line = {
    productionEntryId: "71000000-0000-4000-8000-000000000001",
    productionRowVersion: 1,
    pin,
    sourceType: "MANUAL",
    shiftStart: "2026-08-24T07:00:00+07:00",
    shiftEnd: "2026-08-24T19:00:00+07:00",
    widthCm: "75",
    weftDensity: "9.7",
    resultMeter: "1052",
    durationHours: "12",
    targetMeter: "1328.22",
    payRatePerMeter: "55.36",
    calculatedBasePay: "58240",
    calculatedBonusPay: "0",
    calculatedTotalPay: "58240",
    appliedPayRateId: "72000000-0000-4000-8000-000000000001",
    rateVersionCode: "HB-CS-2026-V2",
    calculationTrace: { formula: "1052 × 55.36" },
  };
  await page.route(
    `**/payroll-runs/${runId}/pins/${pin}/production-lines?*`,
    (route) =>
      route.fulfill({
        json: {
          data: Array.from({ length: 60 }, (_, index) => ({
            ...line,
            id: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            stationNo: index + 1,
          })),
          page: { pageSize: 100, hasNextPage: true, nextCursor: "next" },
        },
      }),
  );
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/detail?run=${runId}&pin=${pin}`);
    await expect(
      page.getByRole("table", { name: "Rincian produksi Komariyah" }),
    ).toBeVisible();
    const pager = page.locator("footer").filter({ hasText: "Berikutnya" });
    for (const scroll of [0, 800]) {
      await page.mouse.wheel(0, scroll);
      await expect(pager).toBeInViewport();
      const box = (await pager.boundingBox())!;
      expect(box.y + box.height).toBeGreaterThan(viewport.height - 4);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    }
    await page.screenshot({
      path: `test-results/detail-sticky-${viewport.width}.png`,
    });
  }
});

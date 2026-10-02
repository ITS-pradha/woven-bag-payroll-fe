import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const periodId = "40000000-0000-4000-8000-000000000001";
const attendanceId = "50000000-0000-4000-8000-000000000001";
const runId = "60000000-0000-4000-8000-000000000001";
const createdAt = "2026-09-24T08:05:00+07:00";

const run = {
  id: runId,
  periodId,
  attendancePeriodId: attendanceId,
  runNo: 1,
  status: "GENERATED",
  rateResolutionMode: "BY_SHIFT_START",
  rateVersionCodes: ["HB-CS-2026-V2"],
  sourceCutoffAt: createdAt,
  sourceRowCount: 128,
  pinCount: 2,
  blockingExceptionCount: 0,
  runVersion: 1,
  createdAt,
  generatedAt: createdAt,
  reviewedAt: null,
  lockedAt: null,
  statusUrl: `/api/v1/payroll-runs/${runId}`,
  failure: null,
};

const summaries = [
  {
    pin: "1500",
    employeeName: "Komariyah",
    calculatedBasePay: "4008285",
    calculatedBonusPay: "0",
    basePay: "4008285",
    bonusPay: "0",
    attendanceAdjustment: "0",
    otherAdjustment: "0",
    totalPay: "4008285",
    workingDays: "24",
    workingHours: "192",
    overtimeHours: "0",
    hasOverride: false,
    hasBlockingException: false,
    rowVersion: 1,
  },
  {
    pin: "1501",
    employeeName: "Mokhamad Imam Gozali",
    calculatedBasePay: "4277844",
    calculatedBonusPay: "1000",
    basePay: "4277844",
    bonusPay: "1000",
    attendanceAdjustment: "0",
    otherAdjustment: "0",
    totalPay: "4278844",
    workingDays: "25",
    workingHours: "200",
    overtimeHours: "4",
    hasOverride: false,
    hasBlockingException: false,
    rowVersion: 1,
  },
];

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
        permissions: [
          "bag.payroll.read",
          "bag.payroll.generate",
          "bag.payroll.override",
          "bag.payroll.review",
          "bag.payroll.lock",
        ],
        roles: ["PAYROLL_ADMIN"],
        isSuperAdmin: false,
        expiresAt: "2099-01-01T00:00:00Z",
        csrfToken: "csrf-summary",
      },
    }),
  );
  await page.route("**/payroll-periods?*", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: periodId,
            code: "LOOM-2026-09",
            periodStart: "2026-08-24",
            periodEnd: "2026-09-23",
            departmentCode: "LOOM",
            status: "OPEN",
            createdAt,
            rowVersion: 1,
            closedAt: null,
          },
        ],
        page: { pageSize: 100, hasNextPage: false, nextCursor: null },
      },
    }),
  );
  await page.route("**/attendance-periods?*", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: attendanceId,
            periodStart: "2026-08-24",
            periodEnd: "2026-09-23",
            departmentCode: "LOOM",
            hrisRevision: 3,
            status: "FINAL",
            finalizedAt: createdAt,
            finalizedBy: "HRD",
            checksum: "final-r3",
            recordCount: 48,
            syncedAt: createdAt,
          },
        ],
        page: { pageSize: 100, hasNextPage: false, nextCursor: null },
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
  await page.route(`**/payroll-runs/${runId}`, (route) =>
    route.fulfill({ json: run }),
  );
  await page.route(`**/payroll-runs/${runId}/summaries?*`, (route) =>
    route.fulfill({
      json: {
        data: summaries,
        page: { pageSize: 100, hasNextPage: false, nextCursor: null },
        aggregate: {
          totalBasePay: "8286129",
          totalBonusPay: "1000",
          totalPay: "8287129",
          totalWorkingDays: "49",
        },
      },
    }),
  );
});

test("menampilkan summary yang padat, terbaca, dan aksesibel", async ({
  page,
}) => {
  await page.goto("/summary");

  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expect(page.getByText("FINAL · Revision 3")).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Summary payroll per karyawan" }),
  ).toBeVisible();
  await expect(page.getByText("Rp8.287.129")).toBeVisible();
  // Rupiah at rest, the exact server value once the cell is being edited.
  const basePay = page.getByLabel("Base pay Komariyah");
  await expect(basePay).toHaveValue("Rp4.008.285");
  await basePay.focus();
  await expect(basePay).toHaveValue("4008285");
  await basePay.blur();
  await expect(basePay).toHaveValue("Rp4.008.285");
  await expect(page.getByRole("button", { name: "Simpan (0)" })).toBeDisabled();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("paste override banyak karyawan mengirim payload aman dan idempoten", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let body: unknown;
  await page.route(
    `**/payroll-runs/${runId}/override-batches`,
    async (route) => {
      expect(route.request().headers()["x-csrf-token"]).toBe("csrf-summary");
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      body = await route.request().postDataJSON();
      await route.fulfill({
        json: {
          runVersion: 2,
          updated: summaries.map((row) => ({
            ...row,
            basePay: "4500000",
            bonusPay: "125000",
            totalPay: "4625000",
            hasOverride: true,
            rowVersion: 2,
          })),
          rejected: [],
        },
      });
    },
  );
  await page.goto("/summary");
  await page.getByLabel("Pilih Komariyah").check();
  await page.getByLabel("Pilih Mokhamad Imam Gozali").check();
  await page
    .getByLabel("Alasan override")
    .fill("Penyesuaian hasil verifikasi admin");
  await page.evaluate(() =>
    navigator.clipboard.writeText("4.500.000\t125.000"),
  );
  await page.getByRole("button", { name: "Tempel" }).click();

  await expect(page.getByLabel("Base pay Komariyah")).toHaveValue("4500000");
  await expect(page.getByLabel("Bonus pay Mokhamad Imam Gozali")).toHaveValue(
    "125000",
  );
  await page.getByRole("button", { name: "Simpan (2)" }).click();
  await expect(page.getByRole("status")).toContainText(
    "2 override berhasil disimpan",
  );

  expect(body).toEqual({
    expectedRunVersion: 1,
    rows: summaries.map((row) => ({
      clientRowId: `${row.pin}-1`,
      pin: row.pin,
      expectedRowVersion: 1,
      basePay: "4500000",
      bonusPay: "125000",
      reason: "Penyesuaian hasil verifikasi admin",
    })),
  });
});

test("perubahan override dapat dibatalkan tanpa mengirim data", async ({
  page,
}) => {
  let overrideRequests = 0;
  await page.route(`**/payroll-runs/${runId}/override-batches`, (route) => {
    overrideRequests += 1;
    return route.abort();
  });
  await page.goto("/summary");

  const basePay = page.getByLabel("Base pay Komariyah");
  await basePay.fill("4500000");
  await expect(page.getByRole("button", { name: "Batal (1)" })).toBeVisible();
  await page.getByRole("button", { name: "Batal (1)" }).click();

  await expect(basePay).toHaveValue("Rp4.008.285");
  await expect(page.getByRole("button", { name: "Simpan (0)" })).toBeDisabled();
  expect(overrideRequests).toBe(0);
});

test("generate memakai attendance FINAL lalu status job diperbarui otomatis", async ({
  page,
}) => {
  const nextId = "60000000-0000-4000-8000-000000000002";
  let generateBody: unknown;
  await page.route("**/payroll-runs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    expect(route.request().headers()["x-csrf-token"]).toBe("csrf-summary");
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    generateBody = await route.request().postDataJSON();
    await route.fulfill({
      status: 202,
      json: { ...run, id: nextId, status: "QUEUED", runNo: 2, pinCount: 0 },
    });
  });
  await page.route(`**/payroll-runs/${nextId}`, (route) =>
    route.fulfill({
      json: { ...run, id: nextId, status: "GENERATED", runNo: 2 },
    }),
  );
  await page.route(`**/payroll-runs/${nextId}/summaries?*`, (route) =>
    route.fulfill({
      json: {
        data: summaries,
        page: { pageSize: 100, hasNextPage: false, nextCursor: null },
        aggregate: {
          totalBasePay: "8286129",
          totalBonusPay: "1000",
          totalPay: "8287129",
          totalWorkingDays: "49",
        },
      },
    }),
  );

  await page.goto("/summary");
  await page.getByRole("button", { name: "Generate payroll" }).click();
  await expect(page).toHaveURL(new RegExp(`run=${nextId}`));
  await expect(page.getByText("SIAP DIPERIKSA")).toBeVisible();
  expect(generateBody).toEqual({ periodId, attendancePeriodId: attendanceId });
});

test("generate ulang membuat run baru dari buku dan attendance run terpilih", async ({
  page,
}) => {
  const nextId = "60000000-0000-4000-8000-000000000003";
  const bodies: unknown[] = [];
  const keys: string[] = [];
  await page.route("**/payroll-runs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    expect(route.request().headers()["x-csrf-token"]).toBe("csrf-summary");
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    bodies.push(await route.request().postDataJSON());
    await route.fulfill({
      status: 202,
      json: { ...run, id: nextId, status: "QUEUED", runNo: 2, pinCount: 0 },
    });
  });
  await page.route(`**/payroll-runs/${nextId}`, (route) =>
    route.fulfill({
      json: { ...run, id: nextId, status: "GENERATED", runNo: 2 },
    }),
  );
  await page.route(`**/payroll-runs/${nextId}/summaries?*`, (route) =>
    route.fulfill({
      json: {
        data: summaries,
        page: { pageSize: 100, hasNextPage: false, nextCursor: null },
        aggregate: {
          totalBasePay: "8286129",
          totalBonusPay: "1000",
          totalPay: "8287129",
          totalWorkingDays: "49",
        },
      },
    }),
  );

  await page.goto(`/summary?run=${runId}`);
  await page.getByRole("button", { name: "Generate ulang" }).click();
  const dialog = page.getByRole("dialog", { name: "Generate ulang run #1?" });
  await expect(dialog).toContainText(
    "Override base/bonus di run #1 tidak ikut",
  );

  // Kembali tidak mengirim apa pun.
  await dialog.getByRole("button", { name: "Kembali" }).click();
  expect(bodies).toHaveLength(0);

  await page.getByRole("button", { name: "Generate ulang" }).click();
  await page
    .getByRole("dialog", { name: "Generate ulang run #1?" })
    .getByRole("button", { name: "Generate ulang" })
    .click();
  await expect(page).toHaveURL(new RegExp(`run=${nextId}`));
  const progress = page.getByRole("dialog", {
    name: "Payroll selesai dihitung",
  });
  await expect(progress).toBeVisible();
  await expect(progress).toContainText("Run #2");
  await progress.getByRole("button", { name: "Selesai" }).click();
  await expect(progress).toBeHidden();
  // Buku dan attendance diambil dari run sumber, bukan dari pilihan buku.
  expect(bodies).toEqual([{ periodId, attendancePeriodId: attendanceId }]);
  expect(keys[0]).toBeTruthy();
});

test("generate memakai buku periode yang dipilih, tanpa isian tanggal", async ({
  page,
}) => {
  const augustId = "40000000-0000-4000-8000-000000000002";
  const queried: string[] = [];
  let body: unknown;
  await page.route("**/payroll-periods?*", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: augustId,
            code: "KARUNG-2026-08",
            periodStart: "2026-07-24",
            periodEnd: "2026-08-23",
            departmentCode: "KARUNG",
            status: "OPEN",
            createdAt,
            rowVersion: 1,
            closedAt: null,
          },
          {
            id: periodId,
            code: "KARUNG-2026-09",
            periodStart: "2026-08-24",
            periodEnd: "2026-09-23",
            departmentCode: "KARUNG",
            status: "OPEN",
            createdAt,
            rowVersion: 1,
            closedAt: null,
          },
        ],
        page: { pageSize: 200, hasNextPage: false, nextCursor: null },
      },
    }),
  );
  await page.route("**/attendance-periods?*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    queried.push(`${query.get("periodStart")}..${query.get("periodEnd")}`);
    return route.fulfill({
      json: {
        data: [
          {
            id: attendanceId,
            periodStart: query.get("periodStart"),
            periodEnd: query.get("periodEnd"),
            departmentCode: "LOOM",
            hrisRevision: 3,
            status: "FINAL",
            finalizedAt: createdAt,
            finalizedBy: "HRD",
            checksum: "final-r3",
            recordCount: 48,
            syncedAt: createdAt,
          },
        ],
        page: { pageSize: 100, hasNextPage: false, nextCursor: null },
      },
    });
  });
  await page.route("**/payroll-runs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    body = await route.request().postDataJSON();
    await route.fulfill({ status: 202, json: { ...run, status: "QUEUED" } });
  });

  await page.goto("/summary");
  await expect(page.getByLabel("Start date")).toHaveCount(0);
  const book = page.getByLabel("Buku periode");
  await book.selectOption(augustId);
  await expect.poll(() => queried.at(-1)).toBe("2026-07-24..2026-08-23");
  await page.getByRole("button", { name: "Generate payroll" }).click();
  await expect
    .poll(() => body)
    .toEqual({
      periodId: augustId,
      attendancePeriodId: attendanceId,
    });
});

test("versi harga dipilih per machine group sebelum generate, default versi aktif terbaru", async ({
  page,
}) => {
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      json: {
        user: {
          userId: "30000000-0000-4000-8000-000000000001",
          hrisUserId: 1,
          email: "8954",
          displayName: "Admin Karung",
        },
        permissions: [
          "bag.payroll.read",
          "bag.payroll.generate",
          "bag.rates.read",
        ],
        roles: ["PAYROLL_ADMIN"],
        isSuperAdmin: false,
        expiresAt: "2099-01-01T00:00:00Z",
        csrfToken: "csrf-summary",
      },
    }),
  );
  const rateVersion = (
    id: string,
    fields: {
      code: string;
      machineGroup: "REGULAR" | "CS" | "SP";
      versionNo: number;
      effectiveFrom: string;
      effectiveToExclusive: string | null;
      status: "DRAFT" | "ACTIVE" | "RETIRED";
    },
  ) => ({
    id,
    scheduleCode: `LOOM_${fields.machineGroup}`,
    name: `Harga ${fields.code}`,
    bonusMultiplier: "1.2",
    roundingMode: "HALF_UP_AT_PIN_TOTAL",
    rowVersion: 1,
    createdBy: "30000000-0000-4000-8000-000000000001",
    createdAt,
    ...fields,
  });
  const csV2 = "70000000-0000-4000-8000-000000000002";
  const csV3 = "70000000-0000-4000-8000-000000000003";
  const csDraft = "70000000-0000-4000-8000-000000000004";
  const spV1 = "70000000-0000-4000-8000-000000000011";
  await page.route("**/pay-rate-versions?*", (route) =>
    route.fulfill({
      json: {
        data: [
          rateVersion(csDraft, {
            code: "HB-CS-2026-V4",
            machineGroup: "CS",
            versionNo: 4,
            effectiveFrom: "2026-11-01",
            effectiveToExclusive: null,
            status: "DRAFT",
          }),
          rateVersion(csV3, {
            code: "HB-CS-2026-V3",
            machineGroup: "CS",
            versionNo: 3,
            effectiveFrom: "2026-09-01",
            effectiveToExclusive: null,
            status: "ACTIVE",
          }),
          rateVersion(csV2, {
            code: "HB-CS-2026-V2",
            machineGroup: "CS",
            versionNo: 2,
            effectiveFrom: "2026-08-24",
            effectiveToExclusive: "2026-09-01",
            status: "RETIRED",
          }),
          rateVersion(spV1, {
            code: "HB-SP-2026-V1",
            machineGroup: "SP",
            versionNo: 1,
            effectiveFrom: "2026-08-24",
            effectiveToExclusive: null,
            status: "ACTIVE",
          }),
        ],
        page: { pageSize: 50, hasNextPage: false, nextCursor: null },
      },
    }),
  );
  const nextId = "60000000-0000-4000-8000-000000000004";
  const bodies: unknown[] = [];
  await page.route("**/payroll-runs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    bodies.push(await route.request().postDataJSON());
    await route.fulfill({
      status: 202,
      json: {
        ...run,
        id: nextId,
        status: "QUEUED",
        runNo: 2,
        rateResolutionMode: "PINNED_VERSION",
      },
    });
  });
  await page.route(`**/payroll-runs/${nextId}`, (route) =>
    route.fulfill({
      json: {
        ...run,
        id: nextId,
        runNo: 2,
        rateResolutionMode: "PINNED_VERSION",
      },
    }),
  );

  await page.goto(`/summary?run=${runId}`);
  const cs = page.getByLabel("Versi harga CS");
  const sp = page.getByLabel("Versi harga SP");
  // Default: the newest version in force today, per group.
  await expect(cs).toHaveValue(csV3);
  await expect(sp).toHaveValue(spV1);
  // DRAFT is never offered; an expired version is, marked as such.
  await expect(cs.locator("option")).toHaveText([
    "HB-CS-2026-V3 · sejak 1 Sep 2026",
    "HB-CS-2026-V2 · 24 Agu 2026 – 31 Agu 2026 · Expired",
  ]);
  // No REGULAR version exists, so no REGULAR picker either.
  await expect(page.getByLabel("Versi harga Regular")).toHaveCount(0);

  await cs.selectOption(csV2);
  await page.getByRole("button", { name: "Generate ulang" }).click();
  const dialog = page.getByRole("dialog", { name: "Generate ulang run #1?" });
  await expect(dialog).toContainText("HB-CS-2026-V2, HB-SP-2026-V1");
  await dialog.getByRole("button", { name: "Generate ulang" }).click();

  await expect(page).toHaveURL(new RegExp(`run=${nextId}`));
  expect(bodies).toEqual([
    {
      periodId,
      attendancePeriodId: attendanceId,
      rateVersionIds: [csV2, spV1],
    },
  ]);
});

test("tanpa akses Konfigurasi Harga, generate tetap memilih harga per tanggal shift", async ({
  page,
}) => {
  await page.goto(`/summary?run=${runId}`);
  await expect(
    page.getByText("Versi harga: otomatis per tanggal shift."),
  ).toBeVisible();
  await expect(page.getByLabel("Versi harga CS")).toHaveCount(0);
});

test("run yang terkunci tidak bisa di-generate ulang", async ({ page }) => {
  await page.route(`**/payroll-runs/${runId}`, (route) =>
    route.fulfill({
      json: { ...run, status: "LOCKED", lockedAt: createdAt },
    }),
  );
  await page.goto(`/summary?run=${runId}`);
  await expect(page.getByText("Komariyah")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate ulang" }),
  ).toHaveCount(0);
});

test("review dan lock memakai runVersion serta menjelaskan dampak lock", async ({
  page,
}) => {
  await page.route(`**/payroll-runs/${runId}/reviews`, async (route) => {
    expect(await route.request().postDataJSON()).toEqual({
      expectedRunVersion: 1,
      note: "Nominal dan exception sudah diperiksa",
    });
    await route.fulfill({
      json: {
        ...run,
        status: "REVIEWED",
        runVersion: 2,
        reviewedAt: createdAt,
      },
    });
  });
  await page.route(`**/payroll-runs/${runId}/locks`, async (route) => {
    expect(await route.request().postDataJSON()).toEqual({
      expectedRunVersion: 2,
      note: "Payroll final siap dikunci",
    });
    await route.fulfill({
      json: { ...run, status: "LOCKED", runVersion: 3, lockedAt: createdAt },
    });
  });

  await page.goto("/summary");
  await page.getByRole("button", { name: "Tandai direview" }).click();
  const cancelReview = page.getByRole("button", { name: "Batal" });
  await expect(cancelReview).toBeFocused();
  await page.keyboard.press("Tab");
  await expect
    .poll(() =>
      page
        .getByRole("dialog")
        .evaluate((dialog) => dialog.contains(document.activeElement)),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Tandai direview" }).click();
  await page
    .getByLabel("Catatan review")
    .fill("Nominal dan exception sudah diperiksa");
  await page.getByRole("button", { name: "Simpan review" }).click();
  await page.getByRole("button", { name: "Kunci payroll" }).click();
  await expect(
    page.getByText("Summary dan override menjadi immutable."),
  ).toBeVisible();
  await page
    .getByLabel("Catatan penguncian")
    .fill("Payroll final siap dikunci");
  await page.getByRole("button", { name: "Kunci payroll" }).last().click();
  await expect(page.getByRole("status")).toContainText("berhasil dikunci");
  await expect(page.getByLabel("Base pay Komariyah")).toBeDisabled();
});

test("workspace tidak melebar keluar viewport target", async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/summary");
    await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow, `viewport ${viewport.width}px`).toBe(false);
  }
});

test("payroll yang dibatalkan tidak terlihat seperti masih menghitung", async ({
  page,
}) => {
  await page.route(`**/payroll-runs/${runId}`, (route) =>
    route.fulfill({ json: { ...run, status: "CANCELLED" } }),
  );
  await page.goto("/summary");

  await expect(
    page.getByRole("heading", { name: "Payroll dibatalkan" }),
  ).toBeVisible();
  await expect(page.getByText("Payroll sedang dihitung")).toBeHidden();
});

test("tanpa payroll, Summary menunjuk ke form generate di atasnya", async ({
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
  await page.goto("/summary");
  const empty = page.getByRole("region", { name: "Belum ada payroll" });
  await expect(empty).toBeVisible();
  // The step is the generate form above, so the empty state adds no button.
  await expect(empty.getByRole("button")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Generate payroll" }),
  ).toBeVisible();
  for (const [name, width, height] of [
    ["desktop", 1440, 900],
    ["mobile", 390, 780],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `test-results/empty-summary-${name}.png` });
  }
});

test("pagination Summary menempel di bawah layar saat tabelnya panjang", async ({
  page,
}) => {
  const many = Array.from({ length: 60 }, (_, index) => ({
    ...summaries[index % summaries.length]!,
    pin: String(2000 + index),
    employeeName: `Operator ${index + 1}`,
  }));
  await page.route(`**/payroll-runs/${runId}/summaries?*`, (route) =>
    route.fulfill({
      json: {
        data: many,
        page: { pageSize: 100, hasNextPage: true, nextCursor: "next" },
        aggregate: {
          totalBasePay: "8286129",
          totalBonusPay: "1000",
          totalPay: "8287129",
          totalWorkingDays: "49",
        },
      },
    }),
  );
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/summary");
    await expect(page.getByText("Operator 60")).toBeAttached();
    const pager = page.locator("footer").filter({ hasText: "Berikutnya" });
    // Before and after scrolling: always on screen, pinned to its bottom.
    for (const scroll of [0, 800]) {
      await page.mouse.wheel(0, scroll);
      await expect(pager).toBeInViewport();
      const box = (await pager.boundingBox())!;
      expect(box.y + box.height).toBeGreaterThan(viewport.height - 4);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    }
    await page.screenshot({
      path: `test-results/summary-sticky-${viewport.width}.png`,
    });
  }
});

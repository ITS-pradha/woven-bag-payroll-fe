import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const activeId = "10000000-0000-4000-8000-000000000101";
const retiredId = "10000000-0000-4000-8000-000000000100";

const activeVersion = {
  id: activeId,
  scheduleCode: "LOOM_CS",
  versionNo: 2,
  code: "HB-CS-2026-V2",
  name: "Harga Borongan Loom 2026 V2",
  machineGroup: "CS",
  effectiveFrom: "2026-08-24",
  effectiveToExclusive: null,
  status: "ACTIVE",
  bonusMultiplier: "1.2",
  roundingMode: "HALF_UP_AT_PIN_TOTAL",
  changeNote: "Penyesuaian harga 2026.",
  rowVersion: 2,
  createdBy: "Admin Karung",
  createdAt: "2026-08-19T04:39:30.000Z",
  approvedBy: "Supervisor Karung",
  approvedAt: "2026-08-20T02:00:00.000Z",
};

const rows = [
  {
    id: "20000000-0000-4000-8000-000000000101",
    rowVersion: 1,
    widthFromCm: "30",
    widthToCm: "39",
    variants: [
      {
        weftDensity: "10",
        threadWidth: "2.6",
        baseRatePerMeter: "62.16",
        bonusRatePerMeter: null,
      },
      {
        weftDensity: "11",
        threadWidth: "2.3",
        baseRatePerMeter: "67.23",
        bonusRatePerMeter: null,
      },
      {
        weftDensity: "12",
        threadWidth: "2.1",
        baseRatePerMeter: "71.41",
        bonusRatePerMeter: null,
      },
    ],
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
        permissions: ["bag.rates.read", "bag.rates.write", "bag.rates.approve"],
        roles: ["PAYROLL_ADMIN"],
        isSuperAdmin: false,
        expiresAt: "2099-01-01T00:00:00Z",
        csrfToken: "csrf-rates",
      },
    }),
  );
  await page.route("**/pay-rate-versions?pageSize=50", (route) =>
    route.fulfill({
      json: {
        data: [
          activeVersion,
          {
            ...activeVersion,
            id: retiredId,
            versionNo: 1,
            code: "HB-CS-2021-V1",
            name: "Harga Borongan Lama",
            effectiveFrom: "2021-01-25",
            effectiveToExclusive: "2026-08-24",
            status: "RETIRED",
            rowVersion: 3,
          },
        ],
        page: { pageSize: 50, hasNextPage: false, nextCursor: null },
      },
    }),
  );
  await page.route(`**/pay-rate-versions/${activeId}`, (route) =>
    route.fulfill({ json: { ...activeVersion, rows } }),
  );
  await page.route(`**/pay-rate-versions/${retiredId}`, (route) =>
    route.fulfill({
      json: {
        ...activeVersion,
        id: retiredId,
        versionNo: 1,
        code: "HB-CS-2021-V1",
        name: "Harga Borongan Lama",
        effectiveFrom: "2021-01-25",
        effectiveToExclusive: "2026-08-24",
        status: "RETIRED",
        rowVersion: 3,
        rows,
      },
    }),
  );
});

test("menampilkan riwayat dan harga aktif bisa diedit kecuali tanggal mulai", async ({
  page,
}) => {
  await page.goto("/rates");

  await expect(
    page.getByRole("heading", { name: "Konfigurasi Harga" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /HB-CS-2026-V2/ }),
  ).toBeVisible();
  await expect(page.getByLabel("Nama versi")).toBeEnabled();
  // Tanggal mulai versi aktif menyambung ke versi sebelumnya; server menolaknya.
  await expect(page.getByLabel("Berlaku mulai")).toBeDisabled();
  await expect(page.getByLabel("Harga 10 × 10, range 1")).toHaveValue("62.16");
  await expect(
    page.getByText("Harga aktif dapat diedit langsung"),
  ).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("membuat draft dari harga aktif, menyimpan matriks, lalu mengaktifkannya", async ({
  page,
}) => {
  const draftId = "10000000-0000-4000-8000-000000000102";
  let saveBatchBody: unknown;
  let activationBody: unknown;

  await page.route("**/pay-rate-versions", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    expect(route.request().headers()["x-csrf-token"]).toBe("csrf-rates");
    await route.fulfill({
      status: 201,
      json: {
        ...activeVersion,
        id: draftId,
        versionNo: 3,
        code: "HB-CS-2026-V3",
        name: "Harga Borongan Loom 2026 V3",
        effectiveFrom: "2026-10-01",
        status: "DRAFT",
        rowVersion: 1,
        approvedBy: null,
        approvedAt: null,
      },
    });
  });
  await page.route(`**/pay-rate-versions/${draftId}`, async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({
        json: {
          ...activeVersion,
          ...(await route.request().postDataJSON()),
          id: draftId,
          versionNo: 3,
          status: "DRAFT",
          rowVersion: 2,
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        ...activeVersion,
        id: draftId,
        versionNo: 3,
        code: "HB-CS-2026-V3",
        name: "Harga Borongan Loom 2026 V3",
        effectiveFrom: "2026-10-01",
        status: "DRAFT",
        rowVersion: 1,
        rows,
      },
    });
  });
  await page.route(
    `**/pay-rate-versions/${draftId}/rate-batches`,
    async (route) => {
      saveBatchBody = await route.request().postDataJSON();
      await route.fulfill({
        json: {
          ...activeVersion,
          id: draftId,
          versionNo: 3,
          code: "HB-CS-2026-V3",
          name: "Harga Borongan Loom 2026 V3",
          effectiveFrom: "2026-10-01",
          status: "DRAFT",
          rowVersion: 3,
          rows: [
            {
              ...rows[0],
              rowVersion: 2,
              variants: (saveBatchBody as { rows: typeof rows }).rows[0]
                .variants,
            },
          ],
        },
      });
    },
  );
  await page.route(
    `**/pay-rate-versions/${draftId}/activations`,
    async (route) => {
      activationBody = await route.request().postDataJSON();
      await route.fulfill({
        json: {
          ...activeVersion,
          id: draftId,
          versionNo: 3,
          code: "HB-CS-2026-V3",
          name: "Harga Borongan Loom 2026 V3",
          effectiveFrom: "2026-10-01",
          status: "ACTIVE",
          rowVersion: 4,
          rows,
        },
      });
    },
  );

  await page.goto("/rates");
  await page.getByRole("button", { name: "Buat versi baru" }).click();
  await page.getByLabel("Kode versi baru").fill("HB-CS-2026-V3");
  await page.getByLabel("Nama versi baru").fill("Harga Borongan Loom 2026 V3");
  await page.getByLabel("Berlaku mulai versi baru").fill("2026-10-01");
  await page
    .getByLabel("Alasan perubahan versi baru")
    .fill("Penyesuaian harga Oktober 2026");
  await page.getByRole("button", { name: "Buat draft" }).click();

  await expect(page.getByText("DRAFT", { exact: true })).toBeVisible();
  await page.getByLabel("Harga 10 × 10, range 1").fill("64.10");
  await page.getByRole("button", { name: "Simpan draft" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Draft berhasil disimpan",
  );
  const saved = saveBatchBody as {
    expectedRowVersion: number;
    rows: Array<{ variants: Array<{ baseRatePerMeter: string }> }>;
  };
  expect(saved.expectedRowVersion).toBe(1);
  expect(saved.rows[0]?.variants[0]?.baseRatePerMeter).toBe("64.10");

  await page.getByRole("button", { name: "Aktifkan versi" }).click();
  await page
    .getByLabel("Catatan persetujuan")
    .fill("Harga sudah diperiksa dan disetujui.");
  await page.getByRole("button", { name: "Aktifkan harga" }).click();
  await expect(page.getByRole("status")).toContainText("berhasil diaktifkan");
  expect(activationBody).toEqual({
    expectedRowVersion: 3,
    approvalNote: "Harga sudah diperiksa dan disetujui.",
  });
});

test("buat versi baru menduplikat versi pilihan, tanpa mengisi ulang harganya", async ({
  page,
}) => {
  const draftId = "10000000-0000-4000-8000-000000000109";
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/pay-rate-versions", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    bodies.push(await route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      json: {
        ...activeVersion,
        id: draftId,
        versionNo: 3,
        code: "HB-CS-2021-V3",
        status: "DRAFT",
        rowVersion: 1,
        approvedBy: null,
        approvedAt: null,
      },
    });
  });
  await page.route(`**/pay-rate-versions/${draftId}`, (route) =>
    route.fulfill({
      json: {
        ...activeVersion,
        id: draftId,
        versionNo: 3,
        code: "HB-CS-2021-V3",
        status: "DRAFT",
        rowVersion: 1,
        rows,
      },
    }),
  );

  await page.goto("/rates");
  await page.getByRole("button", { name: "Buat versi baru" }).click();
  const sourcePicker = page.getByLabel("Duplikat dari versi");
  // Starts from the version on screen; the next number follows the highest
  // version of that schedule, not the source's own number.
  await expect(sourcePicker).toHaveValue(activeId);
  await expect(page.getByLabel("Kode versi baru")).toHaveValue("HB-CS-2026-V3");
  await expect(
    page.getByText("Semua harga dan aturan perhitungan HB-CS-2026-V2 disalin"),
  ).toBeVisible();

  // Starting blank asks for what a duplicate would have inherited.
  await sourcePicker.selectOption("");
  await expect(page.getByLabel("Kode jadwal")).toBeVisible();
  await expect(page.getByText("Draft baru dimulai tanpa harga")).toBeVisible();

  // Any older version can be the starting point.
  await sourcePicker.selectOption(retiredId);
  await expect(page.getByLabel("Kode jadwal")).toHaveCount(0);
  await expect(page.getByLabel("Kode versi baru")).toHaveValue("HB-CS-2021-V3");
  await page.getByLabel("Berlaku mulai versi baru").fill("2026-10-01");
  await page
    .getByLabel("Alasan perubahan versi baru")
    .fill("Kembali ke harga lama");
  await page.getByRole("button", { name: "Buat draft" }).click();

  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toMatchObject({
    cloneFromRateVersionId: retiredId,
    code: "HB-CS-2021-V3",
    scheduleCode: "LOOM_CS",
    machineGroup: "CS",
    effectiveFrom: "2026-10-01",
  });
});

test("menyimpan harga versi aktif setelah konfirmasi dampak ke payroll", async ({
  page,
}) => {
  const batches: { expectedRowVersion: number; rows: unknown[] }[] = [];
  await page.route(
    `**/pay-rate-versions/${activeId}/rate-batches`,
    async (route) => {
      const body = route.request().postDataJSON() as {
        expectedRowVersion: number;
        rows: unknown[];
      };
      batches.push(body);
      await route.fulfill({
        json: { ...activeVersion, rowVersion: 3, rows },
      });
    },
  );

  await page.goto("/rates");
  await page.getByLabel("Harga 10 × 10, range 1").fill("63.00");
  await page.getByRole("button", { name: "Simpan perubahan" }).click();

  // Belum terkirim sebelum dampaknya dikonfirmasi.
  const confirm = page.getByRole("alertdialog", {
    name: /Simpan perubahan harga ke versi aktif HB-CS-2026-V2/,
  });
  await expect(confirm).toContainText("harus di-generate ulang");
  expect(batches).toHaveLength(0);

  await confirm.getByRole("button", { name: "Simpan ke versi aktif" }).click();

  await expect(page.getByRole("status")).toContainText(
    "tersimpan dan langsung berlaku",
  );
  expect(batches).toHaveLength(1);
  expect(batches[0]?.expectedRowVersion).toBe(activeVersion.rowVersion);
});

test("menjelaskan penolakan server untuk harga yang dipakai payroll terkunci", async ({
  page,
}) => {
  await page.route(`**/pay-rate-versions/${activeId}/rate-batches`, (route) =>
    route.fulfill({
      status: 409,
      json: {
        error: {
          code: "RATE_VERSION_LOCKED",
          message: "Rate version dipakai payroll terkunci.",
        },
      },
    }),
  );

  await page.goto("/rates");
  const price = page.getByLabel("Harga 10 × 10, range 1");
  await price.fill("63.00");
  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  await page.getByRole("button", { name: "Simpan ke versi aktif" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "sudah dipakai payroll yang terkunci",
  );
  // Edit admin tetap ada; tidak ada yang hilang karena penolakan.
  await expect(price).toHaveValue("63.00");
});

test("mempertahankan edit saat terjadi konflik dan dapat memuat versi server", async ({
  page,
}) => {
  const draftId = "10000000-0000-4000-8000-000000000109";
  const draft = {
    ...activeVersion,
    id: draftId,
    status: "DRAFT",
    rowVersion: 5,
    approvedBy: null,
    approvedAt: null,
  } as const;
  await page.route("**/pay-rate-versions?pageSize=50", (route) =>
    route.fulfill({
      json: {
        data: [draft],
        page: { pageSize: 50, hasNextPage: false, nextCursor: null },
      },
    }),
  );
  await page.route(`**/pay-rate-versions/${draftId}`, (route) =>
    route.fulfill({ json: { ...draft, rows } }),
  );
  await page.route(`**/pay-rate-versions/${draftId}/rate-batches`, (route) =>
    route.fulfill({
      status: 409,
      json: {
        error: {
          code: "ROW_VERSION_CONFLICT",
          message: "Versi harga sudah berubah.",
        },
      },
    }),
  );

  await page.goto("/rates");
  const price = page.getByLabel("Harga 10 × 10, range 1");
  await price.fill("63.00");
  await page.getByRole("button", { name: "Simpan draft" }).click();

  await expect(page.getByRole("alert")).toContainText("diubah admin lain");
  await expect(price).toHaveValue("63.00");
  await page.getByRole("button", { name: "Muat versi server" }).click();
  await expect(price).toHaveValue("62.16");
});

test("workspace harga tetap utuh di semua ukuran layar target", async ({
  page,
}) => {
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/rates");

    await expect(
      page.getByRole("heading", { name: "Konfigurasi Harga" }),
    ).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Konfigurasi harga borongan" }),
    ).toBeVisible();
    const hasPageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasPageOverflow, `viewport ${viewport.width}px`).toBe(false);
  }
});

test("izin baca tidak menampilkan aksi perubahan harga", async ({ page }) => {
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      json: {
        user: {
          userId: "30000000-0000-4000-8000-000000000002",
          hrisUserId: 2,
          email: "9000",
          displayName: "Reviewer Harga",
        },
        permissions: ["bag.rates.read"],
        roles: ["RATE_REVIEWER"],
        isSuperAdmin: false,
        expiresAt: "2099-01-01T00:00:00Z",
        csrfToken: "csrf-readonly",
      },
    }),
  );

  await page.goto("/rates");

  await expect(
    page.getByRole("button", { name: "Buat versi baru" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Simpan draft" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Aktifkan versi" }),
  ).toHaveCount(0);
});

test("superadmin dapat memulai konfigurasi harga pertama dari kondisi kosong", async ({
  page,
}) => {
  let createBody: Record<string, unknown> | undefined;
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      json: {
        user: {
          userId: "30000000-0000-4000-8000-000000000003",
          hrisUserId: 3,
          email: "8954",
          displayName: "Muh Nasrul",
        },
        permissions: [],
        roles: ["SUPER_ADMIN"],
        isSuperAdmin: true,
        expiresAt: "2099-01-01T00:00:00Z",
        csrfToken: "csrf-superadmin",
      },
    }),
  );
  await page.route("**/pay-rate-versions?pageSize=50", (route) =>
    route.fulfill({
      json: {
        data: [],
        page: { pageSize: 50, hasNextPage: false, nextCursor: null },
      },
    }),
  );
  await page.route("**/pay-rate-versions", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    createBody = await route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      json: {
        ...activeVersion,
        id: "10000000-0000-4000-8000-000000000103",
        versionNo: 1,
        code: "HB-CS-2026-V1",
        name: "Harga Borongan Awal",
        status: "DRAFT",
        rowVersion: 1,
        approvedBy: null,
        approvedAt: null,
      },
    });
  });

  await page.goto("/rates");

  await page.getByRole("button", { name: "Tambah konfigurasi harga" }).click();
  await expect(
    page.getByRole("heading", { name: "Buat konfigurasi harga pertama" }),
  ).toBeVisible();
  await expect(page.getByLabel("Kode jadwal")).toBeVisible();
  await expect(page.getByLabel("Kelompok mesin")).toBeVisible();
  await page.getByLabel("Kode versi baru").fill("HB-CS-2026-V1");
  await page.getByLabel("Nama versi baru").fill("Harga Borongan Awal");
  await page.getByLabel("Berlaku mulai versi baru").fill("2026-09-15");
  await page
    .getByLabel("Alasan perubahan versi baru")
    .fill("Konfigurasi harga pertama");
  await page.getByRole("button", { name: "Buat draft" }).click();

  await expect
    .poll(() => createBody)
    .toMatchObject({
      scheduleCode: "LOOM_CS",
      machineGroup: "CS",
      code: "HB-CS-2026-V1",
      bonusMultiplier: "1",
      roundingMode: "HALF_UP_AT_PIN_TOTAL",
    });
  expect(createBody).not.toHaveProperty("cloneFromRateVersionId");
});

test("draft dapat memuat dan mengganti aturan kalkulasi dengan kontrak optimistic concurrency", async ({
  page,
}) => {
  const draftId = "10000000-0000-4000-8000-000000000110";
  const draft = {
    ...activeVersion,
    id: draftId,
    status: "DRAFT",
    rowVersion: 7,
    approvedBy: null,
    approvedAt: null,
  } as const;
  const policy = {
    rateVersionId: draftId,
    rowVersion: 3,
    targetPpmPolicy: { type: "FIXED", fixedTargetPpm: "95" },
    payRateFormula: { type: "MATRIX" },
    targetMeterPolicy: {
      millimetersPerInch: "25.4",
      millimetersPerMeter: "1000",
      baseEfficiencyFactor: "1",
      minutesPerHour: "60",
      loomShareNumerator: "1",
      loomShareDenominator: "1",
    },
    sourceDurationPolicies: [
      {
        sourceType: "MANUAL",
        durationMode: "SHIFT_ELAPSED",
        percentageScale: "100",
        minutesPerHour: "60",
      },
    ],
    sourceTargetFactors: [{ sourceType: "MANUAL", multiplier: "1" }],
    interpolationMode: "LINEAR",
    outOfRangeMode: "CLAMP",
    specialRules: [],
    updatedBy: "Admin Karung",
    updatedAt: "2026-09-15T01:00:00Z",
  };
  let putBody: Record<string, unknown> | undefined;
  await page.route("**/pay-rate-versions?pageSize=50", (route) =>
    route.fulfill({
      json: {
        data: [draft],
        page: { pageSize: 50, hasNextPage: false, nextCursor: null },
      },
    }),
  );
  await page.route(`**/pay-rate-versions/${draftId}`, (route) =>
    route.fulfill({ json: { ...draft, rows } }),
  );
  await page.route(
    `**/pay-rate-versions/${draftId}/calculation-policy`,
    async (route) => {
      if (route.request().method() === "PUT") {
        putBody = await route.request().postDataJSON();
        expect(route.request().headers()["idempotency-key"]).toBeTruthy();
        expect(route.request().headers()["x-csrf-token"]).toBe("csrf-rates");
        return route.fulfill({
          json: { ...policy, ...putBody, rowVersion: 4 },
        });
      }
      return route.fulfill({ json: policy });
    },
  );

  await page.goto("/rates");
  await page.getByRole("button", { name: "Aturan kalkulasi" }).click();
  await expect(page.getByLabel("Target PPM tetap")).toHaveValue("95");
  await page.getByLabel("Target PPM tetap").fill("100");
  await page.getByRole("button", { name: "Simpan aturan kalkulasi" }).click();
  await expect(page.getByRole("status")).toContainText("berhasil disimpan");
  expect(putBody).toMatchObject({
    expectedRowVersion: 3,
    targetPpmPolicy: { fixedTargetPpm: "100" },
  });
});

test("sub-menu kelompok mesin menambah mapping dan menyimpan batch dengan header kontrak", async ({
  page,
}) => {
  const versionId = "40000000-0000-4000-8000-000000000101";
  const version = {
    id: versionId,
    versionNo: 1,
    code: "STATION-2026-V1",
    name: "Mapping Mesin 2026",
    effectiveFrom: "2026-09-01",
    effectiveToExclusive: null,
    status: "DRAFT",
    changeNote: null,
    rowVersion: 2,
    createdBy: "Admin Karung",
    createdAt: "2026-08-20T01:00:00Z",
    approvedBy: null,
    approvedAt: null,
  };
  let batchBody: Record<string, unknown> | undefined;
  await page.route("**/station-group-versions?pageSize=50", (route) =>
    route.fulfill({
      json: {
        data: [version],
        page: { pageSize: 50, hasNextPage: false, nextCursor: null },
      },
    }),
  );
  await page.route(`**/station-group-versions/${versionId}`, (route) =>
    route.fulfill({
      json: {
        ...version,
        mappings: [
          {
            id: "50000000-0000-4000-8000-000000000101",
            rowVersion: 1,
            clientRowId: "existing-51",
            stationNo: 51,
            loomGroup: "REGULAR",
          },
        ],
      },
    }),
  );
  await page.route(
    `**/station-group-versions/${versionId}/mapping-batches`,
    async (route) => {
      batchBody = await route.request().postDataJSON();
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      expect(route.request().headers()["x-csrf-token"]).toBe("csrf-rates");
      return route.fulfill({
        json: {
          ...version,
          rowVersion: 3,
          mappings: (
            batchBody as { mappings: Array<Record<string, unknown>> }
          ).mappings.map((mapping, index) => ({
            ...mapping,
            id: `50000000-0000-4000-8000-00000000010${index + 2}`,
            rowVersion: 1,
          })),
        },
      });
    },
  );

  await page.goto("/rates");
  await page.getByRole("button", { name: "Kelompok mesin" }).click();
  await expect(
    page.getByRole("heading", { name: "Mapping Mesin 2026" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tambah mapping station" }).click();
  await page.getByLabel("Nomor station baru").fill("52");
  await page.getByLabel("Kelompok loom station 52").selectOption("CS");
  await page.getByRole("button", { name: "Simpan mapping station" }).click();
  await expect(page.getByRole("status")).toContainText("berhasil disimpan");
  expect(batchBody).toMatchObject({
    expectedRowVersion: 2,
    mappings: expect.arrayContaining([
      expect.objectContaining({ stationNo: 51, loomGroup: "REGULAR" }),
      expect.objectContaining({ stationNo: 52, loomGroup: "CS" }),
    ]),
  });
});

test("mapping station aktif bisa diedit langsung setelah konfirmasi dampak ke payroll", async ({
  page,
}) => {
  const versionId = "40000000-0000-4000-8000-000000000201";
  const version = {
    id: versionId,
    versionNo: 1,
    code: "SG-LEGACY-V1",
    name: "Mapping station dari Apps Script legacy",
    effectiveFrom: "2020-01-01",
    effectiveToExclusive: null,
    status: "ACTIVE",
    changeNote: null,
    rowVersion: 4,
    createdBy: "Admin Karung",
    createdAt: "2026-08-20T01:00:00Z",
    approvedBy: "Supervisor Karung",
    approvedAt: "2026-08-21T01:00:00Z",
  };
  const batches: Record<string, unknown>[] = [];
  let reject = true;
  await page.route("**/station-group-versions?pageSize=50", (route) =>
    route.fulfill({
      json: {
        data: [version],
        page: { pageSize: 50, hasNextPage: false, nextCursor: null },
      },
    }),
  );
  await page.route(`**/station-group-versions/${versionId}`, (route) =>
    route.fulfill({
      json: {
        ...version,
        mappings: [
          {
            id: "50000000-0000-4000-8000-000000000201",
            rowVersion: 1,
            clientRowId: "existing-1",
            stationNo: 1,
            loomGroup: "REGULAR",
          },
        ],
      },
    }),
  );
  await page.route(
    `**/station-group-versions/${versionId}/mapping-batches`,
    async (route) => {
      const body = (await route.request().postDataJSON()) as {
        mappings: Array<Record<string, unknown>>;
      };
      batches.push(body);
      if (reject) {
        reject = false;
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: "STATION_GROUP_LOCKED",
              message: "locked",
              requestId: "req-1",
            },
          },
        });
      }
      return route.fulfill({
        json: {
          ...version,
          rowVersion: 5,
          mappings: body.mappings.map((mapping) => ({
            ...mapping,
            id: "50000000-0000-4000-8000-000000000202",
            rowVersion: 1,
          })),
        },
      });
    },
  );

  await page.goto("/rates");
  await page.getByRole("button", { name: "Kelompok mesin" }).click();
  await expect(
    page.getByText("Mapping aktif dapat diedit langsung"),
  ).toBeVisible();
  const group = page.getByLabel("Kelompok loom station 1");
  await expect(group).toBeEnabled();
  await group.selectOption("CS");

  // Saving to a live version asks first, and says what it does to payroll.
  await page.getByRole("button", { name: "Simpan mapping station" }).click();
  const confirm = page.getByRole("alertdialog", {
    name: "Simpan mapping station ke versi aktif SG-LEGACY-V1?",
  });
  await expect(confirm).toContainText("harus di-generate ulang");
  expect(batches).toHaveLength(0);

  // A period already in a locked payroll is refused, and said so plainly.
  await confirm.getByRole("button", { name: "Simpan ke versi aktif" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "sudah dipakai payroll yang terkunci",
  );

  await page.getByRole("button", { name: "Simpan mapping station" }).click();
  await page.getByRole("button", { name: "Simpan ke versi aktif" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Mapping station aktif berhasil disimpan",
  );
  expect(batches[1]).toMatchObject({
    expectedRowVersion: 4,
    mappings: [expect.objectContaining({ stationNo: 1, loomGroup: "CS" })],
  });
});

import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { components } from "../src/api/generated/schema";

const entry: components["schemas"]["ProductionEntry"] = {
  id: "10000000-0000-4000-8000-000000000001",
  shiftStart: "2026-09-04T07:00:00+07:00",
  shiftEnd: "2026-09-04T15:00:00+07:00",
  stationNo: 51,
  pin: "8954",
  widthCm: "56",
  weftDensity: "10",
  resultMeter: "900",
  sourceType: "MANUAL",
  status: "ACTIVE",
  rowVersion: 3,
  createdAt: "2026-09-04T07:00:00+07:00",
  updatedAt: "2026-09-04T07:00:00+07:00",
};
const employee: components["schemas"]["Employee"] = {
  pin: "8954",
  fullName: "Operator Contoh",
  employmentStatus: "ACTIVE",
  updatedAt: entry.updatedAt,
};
const cursor = { pageSize: 100, hasNextPage: false, nextCursor: null };
type Period = components["schemas"]["PayrollPeriod"];
/**
 * Buku bulanan relatif terhadap bulan Jakarta hari ini, bukan tanggal tetap:
 * halaman memilih buku yang mencakup hari ini dan memperingatkan saat buku
 * berikutnya belum ada, jadi fixture bertanggal tetap akan mengubah isi layar
 * tergantung kapan suite dijalankan.
 */
function monthBook(offset: number, status: Period["status"]): Period {
  const now = new Date(Date.now() + 7 * 3_600_000);
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1),
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0),
  );
  const periodStart = start.toISOString().slice(0, 10);
  return {
    id: `40000000-0000-4000-8000-${String(offset + 100).padStart(12, "0")}`,
    code: `KARUNG-${periodStart.slice(0, 7)}`,
    periodStart,
    periodEnd: end.toISOString().slice(0, 10),
    departmentCode: "KARUNG",
    status,
    createdAt: `${periodStart}T08:00:00+07:00`,
    closedAt: status === "CLOSED" ? `${periodStart}T08:00:00+07:00` : null,
  };
}
/** Bulan lalu tutup, bulan ini dan bulan depan buka — tidak ada peringatan. */
const defaultPeriods = [
  monthBook(-1, "CLOSED"),
  monthBook(0, "OPEN"),
  monthBook(1, "OPEN"),
];
/**
 * The sheet's own canvas.
 *
 * Univer's formula bar draws its editor on a canvas as well, so ".manual-grid
 * canvas" now matches two elements and the first one in the DOM is the 27px
 * editor — clicking it hits nothing.
 */
const SHEET_CANVAS = '.manual-grid canvas[id^="univer-sheet-main-canvas"]';
/**
 * Vertical middle of sheet row N inside the canvas: Univer's own column header
 * is about 20px tall, and every row after it is the workbook's 34px.
 */
const rowY = (row: number) => 20 + row * 34 + 17;

const nativeDialogs: string[] = [];
test.afterEach(() => {
  const seen = nativeDialogs.splice(0);
  expect(seen, "dialog bawaan browser muncul").toEqual([]);
});

async function mock(
  page: Page,
  options: {
    write?: boolean;
    count?: number;
    periods?: Period[];
    /** Izin tambahan di luar izin produksi, mis. untuk kelola buku. */
    extraPermissions?: string[];
  } = {},
) {
  // Konfirmasi di aplikasi ini selalu modal milik halaman. Dialog bawaan
  // browser yang muncul berarti ada `window.confirm` yang lolos.
  page.on("dialog", (dialog) => {
    nativeDialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      json: {
        user: {
          userId: entry.id,
          hrisUserId: 1,
          email: "demo",
          displayName: "Admin Uji",
        },
        permissions: [
          ...(options.write === false
            ? ["bag.production.read"]
            : ["bag.production.read", "bag.production.write"]),
          ...(options.extraPermissions ?? []),
        ],
        roles: [],
        isSuperAdmin: false,
        expiresAt: "2099-01-01T00:00:00Z",
        csrfToken: "mock-csrf",
      },
    }),
  );
  await page.route("**/production-entries?*", (route) =>
    route.fulfill({
      json: {
        data: Array.from({ length: options.count ?? 1 }, (_, index) => ({
          ...entry,
          id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          stationNo: 51 + index,
        })),
        page: {
          ...cursor,
          // Empty result still reports the requested page capacity; OpenAPI
          // forbids pageSize 0 even when data is empty.
          pageSize: options.count === 0 ? 100 : (options.count ?? 100),
        },
        sourceRevision: "1",
      } satisfies components["schemas"]["ProductionEntryListResponse"],
    }),
  );
  await page.route("**/payroll-periods?*", (route) =>
    route.fulfill({
      json: {
        data: options.periods ?? defaultPeriods,
        page: { ...cursor, pageSize: 200 },
      } satisfies components["schemas"]["PayrollPeriodListResponse"],
    }),
  );
  // Every ref resolves: these tests exercise grid, paste, and save flows, not
  // identity resolution. A digit-only ref stays its own PIN so rows keep the
  // PIN they were written with.
  await page.route("**/employee-lookups", (route) => {
    const { refs } = route
      .request()
      .postDataJSON() as components["schemas"]["EmployeeLookupRequest"];
    return route.fulfill({
      json: {
        resolved: refs.map((ref) => ({
          ref,
          pin: /^\d+$/.test(ref) ? ref : employee.pin,
          fullName: employee.fullName,
          employmentStatus: employee.employmentStatus,
        })),
        unresolved: [],
      } satisfies components["schemas"]["EmployeeLookupResponse"],
    });
  });
  await page.route("**/employees/*", (route) =>
    route.fulfill({ json: employee }),
  );
  await page.route("**/employees?*", (route) =>
    route.fulfill({
      json: {
        data: [employee],
        page: cursor,
      } satisfies components["schemas"]["EmployeeListResponse"],
    }),
  );
  await page.route(`**/production-entries/${entry.id}`, (route) =>
    route.fulfill({ json: { ...entry, rowVersion: 4, resultMeter: "950" } }),
  );
}

test("assignee dapat dicari dan dipilih langsung dari sel grid", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mock(page);
  await page.goto("/manual-data");

  const canvas = page.locator(SHEET_CANVAS);
  await expect(canvas).toBeVisible({ timeout: 45_000 });
  // Assignee is the fifth visible sheet column after the row-number gutter.
  await canvas.click({ position: { x: 650, y: 75 } });

  const inlinePicker = page.locator(".manual-assignee-popover");
  await expect(inlinePicker).toBeVisible();
  await inlinePicker
    .getByRole("combobox", { name: "Cari assignee" })
    .fill("Operator");
  await inlinePicker.getByRole("option", { name: /Operator Contoh/ }).click();
  await expect(inlinePicker).not.toBeVisible();

  await page.getByRole("button", { name: "Edit baris" }).click();
  await expect(page.getByLabel("Edit Assignee", { exact: true })).toHaveValue(
    "Operator Contoh · 8954",
  );
});

test("grid, checkbox, assignee search, paste dan batch save mengikuti kontrak", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await mock(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/production-entry-batches", async (route) => {
    const body = route
      .request()
      .postDataJSON() as components["schemas"]["ProductionEntryBatchRequest"];
    expect(route.request().headers()["x-csrf-token"]).toBe("mock-csrf");
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0]).toMatchObject({
      expectedRowVersion: 3,
      pin: "8954",
      resultMeter: "0",
    });
    expect(body.rows[1]).toMatchObject({
      shiftStart: "2026-09-04T07:00:00+07:00",
      shiftEnd: "2026-09-04T15:00:00+07:00",
    });
    await route.fulfill({
      json: {
        batchId: entry.id,
        sourceRevision: "2",
        counts: { inserted: 1, updated: 1, unchanged: 0, rejected: 0 },
        rows: body.rows.map((row, index) => ({
          clientRowId: row.clientRowId,
          productionEntryId:
            index === 0 ? entry.id : "10000000-0000-4000-8000-000000000002",
          rowVersion: 4,
          outcome: index === 0 ? "UPDATED" : "INSERTED",
        })),
      } satisfies components["schemas"]["ProductionEntryBatchResult"],
    });
  });
  await page.goto("/manual-data");
  await page.getByRole("button", { name: "Edit baris" }).click();
  await expect(page.getByLabel("Edit Result [m]", { exact: true })).toHaveValue(
    "900",
    { timeout: 45000 },
  );
  await page.locator(".manual-grid").scrollIntoViewIfNeeded();
  await expect(page.locator(SHEET_CANVAS)).toBeVisible();
  await page.locator(SHEET_CANVAS).click({ position: { x: 75, y: 75 } });
  await expect(
    page.getByLabel("Pilih baris aktif", { exact: true }),
  ).toBeChecked();
  await page.getByLabel("Pilih baris aktif", { exact: true }).uncheck();
  await page.getByLabel("Pilih baris aktif", { exact: true }).check();
  await expect(
    page.getByRole("button", { name: "Salin baris (1)" }),
  ).toBeEnabled();
  await page.getByLabel("Edit Result [m]", { exact: true }).fill("0");
  await page.getByRole("combobox", { name: "Cari assignee" }).fill("Operator");
  await page.getByRole("option", { name: /Operator Contoh/ }).click();
  await page.getByRole("button", { name: "Tempel data", exact: true }).click();
  await page.getByLabel("Baris tujuan").fill("2");
  await page
    .getByLabel("Isi clipboard (TSV)")
    .fill("46269.291666666664\t46269.625\t52\t8954\t56\t10\t910");
  await page
    .getByRole("button", { name: "Validasi & terapkan ke draft" })
    .click();
  await expect(
    page.getByText("2 tanggal/jam diformat otomatis.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "1 ditambahkan" }),
  ).toBeVisible();
  await expect(page.getByText(/Tidak ada perubahan/)).toBeVisible();
  expect(errors).toEqual([]);
  const accessibility = await new AxeBuilder({ page })
    .include(".manual-page")
    .exclude(".manual-grid-viewport")
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({
    path: "test-results/manual-data-desktop.png",
    fullPage: true,
  });
});

test("impor CSV masuk sebagai draft lalu tersimpan lewat batch yang sama", async ({
  page,
}) => {
  await mock(page);
  const requests: unknown[] = [];
  await page.route("**/production-entry-batches", async (route) => {
    const body = route
      .request()
      .postDataJSON() as components["schemas"]["ProductionEntryBatchRequest"];
    requests.push(body);

    await route.fulfill({
      json: {
        batchId: "30000000-0000-4000-8000-000000000001",
        counts: { inserted: 1, updated: 0, unchanged: 0, rejected: 0 },
        sourceRevision: "9",
        // clientRowId dipantulkan balik: itu yang dipakai UI memetakan hasil ke
        // baris grid, dan menebaknya membuat respons terbaca tidak lengkap.
        rows: body.rows.map((row) => ({
          clientRowId: row.clientRowId,
          outcome: "INSERTED" as const,
          productionEntryId: "10000000-0000-4000-8000-000000000009",
          rowVersion: 1,
          fieldErrors: [],
        })),
      } satisfies components["schemas"]["ProductionEntryBatchResult"],
    });
  });

  await page.goto("/manual-data");
  // Impor butuh grid siap: tombolnya nonaktif sampai engine spreadsheet selesai
  // dimuat, dan file yang dipasang sebelum itu tidak akan terbaca.
  await expect(page.getByRole("button", { name: "Impor file" })).toBeEnabled({
    timeout: 45000,
  });

  // Header sengaja ditulis dengan urutan lain dan pemisah titik koma: file
  // nyata dari Excel Indonesia terlihat persis seperti ini.
  await page.locator('input[type="file"]').setInputFiles({
    name: "produksi-4-sep.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Station;Shift Start;Shift End;PIN;Weft;Width;Result;Catatan\n" +
        "53;2026-09-05 07:00;2026-09-05 15:00;8954;10;56;915;cek ulang\n",
    ),
  });

  await expect(
    page.getByText("1 baris dibaca dari produksi-4-sep.csv", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Kolom diabaikan: Catatan", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Preview impor · produksi-4-sep.csv/ }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/manual-data-import-preview.png",
    fullPage: true,
  });

  await page
    .getByRole("button", { name: "Validasi & terapkan ke draft" })
    .click();
  await expect(
    page.getByText("dari produksi-4-sep.csv diimpor ke draft", {
      exact: false,
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "1 ditambahkan" }),
  ).toBeVisible();

  // Kolom yang tertukar di file harus mendarat di field yang benar.
  expect(requests).toHaveLength(1);
  expect(
    (requests[0] as { rows: Record<string, unknown>[] }).rows[0],
  ).toMatchObject({
    shiftStart: "2026-09-05T07:00:00+07:00",
    shiftEnd: "2026-09-05T15:00:00+07:00",
    stationNo: 53,
    pin: "8954",
    widthCm: "56",
    weftDensity: "10",
    resultMeter: "915",
  });
});

test("file besar diimpor langsung ke server per batch, tanpa batas baris workspace", async ({
  page,
}) => {
  await mock(page);

  const batches: number[] = [];
  const keys = new Set<string>();
  await page.route("**/production-entry-batches", async (route) => {
    const body = route
      .request()
      .postDataJSON() as components["schemas"]["ProductionEntryBatchRequest"];
    batches.push(body.rows.length);
    keys.add(route.request().headers()["idempotency-key"] ?? "");

    await route.fulfill({
      json: {
        batchId: "30000000-0000-4000-8000-000000000002",
        sourceRevision: "12",
        counts: {
          inserted: body.rows.length,
          updated: 0,
          unchanged: 0,
          rejected: 0,
        },
        rows: body.rows.map((row) => ({
          clientRowId: row.clientRowId,
          outcome: "INSERTED" as const,
          productionEntryId: "10000000-0000-4000-8000-00000000000a",
          rowVersion: 1,
          fieldErrors: [],
        })),
      } satisfies components["schemas"]["ProductionEntryBatchResult"],
    });
  });

  await page.goto("/manual-data");
  await expect(page.getByRole("button", { name: "Impor file" })).toBeEnabled({
    timeout: 45000,
  });

  // Di atas kapasitas grid 10.000 baris, jadi file ini memang tidak bisa
  // lewat workspace — dan cukup untuk memaksa lebih dari satu batch.
  const rows = 12_000;
  const csv = [
    "Shift Start,Shift End,Station,Assignee,Width [cm],Weft [s/in],Result [m]",
    // Kunci unik (shift start, shift end, station) harus benar-benar unik:
    // pengulangan akan ditolak dedupe, dan itu diuji terpisah.
    ...Array.from({ length: rows }, (_, i) => {
      const day = String((i % 28) + 1).padStart(2, "0");
      const station = Math.floor(i / 28) + 1;
      return `2026-09-${day} 07:00,2026-09-${day} 15:00,${station},8954,56,10,982`;
    }),
  ].join("\n");

  await page.locator('input[type="file"]').setInputFiles({
    name: "produksi-sebulan.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });

  await expect(
    page.getByRole("heading", {
      name: /Impor langsung · produksi-sebulan.csv/,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Kirim ke server" }).click();

  const summary = page.getByRole("status").filter({ hasText: "Selesai." });
  await expect(summary).toBeVisible({ timeout: 30000 });
  await expect(summary).toContainText("12.000 ditambahkan");
  await expect(summary).toContainText("12.000 baris");
  await page.screenshot({
    path: "test-results/manual-data-bulk-import.png",
    fullPage: true,
  });

  expect(batches.reduce((total, size) => total + size, 0)).toBe(rows);
  expect(batches.length).toBeGreaterThan(1);
  // Satu key per batch: key yang sama dengan payload berbeda dijawab 409.
  expect(keys.size).toBe(batches.length);
});

test("grid berkapasitas besar tetap responsif dan menerima ribuan baris", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await mock(page);

  const started = Date.now();
  await page.goto("/manual-data");
  await expect(page.getByRole("button", { name: "Impor file" })).toBeEnabled({
    timeout: 45000,
  });
  const ready = Date.now() - started;

  // Kapasitas 100.000 baris tidak boleh dibayar saat halaman dibuka: cellData
  // Univer sparse, dan pemindaian kita berhenti di baris yang tersentuh.
  expect(ready).toBeLessThan(20_000);
  await expect(page.getByText("kapasitas draft 10.000")).toBeVisible();

  const rows = 5_000;
  const tsv = Array.from({ length: rows }, (_, i) => {
    const day = String((i % 28) + 1).padStart(2, "0");
    return `2026-10-${day} 07:00\t2026-10-${day} 15:00\t${(i % 900) + 1}\t8954\t56\t10\t982`;
  }).join("\n");

  await page.getByRole("button", { name: "Tempel data", exact: true }).click();
  await page.getByLabel("Baris tujuan").fill("2");
  await page.getByLabel("Isi clipboard (TSV)").fill(tsv);

  const pasteStarted = Date.now();
  await page
    .getByRole("button", { name: "Validasi & terapkan ke draft" })
    .click();
  await expect(
    page.getByText(`${rows.toLocaleString("id-ID")} baris ditempel ke draft`, {
      exact: false,
    }),
  ).toBeVisible({ timeout: 60_000 });
  const pasteMs = Date.now() - pasteStarted;

  await expect(
    page.getByText("5.001 baris terisi", { exact: false }),
  ).toBeVisible();
  // Bukan benchmark presisi; penjaga supaya tidak ada langkah kuadratik yang
  // lolos dan membuat tempel besar berhenti sama sekali.
  expect(pasteMs).toBeLessThan(45_000);
  console.log(`grid siap ${ready} ms · tempel ${rows} baris ${pasteMs} ms`);

  // Grid harus tetap bisa dipakai setelahnya: melompat ke baris jauh dan
  // membaca isinya lewat editor baris.
  await page.getByRole("button", { name: "Edit baris" }).click();
  await page.getByRole("spinbutton", { name: "Baris aktif" }).fill("4000");
  await expect(page.getByLabel("Edit Station", { exact: true })).toHaveValue(
    String(((4000 - 2) % 900) + 1),
    { timeout: 15_000 },
  );
  await page.screenshot({
    path: "test-results/manual-data-large-grid.png",
    fullPage: true,
  });
});

test("impor file yang rusak menolak tanpa menyentuh draft", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/manual-data");
  // Impor butuh grid siap: tombolnya nonaktif sampai engine spreadsheet selesai
  // dimuat, dan file yang dipasang sebelum itu tidak akan terbaca.
  await expect(page.getByRole("button", { name: "Impor file" })).toBeEnabled({
    timeout: 45000,
  });

  await page.locator('input[type="file"]').setInputFiles({
    name: "kelebihan-kolom.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "2026-09-05 07:00,2026-09-05 15:00,53,8954,56,10,915,x\n",
    ),
  });

  await expect(page.getByText("7 kolom", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Preview impor/ }),
  ).toBeHidden();
  await expect(page.getByText(/Tidak ada perubahan/)).toBeVisible();
});

test("penolakan versi mempertahankan draft dan bisa dibandingkan", async ({
  page,
}) => {
  await mock(page);
  await page.route("**/production-entry-batches", (route) =>
    route.fulfill({
      status: 409,
      json: {
        error: {
          code: "ROW_VERSION_CONFLICT",
          message: "Versi baris berubah.",
        },
      },
    }),
  );
  await page.goto("/manual-data");
  await page.getByRole("button", { name: "Edit baris" }).click();
  const result = page.getByLabel("Edit Result [m]", { exact: true });
  await expect(result).toHaveValue("900", { timeout: 45000 });
  await result.fill("1000");
  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(page.getByText(/Versi baris berubah/)).toBeVisible();
  await expect(result).toHaveValue("1000");
  await page
    .getByRole("button", { name: "Bandingkan baris aktif dengan server" })
    .click();
  await expect(
    page.getByRole("region", { name: "Perbandingan versi" }),
  ).toContainText("950");
});

test("readonly, layout empat viewport dan DOM dibatasi untuk 500 baris", async ({
  page,
}) => {
  await mock(page, { write: false, count: 500 });
  await page.goto("/manual-data");
  await page.getByRole("button", { name: "Edit baris" }).click();
  await expect(page.getByLabel("Edit Result [m]", { exact: true })).toHaveValue(
    "900",
    { timeout: 45000 },
  );
  await expect(
    page.getByRole("button", { name: "Simpan perubahan" }),
  ).toBeDisabled();
  const nodes = await page.locator("*").count();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: `test-results/manual-data-${width}.png`,
      fullPage: true,
    });
  }
  const before = await page.locator("*").count();
  await page.locator(".manual-grid").hover();
  await page.mouse.wheel(0, 12000);
  expect(await page.locator("*").count()).toBeLessThan(before + 100);
  expect(nodes).toBeLessThan(2000);
  test.info().annotations.push({
    type: "performance",
    description: `500 rows: ${nodes} DOM nodes; bounded page, canvas rendering.`,
  });
});

test("workspace memaksimalkan lebar dan tinggi viewport desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mock(page);
  await page.goto("/manual-data");
  await expect(page.locator(SHEET_CANVAS)).toBeVisible({
    timeout: 45000,
  });

  const workspace = await page.locator(".manual-workspace").boundingBox();
  const grid = await page.locator(".manual-grid").boundingBox();

  expect(workspace).not.toBeNull();
  expect(grid).not.toBeNull();
  expect(workspace?.x).toBeLessThanOrEqual(12);
  expect(workspace?.width).toBeGreaterThanOrEqual(1416);
  expect(grid?.height).toBeGreaterThanOrEqual(600);
});

test("tampilan utama sederhana dan langsung berfokus pada grid", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mock(page);
  await page.goto("/manual-data");
  await expect(page.locator(SHEET_CANVAS)).toBeVisible({
    timeout: 45000,
  });
  await expect(
    page.getByText("sheets-ui.info.forceStringInfo", { exact: false }),
  ).toHaveCount(0);

  const appHeader = await page
    .locator("body > div > div > header")
    .boundingBox();
  const grid = await page.locator(".manual-grid").boundingBox();

  expect(appHeader?.height).toBeLessThanOrEqual(56);
  expect(grid?.y).toBeLessThanOrEqual(300);
  await expect(page.getByText("Sistem siap", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Admin Karung", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit baris" })).toBeVisible();
  await expect(page.getByLabel("Edit Result [m]", { exact: true })).toHaveCount(
    0,
  );

  await page.getByRole("button", { name: "Edit baris" }).click();
  await expect(page.getByLabel("Edit Result [m]", { exact: true })).toHaveValue(
    "900",
  );
});

test("kontrol desktop rapat dan Univer memenuhi lebar browser", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mock(page);
  await page.goto("/manual-data");
  await expect(page.locator(SHEET_CANVAS)).toBeVisible({
    timeout: 45000,
  });

  const layout = await page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>(".manual-workspace");
    const grid = document.querySelector<HTMLElement>(".manual-grid");
    const toolbar = document.querySelector<HTMLElement>(".manual-toolbar");
    const button = document.querySelector<HTMLElement>(
      ".manual-toolbar .manual-btn",
    );

    if (!workspace || !grid || !toolbar || !button) {
      throw new Error("Elemen workspace Manual Data tidak lengkap.");
    }

    const workspaceRect = workspace.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    const side = document.querySelector<HTMLElement>(".manual-split-side");
    const sideRect = side?.getBoundingClientRect();
    const viewport = document.querySelector<HTMLElement>(
      ".manual-grid-viewport",
    );

    return {
      buttonHeight: button.getBoundingClientRect().height,
      toolbarGap: Number.parseFloat(getComputedStyle(toolbar).gap),
      workspaceLeft: workspaceRect.left,
      workspaceRightGap:
        document.documentElement.clientWidth - workspaceRect.right,
      gridLeft: gridRect.left,
      gridRight: gridRect.right,
      sideLeft: sideRect?.left ?? 0,
      sideRight: sideRect?.right ?? 0,
      gridScrollsSideways: viewport
        ? viewport.scrollWidth > viewport.clientWidth + 1
        : true,
    };
  });

  expect(layout.buttonHeight).toBeLessThanOrEqual(30);
  expect(layout.toolbarGap).toBeLessThanOrEqual(3);
  expect(layout.workspaceLeft).toBeLessThanOrEqual(1);
  expect(layout.workspaceRightGap).toBeLessThanOrEqual(1);
  // Two columns with no gap between them and none at the page edges: the
  // grid owns everything left of the control column.
  expect(layout.gridLeft).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.sideLeft - layout.gridRight)).toBeLessThanOrEqual(2);
  expect(layout.sideRight).toBeGreaterThanOrEqual(1278);
  // All seven columns fit at 1280px: no sideways scroll inside the grid.
  expect(layout.gridScrollsSideways).toBe(false);
});

/**
 * Univer's right-click menu is the spreadsheet reflex people bring with them,
 * so it is on — but this sheet's row identity is its position, and a saved row
 * belongs to the audit trail. These two tests pin both halves of that.
 */
test("klik kanan menyisipkan baris dan membawa serta identitas baris tersimpan", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await mock(page);
  await page.goto("/manual-data");
  const canvas = page.locator(SHEET_CANVAS);
  await expect(canvas).toBeVisible({ timeout: 45_000 });
  await page.getByRole("button", { name: "Edit baris" }).click();
  const station = page.getByLabel("Edit Station", { exact: true });

  // Sheet row 1 holds the saved entry; the station of a saved row is part of
  // its unique key, so the editor shows it disabled.
  await canvas.click({ position: { x: 200, y: rowY(1) } });
  await expect(station).toHaveValue("51");
  await expect(station).toBeDisabled();

  await canvas.click({ position: { x: 20, y: rowY(1) }, button: "right" });
  const menu = page.locator("section.univer-popup");
  await expect(menu).toBeVisible();
  // Clicked near the edge of the item, not at its centre: the entry carries
  // its own row-count input and a click in the middle lands in that field
  // instead of running the command.
  await menu
    .locator("button", { hasText: "rows above" })
    .first()
    .click({ position: { x: 8, y: 8 } });
  // The item keeps its input open, so the menu stays up after the command.
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // The saved row moved down a row and is still recognised as saved there.
  await canvas.click({ position: { x: 200, y: rowY(2) } });
  await expect(station).toHaveValue("51");
  await expect(station).toBeDisabled();
  // The row it left behind is an ordinary empty draft.
  await canvas.click({ position: { x: 200, y: rowY(1) } });
  await expect(station).toHaveValue("");
  await expect(station).toBeEnabled();
});

test("klik kanan menolak menghapus baris yang sudah tersimpan", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await mock(page);
  await page.goto("/manual-data");
  const canvas = page.locator(SHEET_CANVAS);
  await expect(canvas).toBeVisible({ timeout: 45_000 });

  await canvas.click({ position: { x: 20, y: rowY(1) }, button: "right" });
  const menu = page.locator("section.univer-popup");
  await expect(menu).toBeVisible();
  await menu.getByText("Delete Selected Row").click();

  await expect(
    page.getByRole("alert").filter({ hasText: "tidak bisa dihapus dari grid" }),
  ).toBeVisible();
  // Still there, still saved.
  await page.getByRole("button", { name: "Edit baris" }).click();
  await canvas.click({ position: { x: 200, y: rowY(1) } });
  await expect(page.getByLabel("Edit Station", { exact: true })).toHaveValue(
    "51",
  );
});

test("tempel dari klik kanan masuk ke panel pratinjau, bukan langsung ke sel", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 950 });
  await mock(page);
  await page.goto("/manual-data");
  const canvas = page.locator(SHEET_CANVAS);
  await expect(canvas).toBeVisible({ timeout: 45_000 });
  await page.evaluate(() =>
    navigator.clipboard.writeText(
      "2026-09-05 07:00:00\t2026-09-05 15:00:00\t52\t8954\t56\t10\t910",
    ),
  );

  await canvas.click({ position: { x: 200, y: rowY(2) } });
  await canvas.click({ position: { x: 200, y: rowY(2) }, button: "right" });
  const menu = page.locator("section.univer-popup");
  await expect(menu).toBeVisible();
  await menu.getByText("Paste", { exact: true }).click();

  // The clipboard text lands in the preview that normalises it, not in the
  // cells: that panel is the only path that fixes decimal commas and
  // single-digit hours and resolves an EID to a PIN.
  await expect(page.getByLabel("Isi clipboard (TSV)")).toHaveValue(
    /2026-09-05 07:00:00/,
  );
});

test("hapus baris hanya membuang draft terpilih dan melindungi data tersimpan", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/manual-data");
  await page.getByRole("button", { name: "Edit baris" }).click();
  const station = page.getByLabel("Edit Station", { exact: true });
  const selected = page.getByLabel("Pilih baris aktif", { exact: true });
  await expect(station).toHaveValue("51", { timeout: 45000 });

  await selected.check();
  await page.getByRole("button", { name: "Hapus baris" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "tersimpan tidak dihapus" }),
  ).toBeVisible();
  await expect(station).toHaveValue("51");

  await selected.uncheck();
  await page.getByRole("button", { name: "Tambah baris" }).click();
  await expect(station).toHaveValue("");
  await station.fill("99");
  await selected.check();
  await page.getByRole("button", { name: "Hapus baris" }).click();
  await page
    .getByRole("dialog", { name: "Hapus 1 baris draft?" })
    .getByRole("button", { name: "Hapus 1 baris" })
    .click();

  await expect(
    page.getByRole("status").filter({ hasText: "1 baris draft dihapus" }),
  ).toBeVisible();
  await expect(station).toHaveValue("");
  await expect(selected).not.toBeChecked();
  await expect(
    page.getByText("1 baris terisi", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Tidak ada perubahan", { exact: false }),
  ).toBeVisible();
});

test("grid kosong: isi lewat editor, simpan, dan feedback terlihat di samping Simpan", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await mock(page, { count: 0 });
  const posted: components["schemas"]["ProductionEntryBatchRequest"][] = [];
  await page.route("**/production-entry-batches", async (route) => {
    const body = route
      .request()
      .postDataJSON() as components["schemas"]["ProductionEntryBatchRequest"];
    posted.push(body);
    await route.fulfill({
      json: {
        batchId: "20000000-0000-4000-8000-000000000001",
        sourceRevision: "2",
        counts: { inserted: 1, updated: 0, unchanged: 0, rejected: 0 },
        rows: [
          {
            clientRowId: body.rows[0]!.clientRowId,
            productionEntryId: "30000000-0000-4000-8000-000000000001",
            rowVersion: 1,
            outcome: "INSERTED",
          },
        ],
      } satisfies components["schemas"]["ProductionEntryBatchResult"],
    });
  });
  await page.goto("/manual-data");
  await page.getByRole("button", { name: "Edit baris" }).click();
  const result = page.getByLabel("Edit Result [m]", { exact: true });
  await expect(result).toBeVisible({ timeout: 45000 });

  // Filled back to back on purpose: the editor used to write the row as the
  // previous render read it, so quick edits dropped each other's cells and the
  // save then failed validation instead of sending anything.
  await page
    .getByLabel("Edit Shift Start", { exact: true })
    .fill("2026-09-04T07:00");
  await page
    .getByLabel("Edit Shift End", { exact: true })
    .fill("2026-09-04T15:00");
  await page.getByLabel("Edit Station", { exact: true }).fill("51");
  await page.getByRole("combobox", { name: "Cari assignee" }).fill("Operator");
  await page.getByRole("option", { name: /Operator Contoh/ }).click();
  await page.getByLabel("Edit Width [cm]", { exact: true }).fill("56");
  await page.getByLabel("Edit Weft [s/in]", { exact: true }).fill("10");
  await result.fill("982");

  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  const notice = page.getByRole("status").filter({ hasText: "1 ditambahkan" });
  await expect(notice).toBeVisible();
  expect(posted).toHaveLength(1);
  expect(posted[0]!.rows[0]).toMatchObject({ pin: "8954", resultMeter: "982" });
  expect(posted[0]!.rows[0]!.expectedRowVersion).toBeUndefined();

  // Feedback sits next to the button that caused it — in the control column,
  // right under Simpan — and fully on screen. A message below the grid (the
  // old failure) read as "the button did nothing".
  const noticeBox = await notice.boundingBox();
  const saveBox = await page
    .getByRole("button", { name: "Simpan perubahan" })
    .boundingBox();
  const gridBox = await page.locator(".manual-grid").boundingBox();
  const viewport = page.viewportSize()!;
  expect(noticeBox!.x).toBeGreaterThanOrEqual(gridBox!.x + gridBox!.width - 2);
  expect(noticeBox!.y).toBeGreaterThan(saveBox!.y);
  expect(noticeBox!.y - (saveBox!.y + saveBox!.height)).toBeLessThan(80);
  expect(noticeBox!.y + noticeBox!.height).toBeLessThanOrEqual(viewport.height);
});

test("admin membatalkan satu data tersimpan dengan alasan dan idempotency", async ({
  page,
}) => {
  await mock(page);
  let voidRequestCount = 0;
  await page.route("**/production-entries/*/voids", async (route) => {
    voidRequestCount++;
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-csrf-token"]).toBe("mock-csrf");
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    expect(route.request().postDataJSON()).toEqual({
      expectedRowVersion: 3,
      reason: "Salah memasukkan hasil produksi",
    });
    await route.fulfill({
      json: {
        ...entry,
        status: "VOID",
        rowVersion: 4,
      } satisfies components["schemas"]["ProductionEntry"],
    });
  });

  await page.goto("/manual-data");
  await page.getByRole("button", { name: "Edit baris" }).click();
  await expect(page.getByLabel("Edit Result [m]", { exact: true })).toHaveValue(
    "900",
    { timeout: 45000 },
  );
  await page.getByLabel("Pilih baris aktif", { exact: true }).check();
  await page.getByRole("button", { name: "Batalkan data" }).click();

  const dialog = page.getByRole("dialog", { name: "Batalkan data produksi" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Mesin 51");
  const reason = dialog.getByLabel("Alasan pembatalan");
  await expect(reason).toBeFocused();
  const accessibility = await new AxeBuilder({ page })
    .include(".manual-dialog")
    .analyze();
  expect(accessibility.violations).toEqual([]);
  const confirm = dialog.getByRole("button", { name: "Ya, batalkan data" });
  await reason.fill("Sala");
  await expect(confirm).toBeDisabled();
  await reason.fill("Salah memasukkan hasil produksi");
  await confirm.click();

  await expect(
    page.getByRole("status").filter({ hasText: "berhasil dibatalkan" }),
  ).toBeVisible();
  expect(voidRequestCount).toBe(1);
});

test("buku CLOSED menonaktifkan seluruh aksi tulis", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mock(page);
  await page.goto("/manual-data");
  const saveButton = page.getByRole("button", { name: "Simpan perubahan" });
  await expect(saveButton).toBeEnabled({ timeout: 45_000 });

  const closed = defaultPeriods[0]!;
  await page.getByLabel("Buku periode").selectOption(closed.id);

  await expect(
    page.getByText(`Buku periode ${closed.code}`, { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".manual-period-closed")).toHaveText("Tutup");
  for (const name of [
    "Simpan perubahan",
    "Tambah baris",
    "Tempel data",
    "Impor file",
    "Batalkan data",
  ])
    await expect(page.getByRole("button", { name })).toBeDisabled();
});

test("memilih buku memuat hanya rentang buku itu", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mock(page);
  const requested: URL[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/production-entries?"))
      requested.push(new URL(request.url()));
  });
  await page.goto("/manual-data");
  await expect(
    page.getByRole("button", { name: "Simpan perubahan" }),
  ).toBeEnabled({ timeout: 45_000 });

  // Default: buku yang mencakup hari ini.
  const current = defaultPeriods[1]!;
  expect(requested.at(-1)?.searchParams.get("startAt")).toBe(
    `${current.periodStart}T00:00:00+07:00`,
  );

  const next = defaultPeriods[2]!;
  await page.getByLabel("Buku periode").selectOption(next.id);
  await expect
    .poll(() => requested.at(-1)?.searchParams.get("startAt"))
    .toBe(`${next.periodStart}T00:00:00+07:00`);
  expect(requested.at(-1)?.searchParams.get("endAt")).toBe(
    `${next.periodEnd}T23:59:59.999+07:00`,
  );
});

test("pindah buku dengan draft belum tersimpan meminta konfirmasi", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mock(page);
  await page.goto("/manual-data");
  await page.getByRole("button", { name: "Edit baris" }).click();
  const result = page.getByLabel("Edit Result [m]", { exact: true });
  await expect(result).toHaveValue("900", { timeout: 45_000 });
  await result.fill("950");
  // The dirty flag reaches the page through the workspace's status callback;
  // picking a book before it lands would switch without asking.
  await expect(page.getByText("Ada draft belum disimpan")).toBeVisible();

  const select = page.getByLabel("Buku periode");
  const current = defaultPeriods[1]!;
  const next = defaultPeriods[2]!;

  const ask = page.getByRole("dialog", {
    name: "Pindah buku dan buang draft?",
  });
  await select.selectOption(next.id);
  await expect(ask).toContainText("belum disimpan");
  await ask.getByRole("button", { name: "Kembali" }).click();
  await expect(ask).toBeHidden();
  await expect(select).toHaveValue(current.id);

  await select.selectOption(next.id);
  await ask.getByRole("button", { name: "Buang draft dan pindah" }).click();
  await expect(select).toHaveValue(next.id);
});

test("buku lampau boleh dibuka tanpa didesak membuat buku hari ini", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mock(page, { periods: [monthBook(-1, "CLOSED")] });
  await page.goto("/manual-data");
  // Tanpa buku hari ini, layar jatuh ke buku terbaru — yang tutup.
  await expect(page.locator(".manual-period-closed")).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.locator(".manual-period-warning")).toHaveCount(0);
});

test("tanpa buku: buat buku pertama dari layar lalu langsung terbuka", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const periods: Period[] = [];
  await mock(page, {
    periods,
    extraPermissions: ["bag.payroll.generate", "bag.payroll.lock"],
  });
  const listed: URL[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      request.url().includes("/payroll-periods?")
    )
      listed.push(new URL(request.url()));
  });
  const created: components["schemas"]["CreatePayrollPeriodRequest"][] = [];
  await page.route("**/payroll-periods", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    expect(route.request().headers()["x-csrf-token"]).toBe("mock-csrf");
    const body = route
      .request()
      .postDataJSON() as components["schemas"]["CreatePayrollPeriodRequest"];
    created.push(body);
    const period: Period = {
      ...monthBook(0, "OPEN"),
      code: body.code,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      departmentCode: body.departmentCode,
    };
    periods.push(period);
    await route.fulfill({ status: 201, json: period });
  });

  await page.goto("/manual-data");
  await expect(page.getByText("Belum ada buku periode.")).toBeVisible({
    timeout: 45_000,
  });
  // Daftar buku hanya buku departemen produksi.
  expect(listed.at(-1)?.searchParams.get("departmentCode")).toBe("KARUNG");

  await page.getByRole("button", { name: "Buat buku pertama" }).click();
  const dialog = page.getByRole("dialog", { name: "Buat buku periode" });
  const expected = monthBook(0, "OPEN");
  await expect(dialog.getByLabel("Kode buku")).toHaveValue(expected.code);
  await expect(dialog.getByLabel("Tanggal mulai")).toHaveValue(
    expected.periodStart,
  );
  await expect(dialog.getByLabel("Tanggal akhir")).toHaveValue(
    expected.periodEnd,
  );
  await dialog.getByRole("button", { name: "Buat buku" }).click();

  await expect(dialog).not.toBeVisible();
  expect(created).toEqual([
    {
      code: expected.code,
      periodStart: expected.periodStart,
      periodEnd: expected.periodEnd,
      departmentCode: "KARUNG",
    },
  ]);
  await expect(page.getByLabel("Buku periode")).toHaveValue(expected.id);
  await expect(
    page.getByRole("button", { name: "Simpan perubahan" }),
  ).toBeEnabled({ timeout: 45_000 });
});

test("tutup buku meminta konfirmasi lalu membuat grid baca saja", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const periods = defaultPeriods.map((period) => ({ ...period }));
  await mock(page, {
    periods,
    extraPermissions: ["bag.payroll.generate", "bag.payroll.lock"],
  });
  const current = periods[1]!;
  let closures = 0;
  await page.route(`**/payroll-periods/${current.id}/closures`, (route) => {
    closures += 1;
    expect(route.request().headers()["x-csrf-token"]).toBe("mock-csrf");
    current.status = "CLOSED";
    current.closedAt = "2026-09-30T17:00:00+07:00";
    return route.fulfill({ json: current });
  });

  await page.goto("/manual-data");
  const saveButton = page.getByRole("button", { name: "Simpan perubahan" });
  await expect(saveButton).toBeEnabled({ timeout: 45_000 });

  await page.getByRole("button", { name: "Tutup buku" }).click();
  const dialog = page.getByRole("dialog", {
    name: `Tutup buku ${current.code}`,
  });
  const confirm = dialog.getByRole("button", {
    name: `Tutup buku ${current.code}`,
  });
  // Aksi yang tidak bisa dibatalkan menunggu pernyataan eksplisit.
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/tidak bisa dibuka kembali/).check();
  await confirm.click();

  await expect(dialog).not.toBeVisible();
  expect(closures).toBe(1);
  await expect(page.locator(".manual-period-closed")).toHaveText("Tutup");
  await expect(saveButton).toBeDisabled();
  await expect(page.getByRole("button", { name: "Tutup buku" })).toHaveCount(0);
});

test("tanpa izin payroll, tombol kelola buku tidak tampil", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mock(page);
  await page.goto("/manual-data");
  await expect(
    page.getByRole("button", { name: "Simpan perubahan" }),
  ).toBeEnabled({ timeout: 45_000 });
  await expect(page.getByRole("button", { name: "Buat buku" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tutup buku" })).toHaveCount(0);
});

test("buku yang terakhir dibuka tetap terbuka setelah reload dan pindah menu", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mock(page);
  await page.goto("/manual-data");
  const select = page.getByLabel("Buku periode");
  const current = defaultPeriods[1]!;
  const previous = defaultPeriods[0]!;
  // Tanpa riwayat: buku yang mencakup hari ini.
  await expect(select).toHaveValue(current.id, { timeout: 45_000 });

  await select.selectOption(previous.id);
  await expect(select).toHaveValue(previous.id);

  await page.reload();
  await expect(select).toHaveValue(previous.id, { timeout: 45_000 });
  await expect(page.locator(".manual-period-closed")).toHaveText("Tutup");

  await page.getByRole("link", { name: "Detail" }).click();
  await page.getByRole("link", { name: "Manual Data" }).click();
  await expect(select).toHaveValue(previous.id, { timeout: 45_000 });
});

test("template Excel diimpor langsung ke grid lalu tersimpan", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mock(page, { count: 0 });
  const posted: components["schemas"]["ProductionEntryBatchRequest"][] = [];
  await page.route("**/production-entry-batches", async (route) => {
    const body = route
      .request()
      .postDataJSON() as components["schemas"]["ProductionEntryBatchRequest"];
    posted.push(body);
    await route.fulfill({
      json: {
        batchId: "20000000-0000-4000-8000-000000000001",
        sourceRevision: "2",
        counts: {
          inserted: body.rows.length,
          updated: 0,
          unchanged: 0,
          rejected: 0,
        },
        rows: body.rows.map((row, index) => ({
          clientRowId: row.clientRowId,
          productionEntryId: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          rowVersion: 1,
          outcome: "INSERTED",
        })),
      } satisfies components["schemas"]["ProductionEntryBatchResult"],
    });
  });
  await page.goto("/manual-data");
  await expect(
    page.getByRole("button", { name: "Simpan perubahan" }),
  ).toBeEnabled({ timeout: 45_000 });

  const link = page.getByRole("link", { name: "Template Excel" });
  await expect(link).toHaveAttribute(
    "href",
    "/templates/manual-data-template.xlsx",
  );
  const served = await page.request.get("/templates/manual-data-template.xlsx");
  expect(served.status()).toBe(200);

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles("public/templates/manual-data-template.xlsx");
  await expect(
    page.getByText(
      "3 baris dari manual-data-template.xlsx (sheet Data) diimpor ke draft",
      { exact: false },
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "3 ditambahkan" }),
  ).toBeVisible();
  expect(posted).toHaveLength(1);
  expect(
    posted[0]!.rows.map(({ shiftStart, stationNo, pin, resultMeter }) => ({
      shiftStart,
      stationNo,
      pin,
      resultMeter,
    })),
  ).toEqual([
    {
      shiftStart: "2026-09-04T07:00:00+07:00",
      stationNo: 51,
      pin: "8954",
      resultMeter: "982",
    },
    {
      shiftStart: "2026-09-04T15:00:00+07:00",
      stationNo: 51,
      pin: "2264",
      resultMeter: "0",
    },
    // EID di kolom Assignee diresolusi ke PIN sebelum dikirim.
    {
      shiftStart: "2026-09-04T07:00:00+07:00",
      stationNo: 52,
      pin: "8954",
      resultMeter: "1045.5",
    },
  ]);
});

test("xlsx besar dibaca di browser lalu diarahkan ke impor langsung", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mock(page, { count: 0 });
  const { strToU8, zipSync } = await import("fflate");
  const rows = 200_000;
  const cells: string[] = [];
  for (let r = 1; r <= rows; r += 1) {
    const day = 46269 + Math.floor(r / 1000);
    cells.push(
      `<row r="${r}"><c r="A${r}"><v>${day}.291666666664</v></c><c r="B${r}"><v>${day}.625</v></c><c r="C${r}"><v>${(r % 900) + 1}</v></c><c r="D${r}" t="inlineStr"><is><t>8954</t></is></c><c r="E${r}"><v>56</v></c><c r="F${r}"><v>12.199999999999999</v></c><c r="G${r}"><v>${r % 1000}</v></c></row>`,
    );
  }
  const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const xlsx = zipSync({
    "xl/workbook.xml": strToU8(
      `<workbook xmlns="${MAIN}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet xmlns="${MAIN}"><sheetData>${cells.join("")}</sheetData></worksheet>`,
    ),
  });

  await page.goto("/manual-data");
  await expect(
    page.getByRole("button", { name: "Simpan perubahan" }),
  ).toBeEnabled({ timeout: 45_000 });
  const started = Date.now();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "produksi-sebulan.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(xlsx),
    });
  await expect(
    page.getByText("terlalu besar untuk workspace", { exact: false }),
  ).toBeVisible({ timeout: 60_000 });
  const elapsed = Date.now() - started;
  test.info().annotations.push({
    type: "performance",
    description: `xlsx ${rows} baris (${(xlsx.length / 1024 / 1024).toFixed(1)} MB zip): dibaca dalam ${elapsed} ms`,
  });
  expect(elapsed).toBeLessThan(20_000);
});

test("hapus baris bermasalah dari panel impor benar-benar menghapus barisnya", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mock(page, { count: 0 });
  await page.goto("/manual-data");
  await expect(
    page.getByRole("button", { name: "Simpan perubahan" }),
  ).toBeEnabled({ timeout: 45_000 });

  const csv = [
    "Shift Start,Shift End,Station,Assignee,Width [cm],Weft [s/in],Result [m]",
    "2026-09-04 07:00,2026-09-04 15:00,51,8954,56,10,982",
    // Grid baris 3: station tidak valid — ini yang dihapus.
    "2026-09-04 07:00,2026-09-04 15:00,abc,8954,56,10,900",
    // Grid baris 4: shift terbalik — harus NAIK ke baris 3 setelah hapus.
    "2026-09-05 15:00,2026-09-05 07:00,53,8954,56,10,700",
  ].join("\n");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "produksi.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });

  const reversed = page
    .locator("li")
    .filter({ hasText: "Shift end harus setelah shift start." });
  await expect(
    reversed.getByRole("button", { name: "Lompat ke baris 4" }),
  ).toBeVisible();
  await expect(
    page.getByText("3 baris terisi", { exact: false }),
  ).toBeVisible();

  const station = page
    .locator("li")
    .filter({ hasText: "Nomor mesin harus bilangan bulat positif." });
  await station.getByRole("button", { name: "Hapus 1 baris" }).click();
  const ask = page.getByRole("dialog", { name: "Hapus 1 baris?" });
  await expect(ask).toContainText("baris di bawahnya naik");
  await ask.getByRole("button", { name: "Hapus 1 baris" }).click();

  await expect(
    page.getByRole("status").filter({ hasText: "1 baris dihapus" }),
  ).toBeVisible();
  // Dihapus, bukan dikosongkan: baris di bawahnya naik satu.
  await expect(
    reversed.getByRole("button", { name: "Lompat ke baris 3" }),
  ).toBeVisible();
  await expect(
    page.getByText("Nomor mesin harus bilangan bulat positif."),
  ).toHaveCount(0);
  await expect(
    page.getByText("2 baris terisi", { exact: false }),
  ).toBeVisible();
});

test("daftar karyawan hanya meminta karyawan aktif", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mock(page);
  const searched: URL[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/employees?"))
      searched.push(new URL(request.url()));
  });
  await page.goto("/manual-data");
  await page.getByRole("button", { name: "Data karyawan" }).click();
  await expect(page.getByText("Operator Contoh").first()).toBeVisible({
    timeout: 45_000,
  });
  expect(searched.length).toBeGreaterThan(0);
  for (const url of searched)
    expect(url.searchParams.get("employmentStatus")).toBe("ACTIVE");
});

test("hapus ribuan baris bermasalah yang berselang-seling tidak membuat tab crash", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  let crashed = false;
  page.on("crash", () => {
    crashed = true;
  });
  // Satu baris tersimpan di atas: hapus massal tidak boleh menyentuhnya.
  await mock(page, { count: 1 });
  const posted: components["schemas"]["ProductionEntryBatchRequest"][] = [];
  await page.route("**/production-entry-batches", async (route) => {
    const body = route
      .request()
      .postDataJSON() as components["schemas"]["ProductionEntryBatchRequest"];
    posted.push(body);
    await route.fulfill({
      json: {
        batchId: "20000000-0000-4000-8000-000000000001",
        sourceRevision: "2",
        counts: {
          inserted: body.rows.length,
          updated: 0,
          unchanged: 0,
          rejected: 0,
        },
        rows: body.rows.map((row, index) => ({
          clientRowId: row.clientRowId,
          productionEntryId: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          rowVersion: 1,
          outcome: "INSERTED",
        })),
      } satisfies components["schemas"]["ProductionEntryBatchResult"],
    });
  });
  await page.goto("/manual-data");
  await expect(
    page.getByRole("button", { name: "Simpan perubahan" }),
  ).toBeEnabled({ timeout: 45_000 });

  // 4.000 baris, setiap baris kedua bermasalah: 2.000 pita terpisah — bentuk
  // yang dulu menghabiskan memori tab (satu perintah remove-row per pita).
  const rows = 4_000;
  const lines = [
    "Shift Start,Shift End,Station,Assignee,Width [cm],Weft [s/in],Result [m]",
  ];
  for (let i = 0; i < rows; i++) {
    const day = String(1 + Math.floor(i / 200)).padStart(2, "0");
    const minute = String(i % 60).padStart(2, "0");
    const hour = String(Math.floor((i % 200) / 60)).padStart(2, "0");
    lines.push(
      `2026-09-${day} ${hour}:${minute},2026-09-${day} 23:00,${i % 2 ? "abc" : 1000 + i},8954,56,10,${i}`,
    );
  }
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "berselang.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(lines.join("\n")),
    });
  const station = page
    .locator("li")
    .filter({ hasText: "Nomor mesin harus bilangan bulat positif." });
  const remove = station.getByRole("button", { name: "Hapus 2.000 baris" });
  await expect(remove).toBeVisible({ timeout: 60_000 });

  await remove.click();
  const started = Date.now();
  await page
    .getByRole("dialog", { name: "Hapus 2.000 baris?" })
    .getByRole("button", { name: "Hapus 2.000 baris" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "2.000 baris dihapus" }),
  ).toBeVisible({ timeout: 60_000 });
  test.info().annotations.push({
    type: "performance",
    description: `hapus 2.000 pita dari 4.000 baris: ${Date.now() - started} ms`,
  });
  expect(crashed).toBe(false);
  await expect(
    page.getByText("2.001 baris terisi", { exact: false }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "2000 ditambahkan" }),
  ).toBeVisible({ timeout: 60_000 });
  // Yang terkirim tepat baris yang sah, urut, tanpa lubang dan tanpa baris
  // tersimpan yang ikut tergeser.
  const sent = posted.flatMap((body) => body.rows);
  expect(sent.map((row) => row.stationNo)).toEqual(
    Array.from({ length: 2_000 }, (_, i) => 1000 + i * 2),
  );
  expect(sent.map((row) => row.resultMeter)).toEqual(
    Array.from({ length: 2_000 }, (_, i) => String(i * 2)),
  );
});

const importCsv = [
  "Shift Start,Shift End,Station,Assignee,Width [cm],Weft [s/in],Result [m]",
  "2026-09-04 07:00,2026-09-04 15:00,51,PT2-9546-0794,56,10,982",
  "2026-09-04 07:00,2026-09-04 15:00,52,8954,56,10,900",
].join("\n");

test("impor file menampilkan modal progres per tahap lalu menutup sendiri", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mock(page, { count: 0 });
  let release: () => void = () => {};
  const lookupHeld = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Didaftarkan setelah mock(): rute terakhir yang menang.
  await page.route("**/employee-lookups", async (route) => {
    await lookupHeld;
    const { refs } = route
      .request()
      .postDataJSON() as components["schemas"]["EmployeeLookupRequest"];
    await route.fulfill({
      json: {
        resolved: refs.map((ref) => ({
          ref,
          pin: "8954",
          fullName: employee.fullName,
          employmentStatus: "ACTIVE" as const,
        })),
        unresolved: [],
      } satisfies components["schemas"]["EmployeeLookupResponse"],
    });
  });
  await page.goto("/manual-data");
  await expect(
    page.getByRole("button", { name: "Simpan perubahan" }),
  ).toBeEnabled({ timeout: 45_000 });

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "produksi.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(importCsv),
    });
  const modal = page.getByRole("dialog", { name: "Mengimpor produksi.csv" });
  await expect(modal).toBeVisible();
  await expect(modal.locator('[aria-current="step"]')).toHaveText(
    "Mencocokkan karyawan ke HRIS",
  );
  await expect(modal.locator('li[data-state="done"]')).toHaveText([
    "Membaca file",
    "Membaca baris",
  ]);
  await expect(
    modal.getByRole("button", { name: "Batalkan impor" }),
  ).toBeVisible();

  release();
  await expect(modal).toBeHidden();
  await expect(
    page.getByRole("status").filter({ hasText: "2 baris dari produksi.csv" }),
  ).toBeVisible();
});

test("impor file bisa dibatalkan dari modal progres tanpa mengubah draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mock(page, { count: 0 });
  // Tidak pernah dijawab: satu-satunya jalan keluar adalah tombol Batalkan.
  await page.route("**/employee-lookups", () => new Promise(() => {}));
  await page.goto("/manual-data");
  await expect(
    page.getByRole("button", { name: "Simpan perubahan" }),
  ).toBeEnabled({ timeout: 45_000 });

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "produksi.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(importCsv),
    });
  const modal = page.getByRole("dialog", { name: "Mengimpor produksi.csv" });
  await modal.getByRole("button", { name: "Batalkan impor" }).click();

  await expect(modal).toBeHidden();
  await expect(
    page.getByRole("status").filter({ hasText: "dibatalkan" }),
  ).toBeVisible();
  await expect(
    page.getByText("0 baris terisi", { exact: false }),
  ).toBeVisible();
});

test("impor langsung ke server menampilkan persentase dan baris terkirim", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mock(page, { count: 0 });
  let batches = 0;
  await page.route("**/production-entry-batches", async (route) => {
    batches += 1;
    // Lambat supaya modal bisa diamati di tengah jalan.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const body = route
      .request()
      .postDataJSON() as components["schemas"]["ProductionEntryBatchRequest"];
    await route.fulfill({
      json: {
        batchId: `20000000-0000-4000-8000-${String(batches).padStart(12, "0")}`,
        sourceRevision: String(batches + 1),
        counts: {
          inserted: body.rows.length,
          updated: 0,
          unchanged: 0,
          rejected: 0,
        },
        rows: body.rows.map((row) => ({
          clientRowId: row.clientRowId,
          outcome: "INSERTED",
          rowVersion: 1,
        })),
      } satisfies components["schemas"]["ProductionEntryBatchResult"],
    });
  });
  await page.goto("/manual-data");
  await expect(
    page.getByRole("button", { name: "Simpan perubahan" }),
  ).toBeEnabled({ timeout: 45_000 });

  // > 1 MB teks: terlalu besar untuk grid, jadi lewat impor langsung.
  const lines = [
    "Shift Start,Shift End,Station,Assignee,Width [cm],Weft [s/in],Result [m]",
  ];
  for (let i = 0; i < 25_000; i++) {
    const day = String(1 + (i % 28)).padStart(2, "0");
    lines.push(
      `2026-09-${day} 07:00,2026-09-${day} 15:00,${1 + Math.floor(i / 28)},8954,56,10,${i}`,
    );
  }
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "produksi-sebulan.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(lines.join("\n")),
    });
  await page.getByRole("button", { name: "Kirim ke server" }).click();

  const modal = page.getByRole("dialog", {
    name: "Mengimpor produksi-sebulan.csv",
  });
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("status")).toContainText("Mengirim ke server");
  await expect(modal.getByRole("status")).toContainText("baris terkirim", {
    timeout: 30_000,
  });
  await expect(
    modal.getByRole("button", { name: "Hentikan impor" }),
  ).toBeVisible();
  await expect(modal).toBeHidden({ timeout: 60_000 });
  expect(batches).toBe(5);
});

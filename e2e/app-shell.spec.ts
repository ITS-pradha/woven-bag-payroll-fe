import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const sessionSnapshot = {
  user: {
    userId: "d890801f-4a1c-4fc1-a03d-187faaf4f75a",
    hrisUserId: 42,
    email: "1027",
    displayName: "Komariyah",
  },
  permissions: [
    "bag.production.read",
    "bag.production.write",
    "bag.payroll.read",
  ],
  roles: ["PAYROLL_ADMIN"],
  isSuperAdmin: false,
  expiresAt: "2026-09-24T02:11:40.000Z",
  csrfToken: "csrf-token-in-memory",
};

// Setiap kasus memuat shell aplikasi yang sama. Menjalankannya berurutan
// mencegah beberapa instance workspace Univer berebut resource browser.
test.describe.configure({ mode: "serial" });

/**
 * Buku periode produksi bulan berjalan (WIB) untuk layar Manual Data. Rute
 * ini sengaja hanya menangkap `departmentCode=KARUNG` — permintaan Manual
 * Data — supaya mock periode Summary (departemen lain) tidak ikut berubah.
 */
async function mockProductionBook(page: Page) {
  const now = new Date(Date.now() + 7 * 3_600_000);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  );
  const periodStart = start.toISOString().slice(0, 10);
  await page.route("**/payroll-periods?*departmentCode=KARUNG*", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: "40000000-0000-4000-8000-000000000100",
            code: `KARUNG-${periodStart.slice(0, 7)}`,
            periodStart,
            periodEnd: end.toISOString().slice(0, 10),
            departmentCode: "KARUNG",
            status: "OPEN",
            createdAt: `${periodStart}T08:00:00+07:00`,
            closedAt: null,
          },
        ],
        page: { pageSize: 200, hasNextPage: false, nextCursor: null },
      },
    }),
  );
}

test.beforeEach(async ({ page }) => {
  const emptyPage = {
    data: [],
    page: { pageSize: 100, hasNextPage: false, nextCursor: null },
  };
  await page.route("**/production-entries?*", (route) =>
    route.fulfill({
      json: {
        data: [],
        page: { pageSize: 100, hasNextPage: false, nextCursor: null },
        sourceRevision: "1",
      },
    }),
  );
  await page.route("**/auth/session", async (route) => {
    await route.fulfill({ status: 200, json: sessionSnapshot });
  });
  await page.route("**/payroll-periods?*", (route) =>
    route.fulfill({ json: emptyPage }),
  );
  await page.route("**/attendance-periods?*", (route) =>
    route.fulfill({ json: emptyPage }),
  );
  await page.route("**/payroll-runs?pageSize=25", (route) =>
    route.fulfill({
      json: {
        data: [],
        page: { pageSize: 25, hasNextPage: false, nextCursor: null },
      },
    }),
  );
  await mockProductionBook(page);
});

test("navigasi utama dapat digunakan dan tidak memiliki pelanggaran aksesibilitas kritis", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Manual Data" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Summary" }).click();
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});

test("shell tetap dapat digunakan pada viewport 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/manual-data");

  await expect(
    page.getByRole("heading", { name: "Manual Data" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Menu utama" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Data produksi" }),
  ).toBeVisible();

  const pageHasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(pageHasHorizontalOverflow).toBe(false);
});

test("profil header dapat dibuka dan logout mengarah ke login", async ({
  page,
}) => {
  let logoutCalled = false;
  await page.route("**/auth/logout", async (route) => {
    logoutCalled = true;
    expect(route.request().method()).toBe("POST");
    await route.fulfill({ status: 200, json: { success: true } });
  });
  await page.goto("/detail");

  await page
    .getByRole("button", { name: "Buka menu profil Komariyah" })
    .click();
  const profile = page.getByRole("region", { name: "Profil pengguna" });
  await expect(profile.getByText("Komariyah")).toBeVisible();
  await expect(profile.getByText("Payroll Admin")).toBeVisible();
  await profile.getByRole("button", { name: "Keluar" }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Masuk ke akun Anda" }),
  ).toBeVisible();
  expect(logoutCalled).toBe(true);
});

test("UI superadmin membuka seluruh modul tanpa permission eksplisit", async ({
  page,
}) => {
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      json: {
        ...sessionSnapshot,
        user: { ...sessionSnapshot.user, displayName: "Super Admin" },
        permissions: [],
        roles: ["SUPER_ADMIN"],
        isSuperAdmin: true,
      },
    }),
  );
  await page.goto("/manual-data");

  await expect(
    page.getByRole("button", { name: "Buka menu profil Super Admin" }),
  ).toContainText("Super Admin");
  await expect(page.getByRole("button", { name: "Tambah baris" })).toBeEnabled({
    timeout: 15_000,
  });

  await page.getByRole("link", { name: "Summary" }).click();
  await expect(
    page.getByRole("button", { name: "Generate payroll" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Konfigurasi Harga" }).click();
  await expect(
    page.getByRole("heading", { name: "Konfigurasi Harga" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Akun Anda belum memiliki izin untuk melihat konfigurasi harga.",
    ),
  ).toHaveCount(0);

  await page.getByRole("link", { name: "Detail" }).click();
  await expect(page.getByRole("heading", { name: "Detail" })).toBeVisible();

  // Menu LDMS Data sudah dihapus.
  await expect(page.getByRole("link", { name: "LDMS Data" })).toHaveCount(0);
});

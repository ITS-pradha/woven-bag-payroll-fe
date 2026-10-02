import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const sessionSnapshot = {
  user: {
    userId: "d890801f-4a1c-4fc1-a03d-187faaf4f75a",
    hrisUserId: 42,
    email: "1027",
    displayName: "Komariyah",
  },
  permissions: ["production.read", "production.write"],
  roles: ["PAYROLL_ADMIN"],
  isSuperAdmin: false,
  expiresAt: "2026-09-24T02:11:40.000Z",
  csrfToken: "csrf-token-in-memory",
};

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
            rowVersion: 1,
            closedAt: null,
          },
        ],
        page: { pageSize: 200, hasNextPage: false, nextCursor: null },
      },
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await page.route("**/production-entries?*", (route) =>
    route.fulfill({
      json: {
        data: [],
        page: { pageSize: 100, hasNextPage: false, nextCursor: null },
        sourceRevision: "1",
      },
    }),
  );
  await mockProductionBook(page);
});

test("login PIN membuka Manual Data dengan payload backend yang tepat", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await page.route("**/auth/login", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: "PT1-0153-4600",
      password: "password-ku",
      rememberMe: true,
    });
    await route.fulfill({ status: 200, json: sessionSnapshot });
  });

  await page.goto("/login");
  await page.getByLabel("PIN karyawan").fill("PT1-0153-4600");
  await page.getByLabel("Password", { exact: true }).fill("password-ku");
  await page
    .getByRole("checkbox", { name: "Ingat saya di perangkat ini" })
    .check();
  await page.getByRole("button", { name: "Masuk", exact: true }).click();

  await expect(page).toHaveURL(/\/manual-data$/);
  await expect(
    page.getByRole("heading", { name: "Manual Data" }),
  ).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test("login SSO memakai sesi Portal dan halaman login memenuhi pemeriksaan aksesibilitas", async ({
  page,
}) => {
  await page.route("**/auth/sso-login", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ rememberMe: false });
    await route.fulfill({ status: 200, json: sessionSnapshot });
  });

  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Masuk ke akun Anda" }),
  ).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);

  await page.getByRole("button", { name: "Masuk dengan SSO Portal" }).click();
  await expect(page).toHaveURL(/\/manual-data$/);
});

test("halaman login tetap utuh pada viewport 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/login");

  await expect(
    page.getByRole("heading", { name: "Masuk ke akun Anda" }),
  ).toBeVisible();
  await expect(page.getByLabel("PIN karyawan")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Masuk dengan SSO Portal" }),
  ).toBeVisible();

  const pageHasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(pageHasHorizontalOverflow).toBe(false);
});

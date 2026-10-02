import { expect, test, type Page } from "@playwright/test";

/**
 * Regression probe for the big-paste path: 50.000 rows, one in five carrying
 * a bad Width, pasted into the grid through the toolbar's Tempel data.
 *
 * Measured before the fix (Chromium, production build): 268 s with the tab
 * frozen — painting each red cell re-entered the edit handler, whose per-cell
 * `setValue` sent the formula engine over the whole sheet. Afterwards about
 * 3 s. The budget below leaves room for a dev server and a slower machine.
 *
 * Slow and memory-hungry, so it only runs on request:
 *   GRID_PROBE=1 npm run test:e2e -- e2e/grid-capacity-probe.spec.ts
 */
const ROWS = 50_000;
const BAD_EVERY = 5;
const PASTE_BUDGET_MS = Number(process.env.GRID_PROBE_BUDGET_MS ?? 5_000);

/** Cursor pages are empty: the probe measures the grid, not the API. */
async function mockApi(page: Page) {
  const now = new Date(Date.now() + 7 * 3_600_000);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const afterCutOff = now.getUTCDate() >= 24;
  // Woven payroll books run from the 24th to the 23rd.
  const periodStart = new Date(
    Date.UTC(year, month - (afterCutOff ? 0 : 1), 24),
  )
    .toISOString()
    .slice(0, 10);
  const periodEnd = new Date(Date.UTC(year, month + (afterCutOff ? 1 : 0), 23))
    .toISOString()
    .slice(0, 10);
  const page100 = { pageSize: 100, hasNextPage: false, nextCursor: null };

  await page.route("**/auth/session", (route) =>
    route.fulfill({
      json: {
        user: {
          userId: "10000000-0000-4000-8000-000000000001",
          hrisUserId: 1,
          email: "demo",
          displayName: "Admin Uji",
        },
        permissions: ["bag.production.read", "bag.production.write"],
        roles: [],
        isSuperAdmin: false,
        expiresAt: "2099-01-01T00:00:00Z",
        csrfToken: "mock-csrf",
      },
    }),
  );
  await page.route("**/payroll-periods?*", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: "40000000-0000-4000-8000-000000000100",
            code: "KARUNG-PROBE",
            periodStart,
            periodEnd,
            departmentCode: "KARUNG",
            status: "OPEN",
            rowVersion: 1,
            createdAt: `${periodStart}T08:00:00+07:00`,
            closedAt: null,
          },
        ],
        page: { ...page100, pageSize: 200 },
      },
    }),
  );
  await page.route("**/production-entries?*", (route) =>
    route.fulfill({
      json: { data: [], page: page100, sourceRevision: "1" },
    }),
  );
  await page.route("**/employee-lookups", (route) => {
    const { refs } = route.request().postDataJSON() as { refs: string[] };
    return route.fulfill({
      json: {
        resolved: refs.map((ref) => ({
          ref,
          pin: ref,
          fullName: "Operator Contoh",
          employmentStatus: "ACTIVE",
        })),
        unresolved: [],
      },
    });
  });
  await page.route("**/employees/*", (route) =>
    route.fulfill({
      json: {
        pin: "8954",
        fullName: "Operator Contoh",
        employmentStatus: "ACTIVE",
        updatedAt: "2026-09-04T07:00:00+07:00",
      },
    }),
  );
  await page.route("**/employees?*", (route) =>
    route.fulfill({ json: { data: [], page: page100 } }),
  );
  return { periodStart };
}

/** Unique (start, end, station) per row, all inside the open book. */
function pasteText(periodStart: string) {
  const day0 = Date.parse(`${periodStart}T00:00:00Z`);
  return Array.from({ length: ROWS }, (_, n) => {
    const day = new Date(day0 + (n % 28) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const hour = [7, 15][Math.floor(n / 28) % 2]!;
    const station = Math.floor(n / 56) + 1;
    const pad = (value: number) => String(value).padStart(2, "0");
    return [
      `${day} ${pad(hour)}:00`,
      `${day} ${pad(hour + 8)}:00`,
      station,
      "8954",
      n % BAD_EVERY === 0 ? "0" : "56",
      "10",
      "982",
    ].join("\t");
  }).join("\n");
}

test("@slow tempel 50.000 baris dengan 20% sel salah tetap di bawah anggaran", async ({
  page,
  context,
}) => {
  test.skip(
    !process.env.GRID_PROBE,
    "Probe kapasitas; jalankan dengan GRID_PROBE=1.",
  );
  test.setTimeout(300_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.addInitScript(() => {
    const target = window as unknown as { __longTasks: number[] };
    target.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        target.__longTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
  });
  const { periodStart } = await mockApi(page);

  await page.goto("/manual-data");
  await expect(page.getByRole("button", { name: "Impor file" })).toBeEnabled({
    timeout: 60_000,
  });
  await page.evaluate(
    (text) => navigator.clipboard.writeText(text),
    pasteText(periodStart),
  );
  const canvas = page.locator(
    '.manual-grid canvas[id^="univer-sheet-main-canvas"]',
  );
  // First data cell: the frozen header is one 34px row.
  await canvas.click({ position: { x: 200, y: 20 + 34 + 17 } });
  await page.evaluate(() => {
    (window as unknown as { __longTasks: number[] }).__longTasks = [];
  });

  const started = Date.now();
  await page.getByRole("button", { name: "Tempel data" }).click();
  await expect(
    page.getByText(`${ROWS.toLocaleString("id-ID")} baris masuk ke draft`, {
      exact: false,
    }),
  ).toBeVisible({ timeout: 280_000 });
  const elapsed = Date.now() - started;
  const longTasks = await page.evaluate(
    () => (window as unknown as { __longTasks: number[] }).__longTasks,
  );

  await expect(
    page.getByText(
      `${(ROWS / BAD_EVERY).toLocaleString("id-ID")} sel perlu diperbaiki`,
      { exact: false },
    ),
  ).toBeVisible();

  const longest = Math.round(Math.max(0, ...longTasks));
  const total = Math.round(longTasks.reduce((sum, value) => sum + value, 0));
  const report = `tempel ${ROWS} baris: ${elapsed} ms · long task ${longTasks.length}× · terpanjang ${longest} ms · total ${total} ms`;
  console.log(report);
  test.info().annotations.push({ type: "grid-probe", description: report });

  expect(elapsed, report).toBeLessThan(PASTE_BUDGET_MS);
});

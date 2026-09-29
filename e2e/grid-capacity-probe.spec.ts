import { expect, test } from "@playwright/test";

/**
 * Pengukuran sementara: berapa mahal menaruh puluhan ribu baris DI DALAM grid,
 * dibanding mengirimnya lewat jalur impor streaming. Bukan test regresi —
 * dihapus setelah angkanya dipakai memutuskan.
 */
test("biaya menaruh 50.000 baris di grid", async ({ page }) => {
  test.setTimeout(600_000);

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
  await page.route("**/production-entries*", (route) =>
    route.fulfill({
      json: {
        data: [],
        page: { pageSize: 100, hasNextPage: false, nextCursor: null },
        sourceRevision: "1",
      },
    }),
  );
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

  const heap = () =>
    page.evaluate(
      () =>
        (performance as unknown as { memory?: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize ?? 0,
    );

  const bootStarted = Date.now();
  await page.goto("/manual-data");
  await expect(page.getByRole("button", { name: "Impor file" })).toBeEnabled({
    timeout: 60_000,
  });
  const boot = Date.now() - bootStarted;
  const heapAfterBoot = await heap();

  const chunk = 10_000;
  const total = 50_000;
  const timings: number[] = [];

  for (let batch = 0; batch < total / chunk; batch++) {
    const tsv = Array.from({ length: chunk }, (_, i) => {
      const n = batch * chunk + i;
      const day = String((n % 28) + 1).padStart(2, "0");
      const month = String((Math.floor(n / 28) % 12) + 1).padStart(2, "0");
      const station = Math.floor(n / (28 * 12)) + 1;
      return `2026-${month}-${day} 07:00\t2026-${month}-${day} 15:00\t${station}\t8954\t56\t10\t982`;
    }).join("\n");

    await page.getByRole("button", { name: "Tempel data", exact: true }).click();
    await page.getByLabel("Baris tujuan").fill(String(batch * chunk + 1));
    await page.getByLabel("Isi clipboard (TSV)").fill(tsv);

    const started = Date.now();
    await page
      .getByRole("button", { name: "Validasi & terapkan ke draft" })
      .click();
    await expect(
      page.getByText("baris ditempel ke draft", { exact: false }),
    ).toBeVisible({ timeout: 300_000 });
    timings.push(Date.now() - started);
  }

  const heapAfter = await heap();

  // Ketik satu sel setelah grid berisi 50.000 baris.
  await page.getByRole("button", { name: "Edit baris" }).click();
  const typeStarted = Date.now();
  await page.getByRole("spinbutton", { name: "Baris aktif" }).fill("25000");
  await expect(page.getByLabel("Edit Result [m]", { exact: true })).toHaveValue(
    "982",
    { timeout: 60_000 },
  );
  const jump = Date.now() - typeStarted;

  console.log(
    [
      `boot grid          : ${boot} ms`,
      `tempel per 10.000  : ${timings.map((t) => `${t} ms`).join(" · ")}`,
      `total tempel 50rb  : ${timings.reduce((a, b) => a + b, 0)} ms`,
      `heap setelah boot  : ${Math.round(heapAfterBoot / 1024 / 1024)} MB`,
      `heap setelah 50rb  : ${Math.round(heapAfter / 1024 / 1024)} MB`,
      `lompat ke baris 25k: ${jump} ms`,
    ].join("\n"),
  );
});

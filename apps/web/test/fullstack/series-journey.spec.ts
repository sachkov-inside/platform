import { z } from "zod";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

// Руководство разделено на продукт, программу и оплату (#509). Место чтения возвращает карточка
// материала в программе и `at=` в адресе: сводки прогресса, полосы и кнопки «Продолжить» здесь нет.
test("guide programme marks the last opened material and preserves the Reader return position", async ({ page, context }, testInfo) => {
  const name = process.env.FULLSTACK_LOGTO_COOKIE_NAME;
  const value = process.env.FULLSTACK_LOGTO_NON_MEMBER_SESSION;
  if (name === undefined || value === undefined) throw new Error("Missing local identity fixture");
  await context.addCookies([{ name, value, url: process.env.FULLSTACK_WEB_BASE_URL ?? "http://127.0.0.1:3000", httpOnly: true, sameSite: "Lax" }]);
  await page.addLocatorHandler(page.getByRole("button", { name: "Закрыть подключение Telegram" }), async (button) => { await button.click(); });
  for (const slug of ["demo-295-obshchiy-gayd", "demo-295-finalnyy-gayd"]) {
    const opened = page.waitForResponse((response) => response.url().endsWith("/api/reading-progress/open") && response.request().method() === "POST");
    await page.goto(`/materials/${slug}`);
    expect((await opened).ok()).toBe(true);
    const button = page.locator("[data-reading-action-state]:visible").getByRole("button", { name: "Изучено", exact: true });
    await expect(button).toBeVisible();
    if (await button.getAttribute("aria-pressed") === "true") { await button.click(); await expect(button).toHaveAttribute("aria-pressed", "false"); }
  }

  // Страница продукта рассказывает о руководстве и ведёт в программу одним действием.
  await page.goto("/guides/demo-series-harness");
  await expect(page.locator('[data-guide-product="demo-series-harness"]')).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await page.getByRole("link", { name: "Открыть программу", exact: true }).click();
  await expect(page).toHaveURL(/\/guides\/demo-series-harness\/programme/u);

  const programme = page.locator('[data-guide-programme="demo-series-harness"]');
  await expect(programme).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Продолжить", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Показать в маршруте" })).toHaveCount(0);
  const current = page.locator('[aria-current="step"]:visible');
  await expect(current).toHaveAttribute("data-route-material", "demo-295-finalnyy-gayd");
  await expect(current.getByText("Продолжить здесь", { exact: true })).toBeVisible();

  await current.getByRole("link", { name: "Demo #295 · Финальный гайд", exact: true }).click();
  await expect(page.locator("[data-reader-body]:visible")).toBeVisible();
  await page.getByRole("link", { name: "Назад к программе", exact: true }).first().click();
  await expect(page).toHaveURL(/at=demo-295-finalnyy-gayd/u);
  await expect(page.locator('[data-route-material="demo-295-finalnyy-gayd"]:visible')).toBeInViewport();
  await page.reload();
  await expect(page.locator('[aria-current="step"]:visible')).toHaveAttribute("data-route-material", "demo-295-finalnyy-gayd");
  await expect(page.getByRole("navigation", { name: "Страницы маршрута" })).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page }).include('[data-guide-programme="demo-series-harness"]').analyze();
  expect(accessibility.violations).toEqual([]);
  const directory = resolve(process.cwd(), "../../docs/evidence/issue-529");
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.screenshot({ path: resolve(directory, `programme-${testInfo.project.name}.png`), fullPage: true });

  // Гость видит состав и замки, но не получает ни прогресса, ни обещания чужого продолжения.
  await context.clearCookies();
  await page.goto("/guides/platform-inside/programme");
  await expect(page.getByRole("main").getByText("Для участников", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.locator('[aria-current="step"]')).toHaveCount(0);
  await page.screenshot({ path: resolve(directory, `programme-guest-${testInfo.project.name}.png`), fullPage: true });
});


test("guide programme paginates a real composition and returns from Reader to page two", async ({ page, context }, testInfo) => {
  const name = process.env.FULLSTACK_LOGTO_COOKIE_NAME;
  const value = process.env.FULLSTACK_LOGTO_SESSION;
  const origin = process.env.FULLSTACK_WEB_BASE_URL ?? "http://127.0.0.1:3000";
  if (name === undefined || value === undefined) throw new Error("Missing local owner fixture");
  await context.addCookies([{ name, value, url: origin, httpOnly: true, sameSite: "Lax" }]);
  await page.addLocatorHandler(page.getByRole("button", { name: "Закрыть подключение Telegram" }), async (button) => { await button.click(); });
  const slug = `series-journey-${String(Date.now())}`;
  const created = await page.request.post("/api/authoring/collections", { headers: { origin }, multipart: { kind: "series", name: "Demo #426 · Длинный маршрут", slug, summary: "Локальная проверка прохождения руководства." } });
  expect(created.ok()).toBe(true);
  const { collection } = z.object({ kind: z.literal("saved"), collection: z.object({ id: z.uuid(), version: z.number() }) }).parse(await created.json());
  try {
    const ids: string[] = [];
    for (let number = 1; number <= 3 && ids.length < 13; number++) {
      const response = await page.request.get(`/api/authoring/materials?page=${String(number)}&search=`);
      const data = z.object({ kind: z.literal("ready"), items: z.array(z.object({ materialId: z.uuid(), publicationState: z.string() })) }).parse(await response.json());
      ids.push(...data.items.filter((item) => item.publicationState === "published").map((item) => item.materialId));
    }
    expect(ids.length).toBeGreaterThanOrEqual(13);
    const orderResponse = await page.request.get(`/api/authoring/series/${collection.id}/order`);
    const { order } = z.object({ kind: z.literal("ready"), order: z.object({ orderVersion: z.string() }) }).parse(await orderResponse.json());
    const saved = await page.request.put("/api/authoring/series/order", { headers: { origin }, multipart: { seriesId: collection.id, expectedOrderVersion: order.orderVersion, orderedMaterialIds: JSON.stringify(ids.slice(0, 13)) } });
    expect(await saved.json()).toMatchObject({ kind: "saved" });
    await page.goto(`/guides/${slug}/programme?page=1`);
    await expect(page.locator("[data-series-ordinal]:visible")).toHaveCount(12);
    await page.getByRole("button", { name: /^Страница 2/u }).click();
    await expect(page).toHaveURL(/page=2/u);
    await expect(page.locator("[data-series-ordinal]:visible")).toHaveCount(1);
    await page.goBack();
    await expect(page.locator("[data-series-ordinal]:visible")).toHaveCount(12);
    await page.goForward();
    await expect(page.locator("[data-series-ordinal]:visible")).toHaveCount(1);
    const row = page.locator('[data-series-ordinal="13"]:visible');
    await row.getByRole("heading").getByRole("link").click();
    await expect(page.locator("[data-reader-body]:visible")).toBeVisible();
    await page.getByRole("link", { name: "Назад к программе", exact: true }).first().click();
    await expect(page).toHaveURL(/page=2&at=/u);
    await expect(row).toBeInViewport();
    await page.reload();
    await expect(row).toBeInViewport();
    await expect(page.locator("[data-series-ordinal]:visible")).toHaveCount(1);
    // Состав считает сама программа: строка над маршрутом называет видимый отрезок и весь состав.
    await expect(page.getByText("Материалы 13–13 из 13", { exact: true })).toBeVisible();
    await page.goto(`/guides/${slug}/programme`);
    await expect(page).toHaveURL(/page=2$/u);
    await expect(page.getByRole("button", { name: "Страница 2, продолжение", exact: true })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Страница 1", exact: true }).click();
    await page.reload();
    await expect(page).toHaveURL(/page=1$/u);
    await expect(page.locator("[data-series-ordinal]:visible")).toHaveCount(12);
    await page.getByRole("button", { name: "Страница 2, продолжение", exact: true }).click();
    const directory = resolve(process.cwd(), "../../docs/evidence/issue-529");
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: resolve(directory, `programme-page-two-${testInfo.project.name}.png`), fullPage: true });
  } finally {
    const archived = await page.request.put("/api/authoring/collections/archive", { headers: { origin }, multipart: { kind: "series", collectionId: collection.id, expectedVersion: String(collection.version), archived: "true" } });
    expect(await archived.json()).toMatchObject({ kind: "saved" });
  }
});

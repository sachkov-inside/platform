import { z } from "zod";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

import {
  fullStackBrowserRequest,
  signInFullStack,
} from "../support/full-stack-session";
import { evidenceDirectory, prepareEvidenceDirectory } from "../../../../scripts/evidence-path.mjs";

// Руководство разделено на продукт, программу и оплату (#509). Место чтения возвращает карточка
// материала в программе и `at=` в адресе; шапка показывает личный прогресс.
const snapshots = evidenceDirectory("issue-529");

test("guide product leads to the programme and the programme keeps the Reader return position", async ({ page, context }, testInfo) => {
  await signInFullStack(context, "NON_MEMBER");
  await page.addLocatorHandler(page.getByRole("button", { name: "Закрыть подключение Telegram" }), async (button) => { await button.click(); });

  // Страница продукта рассказывает о руководстве и ведёт в программу одним действием.
  await page.goto("/guides/demo-series-harness");
  await expect(page.locator('[data-guide-product="demo-series-harness"]:visible')).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await page.getByRole("link", { name: "Открыть программу", exact: true }).click();
  await expect(page).toHaveURL(/\/guides\/demo-series-harness\/programme/u);

  // Личный прогресс находится в шапке, продолжение — на карточке материала.
  await expect(page.locator('[data-guide-programme="demo-series-harness"]:visible')).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Прогресс продукта" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Продолжить", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Показать в маршруте" })).toHaveCount(0);

  // Возврат из читалки приводит на ту же страницу программы и подсвечивает строку материала.
  await page.locator('[data-route-material="demo-295-finalnyy-gayd"]:visible').getByRole("link", { name: "Demo #295 · Финальный гайд", exact: true }).click();
  await expect(page.locator("[data-reader-body]:visible")).toBeVisible();
  await page.getByRole("link", { name: "Назад к программе", exact: true }).first().click();
  await expect(page).toHaveURL(/at=demo-295-finalnyy-gayd/u);
  await expect(page.locator('[data-route-material="demo-295-finalnyy-gayd"]:visible')).toBeInViewport();
  await page.reload();
  await expect(page.locator('[data-route-material="demo-295-finalnyy-gayd"]:visible')).toBeInViewport();
  await expect(page.getByRole("navigation", { name: "Страницы маршрута" })).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page }).include('[data-guide-programme="demo-series-harness"]').analyze();
  expect(accessibility.violations).toEqual([]);
  await prepareEvidenceDirectory("issue-529");
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.screenshot({ path: resolve(snapshots, `programme-${testInfo.project.name}.png`), fullPage: true });

  // Гость видит состав и замки, но не получает ни прогресса, ни обещания чужого продолжения.
  await context.clearCookies();
  await page.goto("/guides/platform-inside/programme");
  await expect(page.getByRole("main").getByText("Нужен доступ", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.locator('[aria-current="step"]')).toHaveCount(0);
  await page.screenshot({ path: resolve(snapshots, `programme-guest-${testInfo.project.name}.png`), fullPage: true });
});

test("guide programme marks the last opened material as the place to continue", async ({ page, context }) => {
  await signInFullStack(context, "NON_MEMBER");
  await page.addLocatorHandler(page.getByRole("button", { name: "Закрыть подключение Telegram" }), async (button) => { await button.click(); });
  for (const slug of ["demo-295-obshchiy-gayd", "demo-295-finalnyy-gayd"]) {
    const opened = page.waitForResponse((response) => response.url().endsWith("/api/reading-progress/open") && response.request().method() === "POST");
    await page.goto(`/materials/${slug}`);
    expect((await opened).ok()).toBe(true);
    const button = page.locator("[data-reading-action-state]:visible").getByRole("button", { name: "Изучено", exact: true });
    await expect(button).toBeVisible();
    if (await button.getAttribute("aria-pressed") === "true") { await button.click(); await expect(button).toHaveAttribute("aria-pressed", "false"); }
  }

  await page.goto("/guides/demo-series-harness/programme");
  const current = page.locator('[aria-current="step"]:visible');
  // Место возврата обозначено выделением строки, а не словами: подпись убрал #441 вместе с
  // прочими лишними статусами маршрута, и это решение о внешнем виде остаётся в силе.
  await expect(current).toHaveAttribute("data-route-material", "demo-295-finalnyy-gayd");
});


test("guide programme appends a real composition and restores Reader return position", async ({ page, context }, testInfo) => {
  await signInFullStack(context, "OWNER");
  await page.addLocatorHandler(page.getByRole("button", { name: "Закрыть подключение Telegram" }), async (button) => { await button.click(); });
  await page.goto("/account");
  const slug = `series-journey-${String(Date.now())}`;
  const created = await fullStackBrowserRequest(page, "/api/authoring/collections", "POST", { kind: "series", name: "Demo #426 · Длинный маршрут", slug, summary: "Локальная проверка прохождения продукта." });
  expect(created.ok()).toBe(true);
  const { collection } = z.object({ kind: z.literal("saved"), collection: z.object({ id: z.uuid(), version: z.number() }) }).parse(await created.json());
  try {
    const ids: string[] = [];
    for (let number = 1; number <= 3 && ids.length < 13; number++) {
      const response = await fullStackBrowserRequest(page, `/api/authoring/materials?page=${String(number)}&search=`);
      const data = z.object({ kind: z.literal("ready"), items: z.array(z.object({ materialId: z.uuid(), publicationState: z.string() })) }).parse(await response.json());
      ids.push(...data.items.filter((item) => item.publicationState === "published").map((item) => item.materialId));
    }
    expect(ids.length).toBeGreaterThanOrEqual(13);
    const orderResponse = await fullStackBrowserRequest(page, `/api/authoring/series/${collection.id}/order`);
    const { order } = z.object({ kind: z.literal("ready"), order: z.object({ orderVersion: z.string() }) }).parse(await orderResponse.json());
    const saved = await fullStackBrowserRequest(page, "/api/authoring/series/order", "PUT", { seriesId: collection.id, expectedOrderVersion: order.orderVersion, orderedMaterialIds: JSON.stringify(ids.slice(0, 13)) });
    expect(await saved.json()).toMatchObject({ kind: "saved" });
    await page.goto(`/guides/${slug}/programme?page=1`);
    await expect(page.locator("[data-series-ordinal]:visible")).toHaveCount(12);
    await page.getByRole("button", { name: "Показать ещё уроки" }).scrollIntoViewIfNeeded();
    await expect(page.locator("[data-series-ordinal]:visible")).toHaveCount(13);
    await expect(page.getByRole("navigation", { name: "Страницы маршрута" })).toHaveCount(0);
    const row = page.locator('[data-series-ordinal="13"]:visible');
    await row.getByRole("heading").getByRole("link").click();
    await expect(page.locator("[data-reader-body]:visible")).toBeVisible();
    await page.getByRole("link", { name: "Назад к программе", exact: true }).first().click();
    await expect(page).toHaveURL(/page=2&at=/u);
    await expect(row).toBeInViewport();
    await page.reload();
    await expect(row).toBeInViewport();
    await expect(page.locator("[data-series-ordinal]:visible")).toHaveCount(13);
    await expect(page.locator("p:visible", { hasText: "Показано 13 из 13 материалов" })).toBeVisible();
    await row.getByRole("heading").getByRole("link").click();
    await expect(page.locator("[data-reader-body]:visible")).toBeVisible();
    await page.goBack();
    await expect(row).toBeInViewport();
    await expect(page.locator("[data-series-ordinal]:visible")).toHaveCount(13);
    await page.getByRole("tab", { name: "Дополнительные материалы", exact: true }).click();
    await page.getByRole("tab", { name: /^Программа/u }).click();
    await expect(page.locator("[data-series-ordinal]:visible")).toHaveCount(12);
    await prepareEvidenceDirectory("issue-529");
    await page.screenshot({ path: resolve(snapshots, `programme-continuous-${testInfo.project.name}.png`), fullPage: true });
  } finally {
    const archived = await fullStackBrowserRequest(page, "/api/authoring/collections/archive", "PUT", { kind: "series", collectionId: collection.id, expectedVersion: String(collection.version), archived: "true" });
    expect(await archived.json()).toMatchObject({ kind: "saved" });
  }
});

import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { prepareEvidenceDirectory } from "../../../../scripts/evidence-path.mjs";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";

function fixture() {
  const productSlug = process.env["FULLSTACK_TASK_C_PRODUCT_SLUG"];
  const code = process.env["FULLSTACK_TASK_C_CODE"];
  const closedAssetId = process.env["FULLSTACK_TASK_C_CLOSED_ASSET_ID"];
  const closedCode = process.env["FULLSTACK_TASK_C_CLOSED_CODE"];
  if (
    productSlug === undefined ||
    code === undefined ||
    closedCode === undefined ||
    closedAssetId === undefined
  )
    throw new Error("Missing isolated format c fixture");
  return { productSlug, code, closedCode, closedAssetId };
}

async function verifyImportedAdvice(page: Page) {
  const summary = page
    .locator("summary")
    .filter({ hasText: "Импортированный совет" });
  const link = page.getByRole("link", { name: "Ссылка внутри совета" });
  await expect(link).toBeHidden();
  await expect(page.getByText("Открытое тело", { exact: true })).toBeVisible();
  await expect(page.getByText("Обычное тело", { exact: true })).toBeVisible();
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(link).toBeVisible();
  await expect(page.getByText("Вложенное тело", { exact: true })).toBeVisible();
  await expect(
    page.getByText("> [!tip]- Литеральный пример", { exact: true }),
  ).toBeVisible();
  const image = page.getByRole("img", { name: "Схема внутри совета" });
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate(
        (element: HTMLImageElement) =>
          element.complete && element.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await summary.focus();
  await page.keyboard.press("Space");
  await expect(link).toBeHidden();
  await summary.click();
  await expect(link).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page }).include("main").analyze()
    ).violations.filter(
      (item) => item.impact === "serious" || item.impact === "critical",
    ),
  ).toEqual([]);
}

test("a guest reads an imported c Task with its page, link, image and keyboard advice; protected Task assets remain closed (#1194)", async ({
  page,
}, testInfo) => {
  const { productSlug, code, closedCode, closedAssetId } = fixture();
  await page.goto(`/products/${productSlug}/tasks/${code}`);
  await expect(
    page.getByRole("heading", { level: 1, name: `Задание c. ${code}` }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Что нужно сделать" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Что решаешь сам" }),
  ).toBeVisible();
  await expect(page.getByText("SECRET_AGENT_EVIDENCE")).toHaveCount(0);
  const image = page.getByRole("img", { name: "Схема учебного проекта" });
  await expect(image).toBeVisible();
  await image.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      image.evaluate(
        (element: HTMLImageElement) =>
          element.complete && element.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await expect(page.getByText("Начни с одного запроса.")).not.toBeVisible();
  await page.getByText("Мой совет", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Начни с одного запроса.")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Начни с одного запроса.")).not.toBeVisible();
  await verifyImportedAdvice(page);
  const href = await page
    .getByRole("link", { name: "уроку", exact: true })
    .getAttribute("href");
  expect(href).toMatch(/^\/materials\//u);
  await expect(
    page.getByRole("link", { name: "следующему заданию", exact: true }),
  ).toHaveAttribute("href", `/products/${productSlug}/tasks/c-second`);
  const denied = await page.request.get(
    `/api/products/${productSlug}/tasks/${closedCode}/assets/${closedAssetId}`,
    { maxRedirects: 0 },
  );
  expect(denied.status()).toBe(404);
  const violations = (
    await new AxeBuilder({ page }).include("main").analyze()
  ).violations.filter(
    (item) => item.impact === "serious" || item.impact === "critical",
  );
  expect(violations).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  const directory = await prepareEvidenceDirectory("issue-1196");
  await screenshotWholePage(page, {
    path: resolve(directory, `task-c-live-${testInfo.project.name}.png`),
    animations: "disabled",
  });
  if (href === null) throw new Error("Imported lesson link is absent");
  await page.goto(href);
  await verifyImportedAdvice(page);
  await screenshotWholePage(page, {
    path: resolve(directory, `reader-live-${testInfo.project.name}.png`),
    animations: "disabled",
  });
  await expect(
    page.getByRole("link", { name: "Открой задание", exact: true }),
  ).toHaveAttribute("href", `/products/${productSlug}/tasks/${code}`);
  await page.goto(`/products/${productSlug}/programme`);
  await expect(page.locator("[data-programme-task]")).toHaveCount(4);
  expect(
    await page
      .locator("[data-programme-task]")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-programme-task")),
      ),
  ).toEqual(["c-leading", "c-first", "c-second", "c-closed"]);
  for (const task of ["c-leading", "c-first", "c-second", "c-closed"])
    await expect(page.locator(`[data-programme-task="${task}"]`)).toHaveCount(
      1,
    );
});

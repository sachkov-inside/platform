import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { prepareEvidenceDirectory } from "../../../../scripts/evidence-path.mjs";

async function expectTarget(page: Page, id: string) {
  const heading = page.locator(`h2[id="${id}"]`);
  await expect(heading).toBeVisible();
  const top = () =>
    heading.evaluate((node) => {
      const container = node.ownerDocument.querySelector<HTMLElement>(
        "[data-application-content]",
      );
      const rootTop =
        container !== null && getComputedStyle(container).overflowY === "auto"
          ? Math.max(0, container.getBoundingClientRect().top)
          : 0;
      return node.getBoundingClientRect().top - rootTop;
    });
  await expect.poll(top).toBeGreaterThanOrEqual(0);
  await expect.poll(top).toBeLessThan(160);
}

test("an imported v2 Task and Material keep source fragments through native navigation (#1179)", async ({
  page,
}, testInfo) => {
  const productSlug = process.env["FULLSTACK_TASK_C_PRODUCT_SLUG"];
  const code = process.env["FULLSTACK_TASK_C_CODE"];
  if (productSlug === undefined || code === undefined)
    throw new Error("Missing isolated format c fixture");
  await page.goto(`/products/${productSlug}/tasks/${code}`);
  await page
    .getByRole("link", { name: "К повторному разделу урока", exact: true })
    .click();
  await expectTarget(page, "раздел-2");
  await page
    .getByRole("link", { name: "К разделу задания", exact: true })
    .click();
  await expectTarget(page, "как-спроектировать-один-этап");
  const here = page.getByRole("link", { name: "Здесь", exact: true });
  await here.click();
  await expectTarget(page, "как-спроектировать-один-этап");
  await here.click();
  await expectTarget(page, "как-спроектировать-один-этап");
  await expect(page.locator('h2[id="раздел-2"]')).toBeVisible();
  const ids = await page
    .locator("[id]")
    .evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(new Set(ids).size).toBe(ids.length);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  const violations = (
    await new AxeBuilder({ page }).include("main").analyze()
  ).violations.filter(
    (item) => item.impact === "serious" || item.impact === "critical",
  );
  expect(violations).toEqual([]);
  console.info(
    "Source anchor target: " +
      JSON.stringify(
        await page
          .locator('h2[id="как-спроектировать-один-этап"]')
          .evaluate((heading) => {
            const container = document.querySelector<HTMLElement>(
              "[data-application-content]",
            );
            return {
              headingTop: heading.getBoundingClientRect().top,
              containerTop: container?.getBoundingClientRect().top,
              containerScrollTop: container?.scrollTop,
              windowScrollY: window.scrollY,
            };
          }),
      ),
  );
  const directory = await prepareEvidenceDirectory("issue-1179");
  await page.screenshot({
    path: resolve(directory, `task-source-anchor-${testInfo.project.name}.png`),
  });
  await page.getByRole("link", { name: "Нет раздела", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Задание c. ${code}` }),
  ).toBeInViewport();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        document: window.scrollY,
        container: document.querySelector<HTMLElement>(
          "[data-application-content]",
        )?.scrollTop,
      })),
    )
    .toEqual({ document: 0, container: 0 });
});

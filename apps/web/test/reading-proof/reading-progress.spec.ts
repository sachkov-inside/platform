import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";

for (const scenario of ["text", "member", "video", "cards", "complete-series", "empty-series", "failure", "conflict"] as const) {
  test(`${scenario}: responsive proof and accessibility`, async ({ page }, testInfo) => {
    await page.goto(`/iframe.html?id=pages-reading-progress--${scenario}&viewMode=story`);
    await expect(page.getByRole("main")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: "[data-agentation-root] { visibility: hidden !important; }" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const accessibility = await new AxeBuilder({ page }).include("[data-workshop-story]").analyze();
    expect(accessibility.violations).toEqual([]);
    if (scenario === "video") await expect(page.getByRole("button", { name: "Отметить просмотренным", exact: true })).toHaveCount(1);
    if (scenario === "text") {
      const action = page.getByRole("button", { name: "Отметить прочитанным", exact: true });
      const initial = await action.boundingBox();
      await action.click();
      const pending = await action.boundingBox();
      expect(pending?.width).toBe(initial?.width);
      expect(pending?.height).toBe(initial?.height);
      await expect(page.getByRole("button", { name: "Снять отметку", exact: true })).toBeVisible();
      await expect(page.getByText("Изучено 3 из 6", { exact: true })).toBeVisible();
    }
    const readingAction = page.getByRole("region", { name: "Отметка материала" });
    if (await readingAction.count() > 0) await readingAction.scrollIntoViewIfNeeded();
    await page.screenshot({ fullPage: true, animations: "disabled", path: resolve(`../../docs/evidence/issue-328/${scenario}-${testInfo.project.name}.png`) });
  });
}

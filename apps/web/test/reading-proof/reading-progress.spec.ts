import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { evidencePath } from "../../../../scripts/evidence-path.mjs";

for (const scenario of ["text", "member", "video", "cards", "complete-series", "empty-series", "failure", "conflict"] as const) {
  test(`${scenario}: responsive proof and accessibility`, async ({ page }, testInfo) => {
    await page.goto(`/iframe.html?id=pages-reading-progress--${scenario}&viewMode=story`);
    await expect(page.getByRole("main")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: "[data-agentation-root] { visibility: hidden !important; }" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const accessibility = await new AxeBuilder({ page }).include("[data-workshop-story]").analyze();
    expect(accessibility.violations).toEqual([]);
    if (scenario === "video") await expect(page.getByRole("button", { name: "Просмотрено", exact: true })).toHaveCount(1);
    if (scenario === "text") {
      const action = page.getByRole("button", { name: "Прочитано", exact: true });
      const initial = await action.boundingBox();
      await action.click();
      const pending = await action.boundingBox();
      expect(pending?.width).toBe(initial?.width);
      expect(pending?.height).toBe(initial?.height);
      await expect(page.getByRole("button", { name: "Прочитано", exact: true })).toHaveAttribute("aria-pressed", "true");
    }
    const readingAction = page.locator("[data-reading-action-state]");
    if (await readingAction.count() > 0) await readingAction.scrollIntoViewIfNeeded();
    await page.screenshot({ fullPage: true, animations: "disabled", path: evidencePath("issue-328", `${scenario}-${testInfo.project.name}.png`) });
  });
}


test("loading, ready and pending keep the minimal toggle footprint", async ({ page }) => {
  const positions: number[] = [];
  for (const scenario of ["loading", "text", "pending"] as const) {
    await page.goto(`/iframe.html?id=pages-reading-progress--${scenario}&viewMode=story`);
    const progress = page.locator("[data-reading-action-state]");
    await expect(progress).toBeAttached();
    await page.evaluate(() => document.fonts.ready);
    const box = await progress.boundingBox();
    if (box === null) throw new Error("Missing reading toggle geometry");
    positions.push(box.height);
  }
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(1);
});

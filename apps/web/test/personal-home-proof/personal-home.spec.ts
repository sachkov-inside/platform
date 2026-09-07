import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
for (const scenario of ["anonymous", "signed-in-empty", "free-non-member", "member", "expired", "text-without-position", "partial-video", "reached-end-unmarked", "completed-exclusion", "partial-data", "loading", "unavailable"]) {
  test(`${scenario}: responsive personal Home`, async ({ page }, testInfo) => {
    await page.goto(`/iframe.html?id=pages-personal-home--${scenario}&viewMode=story`);
    await expect(page.getByRole("heading", { name: "Серии", exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: "[data-agentation-root] { visibility: hidden !important; }" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include("[data-workshop-story]").analyze()).violations).toEqual([]);
    if (scenario === "partial-video") {
      const link = page.getByRole("link", { name: /Продолжить с 12:34/u });
      await link.focus();
      await expect(link).toBeFocused();
      await expect(link).toHaveAttribute("href", /\/materials\/video-pro-developer-pipeline\?from=%2F/u);
    }
    await page.screenshot({ fullPage: true, animations: "disabled", path: resolve(`../../docs/evidence/issue-331/${scenario}-${testInfo.project.name}.png`) });
  });
}

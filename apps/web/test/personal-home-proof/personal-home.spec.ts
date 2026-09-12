import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { evidencePath } from "../../../../scripts/evidence-path.mjs";
for (const scenario of ["anonymous", "signed-in-empty", "free-non-member", "member", "expired", "text-without-position", "partial-video", "reached-end-unmarked", "completed-exclusion", "partial-data", "loading", "unavailable"]) {
  test(`${scenario}: responsive personal Home`, async ({ page }, testInfo) => {
    await page.goto(`/iframe.html?id=pages-personal-home--${scenario}&viewMode=story`);
    await expect(page.getByRole("heading", { name: "Руководства", exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: "[data-agentation-root] { visibility: hidden !important; }" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include("[data-workshop-story]").analyze()).violations).toEqual([]);
    if (scenario === "partial-video") {
      const link = page.getByRole("link", { name: /Продолжить с 12:34/u });
      for (let index = 0; index < 15 && !(await link.evaluate((element) => element === document.activeElement)); index++) await page.keyboard.press("Tab");
      await expect(link).toBeFocused();
      await expect(link).toHaveAttribute("href", /\/materials\/video-pro-developer-pipeline\?from=%2F/u);
    }
    await page.screenshot({ fullPage: true, animations: "disabled", path: evidencePath("issue-331", `${scenario}-${testInfo.project.name}.png`) });
  });
}

for (const scenario of ["member", "signed-in-empty", "unavailable"]) {
  test(`${scenario}: refresh keeps public Home in place`, async ({ page }) => {
    await page.goto(`/iframe.html?id=pages-personal-home--${scenario}&viewMode=story`);
    const series = page.getByRole("heading", { name: "Руководства", exact: true });
    await expect(series).toBeVisible();
    const before = await series.boundingBox();
    await page.evaluate(() => window.dispatchEvent(new Event("personal-home-proof-refresh")));
    await expect(page.locator("[data-personal-home-state]")).toHaveAttribute("data-personal-home-state", "loading");
    expect((await series.boundingBox())?.y).toBe(before?.y);
  });
}
test("keyboard opens a Reader and marks an ended video", async ({ page }) => {
  await page.goto("/iframe.html?id=pages-personal-home--reached-end-unmarked&viewMode=story");
  const button = page.getByRole("button", { name: "Просмотрено", exact: true });
  await expect(button).toBeVisible();
  for (let index = 0; index < 20 && !(await button.evaluate((element) => element === document.activeElement)); index++) await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.locator('[data-continue-material="ended"]')).toHaveCount(0);
  const remaining = page.locator('[data-continue-material="text"] a');
  for (let index = 0; index < 25 && !(await remaining.evaluate((element) => element === document.activeElement)); index++) await page.keyboard.press("Tab");
  await expect(remaining).toBeFocused();
  await page.route("**/materials/kak-ustroen-inside-platform?from=%2F", async (route) => { await route.fulfill({ contentType: "text/html", body: "<h1>Reader navigation target</h1>" }); });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/materials\/kak-ustroen-inside-platform\?from=%2F/u);
});

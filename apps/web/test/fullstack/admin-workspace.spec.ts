import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInFullStack } from "../support/full-stack-session";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";

test("admin workspace exposes every active task on desktop and phone through real routes", async ({
  page,
  context,
}, info) => {
  await signInFullStack(context, "OWNER");
  await page.goto("/authoring/products");
  const phone = (page.viewportSize()?.width ?? 1440) < 1024;
  const destinations = [
    ["Материалы", "/authoring/materials"],
    ["Темы", "/authoring/topics"],
    ["Сдачи", "/authoring/submissions"],
    ["Люди и доступ", "/authoring/access"],
    ["Продажи и платежи", "/authoring/billing"],
    ["Воронка продаж", "/authoring/sales-funnel"],
    ["Продукты", "/authoring/products"],
  ] as const;
  for (const [label, pathname] of destinations) {
    if (phone)
      await page.getByRole("button", { name: "Меню", exact: true }).click();
    const navigation = page.getByRole("navigation", {
      name: phone ? "Редактор на мобильном" : "Редактор",
      exact: true,
    });
    const link = navigation.getByRole("link", { name: label, exact: true });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${pathname}(?:\\?.*)?$`, "u"));
    await expect(page.locator("[data-authoring-shell]")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(
      page.getByRole("main").getByRole("heading", { level: 1 }),
    ).toBeVisible();
    if (phone)
      await expect(
        page.getByRole("button", { name: "Меню", exact: true }),
      ).toHaveAttribute("aria-expanded", "false");
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    if (process.env["CAPTURE_EVIDENCE"] === "1") {
      await screenshotWholePage(page, {
        path: info.outputPath(`${pathname.split("/").at(-1) ?? "admin"}.png`),
      });
    }
  }
});

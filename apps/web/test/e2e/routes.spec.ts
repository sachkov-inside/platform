import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const destinations = [
  { path: "/", label: "Главная", heading: "Главная" },
  { path: "/library", label: "Библиотека", heading: "Библиотека" },
  { path: "/map", label: "Карта", heading: "Карта Inside" },
] as const;

for (const destination of destinations) {
  test(`${destination.label} resolves with current navigation`, async ({ page }) => {
    const response = await page.goto(destination.path);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(destination.heading);
    await expect(page).toHaveTitle(new RegExp(`^${destination.label} · Inside$`, "u"));

    const navigation = page.getByRole("navigation", { name: "Основная" });
    await expect(navigation.getByRole("link")).toHaveCount(3);
    await expect(
      navigation.getByRole("link", { name: destination.label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });

  test(`${destination.label} has no serious accessibility findings`, async ({ page }) => {
    await page.goto(destination.path);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const materialViolations = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );

    expect(materialViolations).toEqual([]);
  });
}

test("navigation works with pointer input", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("navigation", { name: "Основная" }).getByRole("link", {
    name: "Библиотека",
    exact: true,
  }).click();

  await expect(page).toHaveURL(/\/library$/u);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Библиотека");
});

test("keyboard order starts with skip link, brand and destinations", async ({ page }) => {
  await page.goto("/");

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Перейти к содержанию" })).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Inside" })).toBeFocused();

  for (const destination of destinations) {
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("navigation", { name: "Основная" }).getByRole("link", {
        name: destination.label,
        exact: true,
      }),
    ).toBeFocused();
  }
});

test("focused navigation has a visible indicator", async ({ page }) => {
  await page.goto("/");

  const libraryLink = page
    .getByRole("navigation", { name: "Основная" })
    .getByRole("link", { name: "Библиотека", exact: true });
  await libraryLink.focus();

  const outline = await libraryLink.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });

  expect(outline.style).not.toBe("none");
  expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
});

test("shell exposes essential landmarks to assistive technology", async ({ page }) => {
  await page.goto("/");

  const accessibilityTree = await page.locator("body").ariaSnapshot();

  expect(accessibilityTree).toContain("- banner:");
  expect(accessibilityTree).toContain('- navigation "Основная":');
  expect(accessibilityTree).toContain('- link "Главная":');
  expect(accessibilityTree).toContain("- main:");
  expect(accessibilityTree).toContain('- heading "Главная" [level=1]');
  expect(accessibilityTree).toContain("- contentinfo:");
});

test("content reflows without horizontal page overflow at 200% text size", async ({ page }) => {
  await page.goto("/");
  await page.locator("html").evaluate((element) => {
    element.style.fontSize = "200%";
  });

  const overflow = await page.locator("html").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  await expect(page.getByRole("navigation", { name: "Основная" })).toBeVisible();
});

test("reduced motion removes navigation transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const durations = await page
    .getByRole("navigation", { name: "Основная" })
    .getByRole("link", { name: "Главная", exact: true })
    .evaluate((element) => ({
      indicator: getComputedStyle(element, "::after").transitionDuration,
      link: getComputedStyle(element).transitionDuration,
    }));

  expect(durations).toEqual({ indicator: "0s", link: "0s" });
});

test("current destination indicator uses one short state transition", async ({ page }) => {
  await page.goto("/");

  const duration = await page
    .getByRole("navigation", { name: "Основная" })
    .getByRole("link", { name: "Главная", exact: true })
    .evaluate((element) => getComputedStyle(element, "::after").transitionDuration);

  expect(duration).toBe("0.16s");
});

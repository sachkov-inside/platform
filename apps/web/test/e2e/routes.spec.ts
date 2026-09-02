import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const destinations = [
  { path: "/library", label: "База знаний", heading: "База знаний" },
] as const;

for (const destination of destinations) {
  test(`${destination.label} resolves with current navigation`, async ({ page }, testInfo) => {
    const response = await page.goto(destination.path);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(destination.heading);
    await expect(page).toHaveTitle(new RegExp(`^${destination.label} · Inside$`, "u"));

    const navigation = getPrimaryNavigation(page, testInfo.project.name);
    await expect(navigation.getByRole("link")).toHaveCount(1);
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

test("root redirects to the canonical library route", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/library$/u);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("База знаний");
});

test("map remains available by direct URL without a primary navigation item", async ({
  page,
}, testInfo) => {
  const response = await page.goto("/map");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Карта Inside");
  const navigation = getPrimaryNavigation(page, testInfo.project.name);
  await expect(navigation.getByRole("link")).toHaveCount(1);
  await expect(navigation.getByRole("link", { name: "Карта" })).toHaveCount(0);
});

test("guest shell exposes a server-owned sign-in mutation on desktop and mobile", async ({
  page,
}) => {
  await page.goto("/library");

  const signIn = page.locator("button:visible", { hasText: "Войти" });
  await expect(signIn).toHaveCount(1);
  await expect(signIn).toBeEnabled();
  await expect(signIn.locator("xpath=ancestor::form")).toHaveAttribute(
    "action",
    "/auth/sign-in",
  );
  await expect(signIn.locator("xpath=ancestor::form")).toHaveAttribute("method", "post");
});

test("manager shell exposes editor navigation on desktop and mobile", async ({
  page,
}, testInfo) => {
  await page.route("**/auth/status", (route) =>
    route.fulfill({
      body: JSON.stringify({ canManageMaterials: true, state: "authenticated" }),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.goto("/library");

  const editorLink = getPrimaryNavigation(page, testInfo.project.name).getByRole(
    "link",
    { name: "Редактор", exact: true },
  );
  await expect(editorLink).toHaveAttribute("href", "/authoring/materials");
});

test("authoring route owns a dedicated shell outside the public application shell", async ({
  page,
}, testInfo) => {
  test.skip(navigationMode(testInfo.project.name) !== "desktop");

  await page.goto("/authoring/materials/new");

  await expect(page.getByRole("heading", { name: "Нет доступа к редактору" })).toBeVisible();
  const signIn = page.getByRole("button", { name: "Войти" });
  await expect(signIn).toBeEnabled();
  await expect(signIn.locator("xpath=ancestor::form")).toHaveAttribute(
    "action",
    "/auth/sign-in",
  );
  await expect(signIn.locator("xpath=ancestor::form")).toHaveAttribute("method", "post");
  await expect(page.getByRole("complementary", { name: "Боковая панель" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Основная" })).toHaveCount(0);
  const authoringSidebar = page.getByRole("complementary", { name: "Редактор" });
  await expect(authoringSidebar).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);

  const sidebarBox = await authoringSidebar.boundingBox();
  const box = await page.getByRole("main").boundingBox();
  expect(sidebarBox?.x).toBe(0);
  expect(box?.x).toBe(sidebarBox?.width);
  expect((box?.width ?? 0) + (sidebarBox?.width ?? 0)).toBe(1_440);
});

test("auth control hydrates without a server-client mismatch", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("hydrated")) {
      hydrationErrors.push(message.text());
    }
  });

  await page.goto("/library");
  await expect(page.locator("button:visible", { hasText: "Войти" })).toBeEnabled();

  expect(hydrationErrors).toEqual([]);
});

test("failed authentication returns a visible recoverable state", async ({ page }) => {
  await page.goto("/?authentication=failed");

  await expect(page.getByRole("status")).toContainText(
    "Вход не завершён. Повторите попытку",
  );
});

test("incomplete global logout is reported without claiming success", async ({ page }) => {
  await page.goto("/?authentication=logout-incomplete");

  await expect(page.getByRole("status")).toContainText(
    "Локальная сессия завершена, но глобальный выход не подтверждён",
  );
});

test("navigation works with pointer input", async ({ page }, testInfo) => {
  await page.goto("/map");

  const libraryLink = getPrimaryNavigation(page, testInfo.project.name).getByRole("link", {
    name: "База знаний",
    exact: true,
  });
  if (navigationMode(testInfo.project.name) === "mobile") {
    // The Next.js development indicator overlaps the center of the first bottom-nav item.
    const box = await libraryLink.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(
      (box?.x ?? 0) + (box?.width ?? 0) / 2,
      (box?.y ?? 0) + (box?.height ?? 0) - 4,
    );
  } else {
    await libraryLink.click();
  }

  await expect(page).toHaveURL(/\/library$/u);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("База знаний");
});

test("desktop sidebar has no supplemental tooltip badges", async ({ page }, testInfo) => {
  test.skip(navigationMode(testInfo.project.name) !== "desktop");
  await page.goto("/library");

  const sidebar = page.getByRole("complementary", { name: "Боковая панель" });
  const transition = await sidebar.evaluate((element) => {
    const style = getComputedStyle(element);
    return { duration: style.transitionDuration, property: style.transitionProperty };
  });

  expect(transition.property).toContain("width");
  expect(transition.duration).not.toBe("0s");
  await expect(sidebar.locator('[data-slot="tooltip-trigger"]')).toHaveCount(0);
  await sidebar.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
});

test("desktop sidebar closes after pointer navigation", async ({ page }, testInfo) => {
  test.skip(navigationMode(testInfo.project.name) !== "desktop");
  await page.goto("/map");

  const sidebar = page.getByRole("complementary", { name: "Боковая панель" });
  const libraryLink = page
    .getByRole("navigation", { name: "Основная" })
    .getByRole("link", { name: "База знаний", exact: true });

  await hoverUntilSidebarOpens(page, sidebar, libraryLink);
  await libraryLink.click();
  await page.mouse.move(600, 500);

  await expect(page).toHaveURL(/\/library$/u);
  await expect(sidebar).toHaveCSS("width", "76px");
});

test("keyboard order starts with the skip link and visible navigation", async ({ page }, testInfo) => {
  await page.goto("/library");

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Перейти к содержанию" })).toBeFocused();

  if (navigationMode(testInfo.project.name) === "desktop") {
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Sachkov Inside" })).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Закрепить сайдбар" })).toBeFocused();
  }

  for (const destination of destinations) {
    await page.keyboard.press("Tab");
    await expect(
      getPrimaryNavigation(page, testInfo.project.name).getByRole("link", {
        name: destination.label,
        exact: true,
      }),
    ).toBeFocused();
  }
});

test("focused navigation has a visible indicator", async ({ page }, testInfo) => {
  await page.goto("/library");

  const libraryLink = getPrimaryNavigation(page, testInfo.project.name).getByRole("link", {
    name: "База знаний",
    exact: true,
  });
  const tabsBeforeLibrary = navigationMode(testInfo.project.name) === "desktop" ? 4 : 2;

  for (let tabIndex = 0; tabIndex < tabsBeforeLibrary; tabIndex += 1) {
    await page.keyboard.press("Tab");
  }

  await expect(libraryLink).toBeFocused();

  const outline = await libraryLink.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });

  expect(outline.style).not.toBe("none");
  expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
});

test("shell exposes essential landmarks to assistive technology", async ({ page }, testInfo) => {
  await page.goto("/");

  const accessibilityTree = await page.locator("body").ariaSnapshot();

  if (navigationMode(testInfo.project.name) === "desktop") {
    expect(accessibilityTree).toContain('- complementary "Боковая панель":');
    expect(accessibilityTree).toContain('- navigation "Основная":');
  } else {
    expect(accessibilityTree).toContain('- navigation "Мобильная навигация":');
  }
  expect(accessibilityTree).toContain('- link "База знаний":');
  expect(accessibilityTree).toContain("- main:");
  expect(accessibilityTree).toContain('- heading "База знаний" [level=1]');
});

test("content reflows without horizontal page overflow at 200% text size", async ({ page }, testInfo) => {
  await page.goto("/library");
  await page.locator("html").evaluate((element) => {
    element.style.fontSize = "200%";
  });

  const overflow = await page.locator("html").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  await expect(getPrimaryNavigation(page, testInfo.project.name)).toBeVisible();
});

test("reduced motion removes navigation transitions", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/library");

  const transitionProperty = await getPrimaryNavigation(page, testInfo.project.name)
    .getByRole("link", { name: "База знаний", exact: true })
    .evaluate((element) => getComputedStyle(element).transitionProperty);

  expect(transitionProperty).toBe("none");

  if (navigationMode(testInfo.project.name) === "desktop") {
    await expect(page.getByRole("complementary", { name: "Боковая панель" })).toHaveCSS(
      "transition-property",
      "none",
    );
  }
});

test("current destination exposes its semantic selected state", async ({ page }, testInfo) => {
  await page.goto("/library");

  const navigation = getPrimaryNavigation(page, testInfo.project.name);
  const current = navigation.getByRole("link", { name: "База знаний", exact: true });
  await expect(current).toHaveAttribute("aria-current", "page");
});

function primaryNavigationName(projectName: string): "Мобильная навигация" | "Основная" {
  return navigationMode(projectName) === "mobile" ? "Мобильная навигация" : "Основная";
}

function getPrimaryNavigation(page: Page, projectName: string) {
  return page.getByRole("navigation", { name: primaryNavigationName(projectName) });
}

function navigationMode(projectName: string): "desktop" | "mobile" {
  if (projectName === "desktop-chromium") {
    return "desktop";
  }

  if (projectName === "mobile-chromium") {
    return "mobile";
  }

  throw new Error(`No navigation mode configured for Playwright project ${projectName}`);
}

async function hoverUntilSidebarOpens(page: Page, sidebar: Locator, target: Locator) {
  await expect(async () => {
    await page.mouse.move(600, 500);
    await target.hover();
    await expect(sidebar).toHaveCSS("width", "256px", { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

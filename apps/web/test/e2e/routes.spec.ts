import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const destinations = [
  { path: "/", label: "Главная", heading: "Главная" },
] as const;

for (const destination of destinations) {
  test(`${destination.label} resolves with current navigation`, async ({
    page,
  }, testInfo) => {
    const response = await page.goto(destination.path);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      destination.heading,
    );
    await expect(page).toHaveTitle(
      new RegExp(`^${destination.label} · Sachkov Inside$`, "u"),
    );

    const navigation = getPrimaryNavigation(page, testInfo.project.name);
    await expect(navigation.getByRole("link")).toHaveCount(
      navigationMode(testInfo.project.name) === "mobile" ? 3 : 2,
    );
    await expect(
      navigation.getByRole("link", { name: destination.label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });

  test(`${destination.label} has no serious accessibility findings`, async ({
    page,
  }) => {
    await page.goto(destination.path);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const materialViolations = results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );

    expect(materialViolations).toEqual([]);
  });
}

test("root remains the canonical Home route", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Главная",
  );
});

test("неизвестный адрес отвечает 404 по-русски внутри оболочки", async ({
  page,
}, testInfo) => {
  const response = await page.goto("/does-not-exist");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Страница не найдена");
  await expect(page).toHaveTitle("Страница не найдена · Sachkov Inside");
  await expect(page.getByText("This page could not be found")).toHaveCount(0);
  await expect(
    getPrimaryNavigation(page, testInfo.project.name).getByRole("link", {
      name: "Главная",
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole("link", { name: "На главную" }).click();
  await expect(page).toHaveURL(/\/$/u);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
});

test("страница отправляет площадке свои Core Web Vitals, когда её скрывают", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Главная");
  // Первые метрики загрузки приходят сами; отчёт уходит, когда вкладка перестаёт быть видна.
  await page.waitForFunction(
    () => performance.getEntriesByName("inside:web-vital:TTFB", "mark").length > 0,
  );

  // Тело beacon видно только в перехвате; сам запрос идёт дальше, к настоящему обработчику.
  let sentReport = "null";
  await page.route("**/api/web-vitals", async (route) => {
    sentReport = route.request().postDataBuffer()?.toString("utf8") ?? "null";
    await route.continue();
  });
  const answered = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/web-vitals",
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  // Ответ настоящего обработчика: отчёт прошёл проверку источника и схемы и записан в журнал.
  const response = await answered;
  expect(response.status()).toBe(204);
  const body = JSON.parse(sentReport) as {
    readonly metrics: readonly { readonly name: string; readonly value: number }[];
    readonly route: string;
  };
  expect(body.route).toBe("/");
  expect(body.metrics.map((metric) => metric.name)).toContain("TTFB");
});

test("Manrope объявлен заранее: латиница и кириллица в preload, текст набран им", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Главная");
  await page.evaluate(() => document.fonts.ready);

  const fonts = await page.evaluate(() => ({
    bodyFamily: getComputedStyle(document.body).fontFamily,
    manropeReady: document.fonts.check("16px 'Manrope Variable'", "Главная Home"),
    preloaded: [...document.querySelectorAll("link[rel='preload'][as='font']")].map(
      (link) => link.getAttribute("href") ?? "",
    ),
  }));
  expect(fonts.bodyFamily).toMatch(/^"Manrope Variable", "Manrope Fallback"/u);
  expect(fonts.manropeReady).toBe(true);
  expect(fonts.preloaded).toEqual([
    expect.stringMatching(/manrope_cyrillic_wght_normal.*\.woff2$/u),
    expect.stringMatching(/manrope_latin_wght_normal.*\.woff2$/u),
  ]);
});

test("map remains available by direct URL without a primary navigation item", async ({
  page,
}, testInfo) => {
  const response = await page.goto("/map");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Карта Inside",
  );
  const navigation = getPrimaryNavigation(page, testInfo.project.name);
  await expect(navigation.getByRole("link")).toHaveCount(
    navigationMode(testInfo.project.name) === "mobile" ? 3 : 2,
  );
  await expect(navigation.getByRole("link", { name: "Карта" })).toHaveCount(0);
});

test("guest signs in through the desktop header or mobile Profile", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  if (navigationMode(testInfo.project.name) === "mobile") {
    await expect(page.locator("[data-public-header]")).toBeHidden();
    await page
      .getByRole("navigation", { name: "Мобильная навигация" })
      .getByRole("link", { name: "Профиль" })
      .click();
    await expect(page).toHaveURL(/\/account$/u);
  }
  const signIn = page.getByRole("button", { name: "Войти", exact: true });
  await expect(signIn).toBeEnabled();
  await expect(signIn).toBeInViewport();
  await expect(signIn.locator("xpath=ancestor::form")).toHaveAttribute(
    "action",
    "/auth/sign-in",
  );
  await expect(signIn.locator("xpath=ancestor::form")).toHaveAttribute(
    "method",
    "post",
  );
  await page.route("**/auth/sign-in", (route) =>
    route.fulfill({ body: "Sign-in received", contentType: "text/html" }),
  );
  const submitted = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/auth/sign-in",
  );
  await signIn.click();
  expect((await submitted).method()).toBe("POST");
});

for (const state of ["authenticated", "unavailable"] as const) {
  test(`${state} desktop account menu submits logout using POST`, async ({
    page,
  }, testInfo) => {
    test.skip(navigationMode(testInfo.project.name) !== "desktop");
    await page.route("**/auth/status", (route) =>
      route.fulfill({ json: { canManageMaterials: false, state } }),
    );
    await page.route("**/api/account", (route) =>
      route.fulfill({ json: linkedAccountPresentation() }),
    );
    await page.goto("/");
    const trigger = page.getByRole("button", {
      name: state === "authenticated" ? "Аккаунт" : "Сессия",
      exact: true,
    });
    await trigger.click();
    if (state === "authenticated")
      await expect(
        page.getByRole("menuitem", { name: "Профиль" }),
      ).toHaveAttribute("href", "/account");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.route("**/auth/sign-out", (route) =>
      route.fulfill({ body: "Logout received", contentType: "text/html" }),
    );
    const submitted = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/auth/sign-out",
    );
    await page
      .getByRole("menuitem", {
        name: state === "authenticated" ? "Выйти" : "Завершить сессию",
      })
      .click();
    expect((await submitted).method()).toBe("POST");
  });
}

test("unlinked Account sees centered onboarding once per authenticated session", async ({
  page,
}, testInfo) => {
  let authenticated = true;
  await page.route("**/auth/status", (route) =>
    route.fulfill({
      body: JSON.stringify({
        canManageMaterials: false,
        state: authenticated ? "authenticated" : "guest",
      }),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route("**/api/account", (route) =>
    route.fulfill({
      body: JSON.stringify(unlinkedAccountPresentation()),
      contentType: "application/json",
      status: 200,
    }),
  );

  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Подключите Telegram" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Доступ не активен")).toHaveCount(0);
  await expect(dialog.getByText("Получить доступ")).toHaveCount(0);
  await expect(dialog).not.toContainText("Membership");
  const [dialogBox, viewport] = await Promise.all([
    dialog.boundingBox(),
    page.evaluate(() => ({
      height: window.innerHeight,
      width: window.innerWidth,
    })),
  ]);
  expect(dialogBox).not.toBeNull();
  expect(dialogBox?.width).toBeLessThanOrEqual(480);
  expect(
    Math.abs(
      (dialogBox?.x ?? 0) + (dialogBox?.width ?? 0) / 2 - viewport.width / 2,
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      (dialogBox?.y ?? 0) + (dialogBox?.height ?? 0) / 2 - viewport.height / 2,
    ),
  ).toBeLessThanOrEqual(1);

  await dialog
    .getByRole("button", { name: "Закрыть подключение Telegram" })
    .click();
  await expect(dialog).toHaveCount(0);
  // Закрытый <dialog> исчезает из дерева доступности сразу, а отметку о закрытии пишет его событие
  // `close`, которое приходит следующей задачей. Перезагрузка раньше неё проверяла бы не то.
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem("inside.telegram-onboarding.dismissed"),
      ),
    )
    .toBe("true");
  await page.reload();
  await expect(dialog).toHaveCount(0);

  authenticated = false;
  await page.reload();
  if (navigationMode(testInfo.project.name) === "mobile") {
    await expect(
      page
        .getByRole("navigation", { name: "Мобильная навигация" })
        .getByRole("link", { name: "Профиль" }),
    ).toBeVisible();
  } else {
    await expect(
      page.getByRole("button", { name: "Войти", exact: true }),
    ).toBeEnabled();
  }
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem("inside.telegram-onboarding.dismissed"),
      ),
    )
    .toBeNull();

  authenticated = true;
  await page.reload();
  await expect(dialog).toBeVisible();
});

test("Telegram onboarding keeps the final linked result visible without Membership", async ({
  page,
}) => {
  const linkRef = "62000000-0000-4000-8000-000000000001";
  let state: "linked" | "linking" | "unlinked" = "unlinked";
  await page.addInitScript(() => {
    Object.defineProperty(window, "open", {
      configurable: true,
      value: () => ({
        close: () => undefined,
        location: {
          replace: (url: string) => {
            sessionStorage.setItem("test.telegram-opened", url);
          },
        },
        opener: null,
      }),
    });
  });
  await page.route("**/auth/status", (route) =>
    route.fulfill({
      body: JSON.stringify({
        canManageMaterials: false,
        state: "authenticated",
      }),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route("**/api/account**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/account/telegram-link/begin") {
      state = "linking";
      return route.fulfill({
        body: JSON.stringify({
          kind: "received",
          state: {
            deepLink: "https://t.me/inside_test_bot?start=opaque",
            expiresAt: "2030-01-01T00:05:00.000Z",
            linkRef,
            status: "pending",
          },
        }),
        contentType: "application/json",
        status: 200,
      });
    }
    if (pathname === "/api/account/telegram-link/confirm") {
      state = "linked";
      return route.fulfill({
        body: JSON.stringify({
          kind: "received",
          state: {
            expiresAt: "2030-01-01T00:05:00.000Z",
            linkRef,
            status: "linked",
          },
        }),
        contentType: "application/json",
        status: 200,
      });
    }
    return route.fulfill({
      body: JSON.stringify(
        state === "linked"
          ? linkedAccountPresentation()
          : state === "linking"
            ? linkingAccountPresentation(linkRef)
            : unlinkedAccountPresentation(),
      ),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/");
  const dialog = page.locator(
    "dialog[aria-labelledby='telegram-onboarding-heading']",
  );
  await expect(dialog).toHaveAccessibleName("Подключите Telegram");
  await dialog.getByRole("button", { name: "Подключить Telegram" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("test.telegram-opened")),
    )
    .toBe("https://t.me/inside_test_bot?start=opaque");
  await expect(
    dialog.getByRole("button", { name: "Проверить связь" }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await expect(dialog.getByText("Telegram подключён")).toBeVisible();
  await expect(dialog).not.toContainText("Доступ активен");
  await expect(dialog).not.toContainText("Membership");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Продолжить" }).click();
  await page.evaluate(() => {
    sessionStorage.removeItem("inside.telegram-onboarding.dismissed");
  });
  await page.reload();
  await expect(dialog).toHaveCount(0);
});

test("manager shell preserves desktop editor access and the four-item mobile dock", async ({
  page,
}, testInfo) => {
  await page.route("**/auth/status", (route) =>
    route.fulfill({
      body: JSON.stringify({
        canManageMaterials: true,
        state: "authenticated",
      }),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route("**/api/account", (route) =>
    route.fulfill({ json: linkedAccountPresentation() }),
  );
  await page.goto("/");

  const editorLink = (
    getPrimaryNavigation(page, testInfo.project.name)
  ).getByRole("link", { name: "Редактор", exact: true });
  if (navigationMode(testInfo.project.name) === "desktop") {
    await expect(editorLink).toHaveAttribute("href", "/authoring/materials");
  } else {
    await expect(editorLink).toHaveCount(0);
  }
});

test("authoring route owns a dedicated shell outside the public application shell", async ({
  page,
}, testInfo) => {
  test.skip(navigationMode(testInfo.project.name) !== "desktop");

  await page.goto("/authoring/materials/new");

  await expect(
    page.getByRole("heading", { name: "Нет доступа к редактору" }),
  ).toBeVisible();
  const signIn = page.getByRole("button", { name: "Войти" });
  await expect(signIn).toBeEnabled();
  await expect(signIn.locator("xpath=ancestor::form")).toHaveAttribute(
    "action",
    "/auth/sign-in",
  );
  await expect(signIn.locator("xpath=ancestor::form")).toHaveAttribute(
    "method",
    "post",
  );
  await expect(
    page.getByRole("complementary", { name: "Боковая панель" }),
  ).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Основная" })).toHaveCount(
    0,
  );
  const authoringSidebar = page.getByRole("complementary", {
    name: "Редактор",
  });
  await expect(authoringSidebar).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);

  const sidebarBox = await authoringSidebar.boundingBox();
  const box = await page.getByRole("main").boundingBox();
  expect(sidebarBox?.x).toBe(0);
  expect(box?.x).toBe(sidebarBox?.width);
  expect((box?.width ?? 0) + (sidebarBox?.width ?? 0)).toBe(1_440);
});

test("auth control hydrates without a server-client mismatch", async ({
  page,
}, testInfo) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("hydrated")) {
      hydrationErrors.push(message.text());
    }
  });

  await page.goto("/");
  if (navigationMode(testInfo.project.name) === "mobile") {
    await expect(
      page
        .getByRole("navigation", { name: "Мобильная навигация" })
        .getByRole("link", { name: "Профиль" }),
    ).toBeVisible();
  } else {
    await expect(
      page.getByRole("button", { name: "Войти", exact: true }),
    ).toBeEnabled();
  }

  expect(hydrationErrors).toEqual([]);
});

test("failed authentication returns a visible recoverable state", async ({
  page,
}, testInfo) => {
  await page.goto("/?authentication=failed");

  const feedback = page.getByRole("status").filter({ hasText: "Вход не завершён" });
  await expect(feedback).toContainText("Вход не завершён. Повторите попытку");

  if (navigationMode(testInfo.project.name) === "mobile") {
    const [feedbackBox, navigationBox] = await Promise.all([
      feedback.boundingBox(),
      (getPrimaryNavigation(page, testInfo.project.name)).boundingBox(),
    ]);
    expect(
      (feedbackBox?.y ?? 0) + (feedbackBox?.height ?? 0),
    ).toBeLessThanOrEqual(navigationBox?.y ?? 0);
  }

  const dismiss = page.getByRole("button", { name: "Закрыть уведомление" });
  await dismiss.focus();
  await expect(dismiss).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(feedback).toHaveCount(0);
});

test("incomplete global logout is reported without claiming success", async ({
  page,
}) => {
  await page.goto("/?authentication=logout-incomplete");

  await expect(page.getByRole("status").filter({ hasText: "Локальная сессия завершена" })).toContainText(
    "Локальная сессия завершена, но глобальный выход не подтверждён",
  );
});

test("navigation works with pointer input", async ({ page }, testInfo) => {
  await page.goto("/map");

  const libraryLink = (
    getPrimaryNavigation(page, testInfo.project.name)
  ).getByRole("link", {
    name: "Главная",
    exact: true,
  });
  await libraryLink.click();

  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Главная",
  );
});

test("header stays fixed while desktop content scrolls", async ({
  page,
}, testInfo) => {
  test.skip(navigationMode(testInfo.project.name) !== "desktop");
  await page.goto("/map");
  const header = page.getByRole("banner");
  const before = await header.boundingBox();
  const main = page.getByRole("main");
  const mainBefore = await main.boundingBox();
  await header.getByRole("link", { name: "Главная", exact: true }).hover();
  await expect.poll(() => main.boundingBox()).toEqual(mainBefore);
  await main.evaluate((element) => {
    element.scrollTop = 300;
  });
  await expect.poll(() => header.boundingBox()).toEqual(before);
});

test("mobile uses the bottom dock without a public header", async ({
  page,
}, testInfo) => {
  test.skip(navigationMode(testInfo.project.name) !== "mobile");
  await page.goto("/");
  await expect(page.locator("[data-public-header]")).toBeHidden();
  await expect(page.getByRole("button", { name: "Открыть меню" })).toHaveCount(
    0,
  );
  const navigation = getPrimaryNavigation(page, testInfo.project.name);
  await expect(navigation).toBeInViewport();
  const box = await navigation.boundingBox();
  expect(box?.y).toBeGreaterThan(700);
});

test("keyboard reaches the visible desktop or mobile navigation", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Перейти к содержанию" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  if (navigationMode(testInfo.project.name) === "desktop") {
    await expect(
      page.getByRole("link", { name: "Sachkov Inside" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
  }
  const navigation = getPrimaryNavigation(page, testInfo.project.name);
  await expect(
    navigation.getByRole("link", { name: "Главная", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  const libraryLink = navigation.getByRole("link", {
    name: "Закладки",
    exact: true,
  });
  await expect(libraryLink).toBeFocused();
  const outline = await libraryLink.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(outline.style).not.toBe("none");
  expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
});

test("shell exposes essential landmarks to assistive technology", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const accessibilityTree = await page.locator("body").ariaSnapshot();
  if (navigationMode(testInfo.project.name) === "desktop") {
    expect(accessibilityTree).toContain("- banner:");
  } else {
    await expect(page.locator("[data-public-header]")).toBeHidden();
  }
  expect(accessibilityTree).toContain("- main:");
  expect(accessibilityTree).toContain(
    '- heading "Главная" [level=1]',
  );
  const navigation = getPrimaryNavigation(page, testInfo.project.name);
  await expect(
    navigation.getByRole("link", { name: "Главная", exact: true }),
  ).toBeVisible();
  if (navigationMode(testInfo.project.name) === "mobile") {
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      audit.violations.filter(
        ({ impact }) => impact === "serious" || impact === "critical",
      ),
    ).toEqual([]);
  }
});

test("content reflows without horizontal page overflow at 200% text size", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.locator("html").evaluate((element) => {
    element.style.fontSize = "200%";
  });

  const overflow = await page.locator("html").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  await expect(
    getPrimaryNavigation(page, testInfo.project.name),
  ).toBeVisible();
});

test("reduced motion removes navigation transitions", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const transitionProperty = await (
    getPrimaryNavigation(page, testInfo.project.name)
  )
    .getByRole("link", { name: "Главная", exact: true })
    .evaluate((element) => getComputedStyle(element).transitionProperty);

  expect(transitionProperty).toBe("none");
});

test("current destination exposes its semantic selected state", async ({
  page,
}, testInfo) => {
  await page.goto("/");

  const navigation = getPrimaryNavigation(page, testInfo.project.name);
  const current = navigation.getByRole("link", {
    name: "Главная",
    exact: true,
  });
  await expect(current).toHaveAttribute("aria-current", "page");
});

function primaryNavigationName(
  projectName: string,
): "Мобильная навигация" | "Основная" {
  return navigationMode(projectName) === "mobile"
    ? "Мобильная навигация"
    : "Основная";
}

function getPrimaryNavigation(page: Page, projectName: string) {
  const navigation = page.getByRole("navigation", {
    name: primaryNavigationName(projectName),
  });
  return navigation;
}

function navigationMode(projectName: string): "desktop" | "mobile" {
  if (projectName === "desktop-chromium") {
    return "desktop";
  }

  if (projectName === "mobile-chromium") {
    return "mobile";
  }

  throw new Error(
    `No navigation mode configured for Playwright project ${projectName}`,
  );
}

function unlinkedAccountPresentation() {
  return {
    profile: { kind: "missing" },
    telegramMembership: {
      link: { kind: "unlinked" },
      membership: { kind: "inactive" },
    },
  };
}

function linkingAccountPresentation(linkRef: string) {
  return {
    profile: { kind: "missing" },
    telegramMembership: {
      link: {
        expiresAt: "2030-01-01T00:05:00.000Z",
        kind: "linking",
        linkRef,
      },
      membership: { kind: "inactive" },
    },
  };
}

function linkedAccountPresentation() {
  return {
    profile: { kind: "missing" },
    telegramMembership: {
      link: { kind: "linked" },
      membership: { kind: "active" },
    },
  };
}

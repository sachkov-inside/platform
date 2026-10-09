import { expectImmediateMobileNavigation } from "../support/immediate-mobile-navigation";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const catalog = {
  kind: "ready",
  facets: { formats: [], series: [], topics: [] },
  items: Array.from({ length: 18 }, (_, index) => ({
    access: "free",
    availability: "available",
    format: "Гайд",
    formatSlug: "guide",
    seriesMemberships: [],
    slug: `navigation-${String(index)}`,
    summary: "Материал для проверки возврата к чтению.",
    tags: [],
    title: `Навигация ${String(index + 1)}`,
    topic: "Platform",
    topicSlug: "platform",
  })),
  nextCursor: null,
  totalCount: 18,
};

const materialCatalogRequests = /\/api\/(?:home|library)\/materials(?:\?|$)/u;

// Шапка телефона: логотип «Главная» стоит вне списка разделов, поэтому ищется в самой шапке.
function header(page: Page) {
  return page.locator("[data-mobile-header]");
}

function navigation(page: Page) {
  return page.getByRole("navigation", { name: "Мобильная навигация" });
}

function homeLink(page: Page) {
  return header(page).getByRole("link", { name: "Главная", exact: true });
}

/**
 * Нажатие по центру ссылки, как палец. Шапка прилипает к верху, и `locator.click()` перед нажатием
 * прокручивает страницу к её месту в потоке документа: позиция ленты терялась бы до перехода.
 */
async function tap(page: Page, link: Locator) {
  const box = await link.boundingBox();
  if (box === null) throw new Error("Navigation link is missing");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

function formatChip(page: Page, name: string) {
  return page
    .getByRole("group", { name: "Формат материала" })
    .getByRole("button", { name, exact: true });
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"));
  await page.route("**/auth/status", (route) =>
    route.fulfill({
      json: { state: "guest", canManageMaterials: false, accountId: null },
    }),
  );
  await page.route("**/api/account", (route) =>
    route.fulfill({ status: 401, json: { kind: "unauthorized" } }),
  );
});

test("root tabs restore Home feed URL and scroll without a second loading screen", async ({
  page,
}) => {
  let requests = 0;
  await page.route(materialCatalogRequests, (route) => {
    requests++;
    return route.fulfill({ json: catalog });
  });
  // Поиска на Главной нет: состояние ленты, которое помнит вкладка, — выбранный формат.
  await page.goto("/?format=guide");
  await expect(
    page.getByRole("heading", { name: "Навигация 1", exact: true }),
  ).toBeVisible();
  await expect(formatChip(page, "Гайды")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.evaluate(() => {
    window.scrollTo(0, 700);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(700);
  await tap(page, navigation(page).getByRole("link", { name: "Профиль" }));
  await expect(
    page.getByRole("heading", { name: "Войдите в аккаунт" }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const loadedRequests = requests;
  await expect(homeLink(page)).toHaveAttribute("href", /format=guide/u);
  await homeLink(page).click();
  await expect(formatChip(page, "Гайды")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(700);
  // Лента не показывает второй экран загрузки: материалы приходят из памяти браузера.
  await expect(page.locator('section.home-feed[aria-busy="true"]')).toHaveCount(
    0,
  );
  expect(requests).toBe(loadedRequests);
  await page.goBack();
  await expect(page).toHaveURL(/\/account$/u);
  await expect(
    navigation(page).getByRole("link", { name: "Профиль" }),
  ).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(formatChip(page, "Гайды")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("Home feed data is prefetched before the first tab visit", async ({
  page,
}) => {
  let requests = 0;
  await page.route(materialCatalogRequests, (route) => {
    requests++;
    return route.fulfill({ json: catalog });
  });
  await page.goto("/account");
  await expect.poll(() => requests).toBe(1);
  await homeLink(page).click();
  await expect(
    page.getByRole("heading", { name: "Навигация 1", exact: true }),
  ).toBeVisible();
  expect(requests).toBe(1);
});

test("fast repeated navigation remains clickable during the transition", async ({
  page,
}) => {
  await page.route(materialCatalogRequests, (route) =>
    route.fulfill({ json: catalog }),
  );
  await page.goto("/");
  await expect(formatChip(page, "Все")).toBeVisible();
  // Real pointer input bypasses Playwright's animation-stability wait, as a quick user tap does.
  await tap(page, navigation(page).getByRole("link", { name: "Профиль" }));
  await expect(page).toHaveURL(/\/account$/u);
  await tap(page, homeLink(page));
  await expect(page).toHaveURL(/\/$/u);
  await expect(homeLink(page)).toHaveAttribute("aria-current", "page");
});

test("public canvas, navigation geometry and reduced motion are consistent", async ({
  page,
}) => {
  await page.route(materialCatalogRequests, (route) =>
    route.fulfill({ json: catalog }),
  );
  await page.goto("/account");
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const before = await header(page).boundingBox();
    await homeLink(page).click();
    await expect(formatChip(page, "Все")).toBeVisible();
    const after = await header(page).boundingBox();
    expect(after?.width).toBe(before?.width);
    expect(after?.y).toBe(before?.y);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await navigation(page).getByRole("link", { name: "Профиль" }).click();
  }
  expect(
    await page.locator('meta[name="theme-color"]').getAttribute("content"),
  ).toBe("#ffffff");
  expect(
    await page.evaluate(() =>
      [document.documentElement, document.body].map(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ),
  ).toEqual(["rgb(255, 255, 255)", "rgb(255, 255, 255)"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".mobile-navigation-link")
      .first()
      .evaluate((element) => getComputedStyle(element).transitionDuration),
  ).toBe("0s");
  expect(
    (await new AxeBuilder({ page }).include(".mobile-navigation").analyze())
      .violations,
  ).toEqual([]);
});

test("background Profile failure retains data but lost authorization removes it", async ({
  page,
}) => {
  let accountStatus = 200;
  let requests = 0;
  await page.route("**/api/account", (route) => {
    requests++;
    return route.fulfill({
      status: accountStatus,
      json: {
        profile: { kind: "missing" },
        telegramMembership: {
          link: { kind: "linked" },
          membership: { kind: "stale" },
        },
      },
    });
  });
  await page.route(materialCatalogRequests, (route) =>
    route.fulfill({ json: catalog }),
  );
  await page.goto("/account/access");
  await expect(
    page.getByRole("heading", { name: "Аккаунт", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Выйти из аккаунта" }),
  ).toBeVisible();
  for (const status of [503, 401]) {
    accountStatus = status;
    const before = requests;
    // Платформа перечитывает состояние сама: возврат во вкладку и есть это действие.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await expect.poll(() => requests).toBeGreaterThan(before);
    if (status === 503) {
      await expect(
        page.getByRole("button", { name: "Выйти из аккаунта" }),
      ).toBeVisible();
      await expect(
        page.getByText("Состояние аккаунта сейчас недоступно."),
      ).toHaveCount(0);
    } else {
      await expect(
        page.getByText("Войдите, чтобы управлять связью с Telegram."),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Выйти из аккаунта" }),
      ).toHaveCount(0);
    }
  }
});

test("native Back preserves the latest Home feed filter and scroll for the next tab visit", async ({
  page,
}) => {
  await page.route(materialCatalogRequests, (route) =>
    route.fulfill({ json: catalog }),
  );
  await page.goto("/account");
  await homeLink(page).click();
  await expect(
    page.getByRole("heading", { name: "Навигация 1", exact: true }),
  ).toBeVisible();
  await formatChip(page, "Видео").click();
  await expect(page).toHaveURL(/format=video/u);
  // Позицию ленты приложение записывает по событию scroll, а браузер доставляет его в следующем кадре:
  // «Назад» в том же кадре уносит несохранённую позицию (#735). Событие рассылается всем обработчикам
  // целиком до следующей команды теста.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        document.addEventListener(
          "scroll",
          () => {
            resolve();
          },
          { capture: true, once: true },
        );
        window.scrollTo(0, 700);
      }),
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(700);
  await page.goBack();
  await expect(page).toHaveURL(/\/account$/u);
  await homeLink(page).click();
  await expect(formatChip(page, "Видео")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(700);
});

test("a newer tab selection wins over an unfinished route request", async ({
  page,
}) => {
  await page.route(materialCatalogRequests, (route) =>
    route.fulfill({ json: catalog }),
  );
  await page.goto("/");
  await expect(formatChip(page, "Все")).toBeVisible();
  let started = false;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/account\?_rsc=/u, async (route) => {
    started = true;
    await held;
    await route.continue().catch(() => undefined);
  });
  try {
    await navigation(page).getByRole("link", { name: "Профиль" }).click();
    await expect.poll(() => started).toBe(true);
    await expect(page).toHaveURL(/\/$/u);
    await homeLink(page).click();
    await expect(page).toHaveURL(/\/$/u);
  } finally {
    release();
  }
  await expect(homeLink(page)).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "Войдите в аккаунт" }),
  ).toHaveCount(0);
});

test("changing account identity clears remembered tabs and the old Profile form", async ({
  page,
}) => {
  let accountId = "11111111-1111-4111-8111-111111111111";
  let accountRequests = 0;
  await page.route("**/auth/status", (route) =>
    route.fulfill({
      json: { state: "authenticated", canManageMaterials: false, accountId },
    }),
  );
  await page.route("**/api/account", (route) => {
    accountRequests++;
    return route.fulfill({
      json: {
        profile: { kind: "missing" },
        telegramMembership: {
          link: { kind: "linked" },
          membership: { kind: "active" },
        },
      },
    });
  });
  await page.route(materialCatalogRequests, (route) =>
    route.fulfill({
      json: {
        ...catalog,
        facets: {
          ...catalog.facets,
          series: Array.from({ length: 5 }, (_, index) => ({
            id: `series-${String(index)}`,
            slug: `series-${String(index)}`,
            name: `Продукт ${String(index)}`,
            count: 1,
            summary: "Продукт для проверки возврата",
          })),
        },
      },
    }),
  );
  await page.goto("/?format=guide");
  await expect(formatChip(page, "Гайды")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await navigation(page).getByRole("link", { name: "Профиль" }).click();
  const name = page.getByRole("textbox", { name: "Имя", exact: true });
  await name.fill("Старый аккаунт");
  await expect(homeLink(page)).toHaveAttribute("href", /format=guide/u);
  const before = accountRequests;
  accountId = "22222222-2222-4222-8222-222222222222";
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await expect.poll(() => accountRequests).toBeGreaterThan(before);
  await expect(name).toHaveValue("");
  await expect(homeLink(page)).toHaveAttribute("href", "/");
  await homeLink(page).click();
  await expect(formatChip(page, "Все")).toHaveAttribute("aria-pressed", "true");
});

test("a cold tab shows its destination immediately while the route response is still pending", async ({
  page,
}) => {
  await page.route(materialCatalogRequests, (route) =>
    route.fulfill({ json: catalog }),
  );
  await expectImmediateMobileNavigation(page);
});

test("external Home query changes update the selected format and results", async ({
  page,
}) => {
  await page.route(materialCatalogRequests, (route) =>
    route.fulfill({ json: catalog }),
  );
  // Текст поиска из старой ссылки Главная не применяет и убирает из адреса (решение владельца 09.10.2026).
  await page.goto("/?format=note&q=навигация");
  // SSR already exposes the selected button; loaded API content proves client navigation is mounted.
  await expect(
    page.getByRole("heading", { name: "Навигация 1", exact: true }),
  ).toBeVisible();
  const notes = page.getByRole("button", { name: "Заметки", exact: true });
  await expect(notes).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBeNull();
  // Native history integration uses the same search-parameter notification as an App Router link.
  await page.evaluate(() => {
    window.history.pushState(null, "", "/?format=guide");
  });
  await expect(
    page.getByRole("button", { name: "Гайды", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.goBack();
  await expect(notes).toHaveAttribute("aria-pressed", "true");
  await formatChip(page, "Видео").click();
  await expect(formatChip(page, "Видео")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(() => new URL(page.url()).searchParams.get("format"))
    .toBe("video");
});

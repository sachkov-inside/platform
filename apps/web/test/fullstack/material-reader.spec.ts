import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("server-renders the safe PostgreSQL catalog through Nest", async ({
  page,
  request,
}) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  const documentResponse = await request.get("/library");
  const initialHtml = await documentResponse.text();

  expect(documentResponse.status()).toBe(200);
  expect(initialHtml).toContain("Developer Pipeline без потери контекста");
  expect(initialHtml).not.toContain("Закрытое содержимое для участников");

  const continuation = page.waitForResponse(
    (response) =>
      response.url().includes("/api/library/materials?after=") &&
      response.status() === 200,
  );
  const browserResponse = await page.goto("/library");
  expect(browserResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Библиотека", level: 1 })).toBeVisible();
  await expect(page.getByText("Для участников")).toBeVisible();
  await expect(page.getByText("Бесплатно").first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Developer Pipeline без потери контекста" }),
  ).toHaveAttribute("href", "/materials/developer-pipeline-bez-poteri-konteksta");
  await expect(page).toHaveTitle("Библиотека · Inside");

  await page.getByRole("main").evaluate((element) => {
    element.scrollTo({ top: element.scrollHeight });
  });
  await page.evaluate(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight });
  });
  await continuation;
  await expect(page.getByRole("article")).toHaveCount(13);
  await expect(
    page.getByRole("link", { name: "Как устроен Inside Platform" }),
  ).toBeVisible();
  await expect(
    page.getByText("13 материалов найдено · 13 материалов загружено"),
  ).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Перейти к содержанию" })).toBeFocused();

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);

  const overflow = await page.locator("html").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  expect(browserErrors).toEqual([]);
});

test("preserves canonical RU/EN search across reload, history and sharing", async ({
  page,
  request,
}) => {
  const englishUrl = "/library?q=developer+pipeline";
  const englishDocument = await request.get(englishUrl);
  const englishHtml = await englishDocument.text();
  expect(englishDocument.status()).toBe(200);
  expect(englishHtml).toContain("Developer Pipeline без потери контекста");
  expect(englishHtml).not.toContain("Закрытое содержимое для участников");

  await page.goto(englishUrl);
  await expect(page.getByLabel("Поиск по библиотеке")).toHaveValue(
    "developer pipeline",
  );
  await expect(
    page.getByRole("link", { name: "Developer Pipeline без потери контекста" }),
  ).toBeVisible();
  await expect(page.getByText("1 материал найден")).toBeVisible();
  const sharedUrl = page.url();

  await page.reload();
  expect(page.url()).toBe(sharedUrl);
  await expect(
    page.getByRole("link", { name: "Developer Pipeline без потери контекста" }),
  ).toBeVisible();

  await page.goto(
    "/library?q=%D0%B0%D1%80%D1%85%D0%B8%D1%82%D0%B5%D0%BA%D1%82%D1%83%D1%80%D0%BD%D0%B0%D1%8F+07",
  );
  await expect(
    page.getByRole("link", { name: "Архитектурная заметка 07" }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("link", { name: "Developer Pipeline без потери контекста" }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("link", { name: "Архитектурная заметка 07" }),
  ).toBeVisible();

  await page.getByLabel("Поиск по библиотеке").fill("nothing can match 404404");
  await page.getByRole("button", { name: "Найти" }).click();
  await expect(page.getByRole("heading", { name: "Ничего не найдено" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Сбросить поиск и фильтры" }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("q")).toBe(
    "nothing can match 404404",
  );

  await page.goto("/library?topic=INVALID&sort=broken&ignored=value");
  await expect(page).toHaveURL(/\/library$/u);
  await page.goto("/library?after=opaque_cursor");
  await expect(page).toHaveURL(/\/library$/u);
});

test("server-renders the representative PostgreSQL Material through Nest", async ({
  page,
  request,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.addInitScript(() => {
    const measurements = {
      cls: 0,
      inp: 0,
      lcp: 0,
      shifts: [] as { readonly sources: readonly string[]; readonly value: number }[],
    };
    Object.defineProperty(window, "__readerPerformance", { value: measurements });
    if (PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & {
            hadRecentInput: boolean;
            sources?: readonly { readonly node?: Node }[];
            value: number;
          };
          if (!shift.hadRecentInput) {
            measurements.cls += shift.value;
            measurements.shifts.push({
              sources: (shift.sources ?? []).map(({ node }) => {
                if (!(node instanceof Element)) {
                  return node instanceof Node ? node.nodeName : "unknown";
                }
                const id = node.id.length === 0 ? "" : `#${node.id}`;
                const classes = [...node.classList]
                  .slice(0, 4)
                  .map((className) => `.${className}`)
                  .join("");
                return `${node.tagName.toLowerCase()}${id}${classes}`;
              }),
              value: shift.value,
            });
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    }
    if (PerformanceObserver.supportedEntryTypes.includes("largest-contentful-paint")) {
      new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1);
        measurements.lcp = last?.startTime ?? measurements.lcp;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    }
    if (PerformanceObserver.supportedEntryTypes.includes("event")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          measurements.inp = Math.max(measurements.inp, entry.duration);
        }
      }).observe({
        type: "event",
        buffered: true,
        durationThreshold: 16,
      } as PerformanceObserverInit);
    }
  });
  const documentResponse = await request.get("/materials/kak-ustroen-inside-platform");
  const initialHtml = await documentResponse.text();

  expect(documentResponse.status()).toBe(200);
  expect(initialHtml).toContain("Как устроен Inside Platform");
  expect(initialHtml).toContain("Первый вертикальный срез");

  const browserResponse = await page.goto("/materials/kak-ustroen-inside-platform");
  expect(browserResponse?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Как устроен Inside Platform", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Первый вертикальный срез", level: 2 }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Как устроен Inside Platform · Inside");
  await expect(page.getByRole("link", { name: "В Библиотеку" }).first()).toBeVisible();
  await expect(page.getByRole("main")).toContainText("PostgreSQL хранит current Material");
  await expect(page.getByRole("article")).toHaveCount(1);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Перейти к содержанию" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();

  if (testInfo.project.name === "mobile-chromium") {
    await page.locator("summary", { hasText: "В этом материале" }).click();
  }
  await expect(page.getByRole("navigation", { name: "В этом материале" })).toBeVisible();
  await page.getByRole("link", { name: "Проверяемый результат" }).click();
  await page.waitForTimeout(100);

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);

  const overflow = await page.locator("html").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  const metrics = await page.evaluate(() => {
    const navigation = window.performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    const measured = (
      window as unknown as Window & {
        __readerPerformance: {
          cls: number;
          inp: number;
          lcp: number;
          shifts: readonly {
            readonly sources: readonly string[];
            readonly value: number;
          }[];
        };
      }
    ).__readerPerformance;
    return {
      ...measured,
      ttfb: navigation === undefined ? Number.POSITIVE_INFINITY : navigation.responseStart,
    };
  });
  expect(metrics.ttfb).toBeLessThanOrEqual(800);
  expect(metrics.lcp).toBeLessThanOrEqual(2_500);
  expect(metrics.inp).toBeLessThanOrEqual(200);
  expect(metrics.cls, JSON.stringify(metrics.shifts)).toBeLessThanOrEqual(0.1);
  expect(browserErrors).toEqual([]);
});

test("renders a locked teaser with the configured CTA and fails closed on invalid proof", async ({
  page,
  request,
}) => {
  const response = await page.goto(
    "/materials/developer-pipeline-bez-poteri-konteksta",
  );
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      name: "Developer Pipeline без потери контекста",
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Материал доступен в Мастерской",
      level: 2,
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Получить доступ" })).toHaveAttribute(
    "href",
    process.env.FULLSTACK_MEMBERSHIP_ACQUISITION_URL ??
      "https://t.me/tribute",
  );
  await expect(page.getByText("Закрытое содержимое для участников")).toHaveCount(0);

  const invalidProof = await request.get(
    `${process.env.FULLSTACK_API_BASE_URL ?? "http://127.0.0.1:3001"}/materials/developer-pipeline-bez-poteri-konteksta`,
    { headers: { authorization: "Bearer not-a-jwt" } },
  );
  expect(invalidProof.status()).toBe(401);
  expect(invalidProof.headers()["cache-control"]).toBe("private, no-store");
  await expect(invalidProof.json()).resolves.toMatchObject({
    code: "invalid_proof",
  });
});

test("carries the authenticated owner through Web to ContentAccess", async ({
  context,
  page,
}) => {
  const cookieName = process.env.FULLSTACK_LOGTO_COOKIE_NAME;
  const session = process.env.FULLSTACK_LOGTO_SESSION;
  if (cookieName === undefined || session === undefined) {
    throw new Error("Full-stack Logto session fixture is missing");
  }
  await context.addCookies([
    {
      name: cookieName,
      value: session,
      url: process.env.FULLSTACK_WEB_BASE_URL ?? "http://127.0.0.1:3000",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  const reader = await page.goto("/materials/developer-pipeline-bez-poteri-konteksta");
  expect(reader?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      name: "Developer Pipeline без потери контекста",
      level: 1,
    }),
  ).toBeVisible();
  await expect(page.getByText("Закрытое содержимое для участников.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Получить доступ" })).toHaveCount(0);

  await page.goto("/library");
  const membershipCard = page
    .getByRole("article")
    .filter({ hasText: "Developer Pipeline без потери контекста" });
  await expect(membershipCard.getByText("Доступно")).toBeVisible();

  const bffResponse = await context.request.get(
    `${process.env.FULLSTACK_WEB_BASE_URL ?? "http://127.0.0.1:3000"}/api/library/materials`,
  );
  expect(bffResponse.status()).toBe(200);
  expect(bffResponse.headers()["cache-control"]).toBe("private, no-store");
  await expect(bffResponse.json()).resolves.toMatchObject({
    kind: "ready",
    items: expect.arrayContaining([
      expect.objectContaining({
        slug: "developer-pipeline-bez-poteri-konteksta",
        availability: "available",
      }),
    ]),
  });
});

test("returns the production not-found state for an unpublished slug", async ({ page }) => {
  await page.goto("/materials/not-published");

  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
  await expect(page.getByRole("heading", { name: "Материал не найден" })).toBeVisible();
  await expect(page.getByRole("link", { name: "В Библиотеку" })).toBeVisible();
});

test("keeps desktop shell fixed while main content owns scrolling", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");

  await page.addInitScript(() => {
    Object.defineProperty(window, "__shellCls", { value: { value: 0 } });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          readonly hadRecentInput: boolean;
          readonly value: number;
        };
        if (!shift.hadRecentInput) {
          (
            window as unknown as Window & {
              readonly __shellCls: { value: number };
            }
          ).__shellCls.value += shift.value;
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("/materials/kak-ustroen-inside-platform");
  const sidebar = page.getByRole("complementary", { name: "Боковая панель" });
  const main = page.getByRole("main");
  const collapsedMainRect = await main.evaluate((element) => {
    const { width, x } = element.getBoundingClientRect();
    return { width, x };
  });

  await page.evaluate(() => {
    (
      window as unknown as Window & {
        readonly __shellCls: { value: number };
      }
    ).__shellCls.value = 0;
  });
  await sidebar.hover();
  await expect
    .poll(() =>
      main.evaluate((element) => {
        const { width, x } = element.getBoundingClientRect();
        return { width, x };
      }),
    )
    .toEqual(collapsedMainRect);
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as Window & {
            readonly __shellCls: { value: number };
          }
        ).__shellCls.value,
    ),
  ).toBeLessThanOrEqual(0.001);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(100);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBe(0);

  await main.hover({ position: { x: 600, y: 400 } });
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(100);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

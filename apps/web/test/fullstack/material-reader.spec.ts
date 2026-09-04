import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

test("server-renders the mobile-first Home showcase from ContentLibrary", async ({
  page,
  request,
}, testInfo) => {
  const documentResponse = await request.get("/");
  const initialHtml = await documentResponse.text();
  expect(documentResponse.status()).toBe(200);
  expect(initialHtml).toContain("Новые видео");
  expect(initialHtml).toContain("Видео про Developer Pipeline");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Главная", level: 1 })).toBeAttached();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.getByText(/продолжить/iu)).toHaveCount(0);
  const sectionOrder = await page.locator("main section > h2, main section > div > h2").evaluateAll(
    (headings) => headings.map((heading) => heading.textContent?.trim()),
  );
  expect(sectionOrder).toEqual([
    "Темы",
    "Новые видео",
    "Плейлисты",
    "Свежие гайды",
    "Заметки",
  ]);
  const videoCards = page
    .getByRole("heading", { name: "Новые видео", level: 2 })
    .locator("xpath=ancestor::section")
    .getByRole("article");
  await expect(videoCards).toHaveCount(3);
  await expect(videoCards.nth(0)).toContainText(/\d+:\d{2}/u);
  if (testInfo.project.name === "desktop-chromium") {
    const topicCard = page.locator("[data-topic-card]").first();
    const topicCover = topicCard.locator(".public-cover-grid");
    const topicRail = topicCard.locator("xpath=ancestor::ul");
    await topicCard.hover();
    await page.waitForTimeout(250);
    const [coverBox, railBox] = await Promise.all([
      topicCover.boundingBox(),
      topicRail.boundingBox(),
    ]);
    expect(coverBox).not.toBeNull();
    expect(railBox).not.toBeNull();
    expect(coverBox?.y).toBeGreaterThanOrEqual(railBox?.y ?? Number.POSITIVE_INFINITY);
  }
  if (testInfo.project.name === "mobile-chromium") {
    const [first, second] = await Promise.all([
      videoCards.nth(0).boundingBox(),
      videoCards.nth(1).boundingBox(),
    ]);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(Math.abs((first?.y ?? 0) - (second?.y ?? 0))).toBeLessThan(8);
    expect(second?.x).toBeGreaterThan(first?.x ?? 0);
    const scrollbarWidths = await page.evaluate(() => ({
      body: getComputedStyle(document.body).scrollbarWidth,
      html: getComputedStyle(document.documentElement).scrollbarWidth,
    }));
    expect(scrollbarWidths).toEqual({ body: "none", html: "none" });
  }
  await expectNoSeriousAccessibilityFindings(page);
  await expectNoHorizontalOverflow(page);
  await captureIssue271Evidence(page, testInfo, "home");
});

test("loads the safe PostgreSQL catalog through the client-owned Library query", async ({
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

  const documentResponse = await request.get("/library");
  const initialHtml = await documentResponse.text();

  expect(documentResponse.status()).toBe(200);
  expect(initialHtml).toContain("База знаний");
  expect(initialHtml).not.toContain("Developer Pipeline без потери контекста");
  expect(initialHtml).not.toContain("Закрытое содержимое для участников");

  const continuation = page.waitForResponse(
    (response) =>
      response.url().includes("/api/library/materials?after=") &&
      response.status() === 200,
  );
  const browserResponse = await page.goto("/library");
  expect(browserResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "База знаний", level: 1 })).toBeVisible();
  await expect(page.locator('[data-access-cover="locked"]')).toHaveCount(1);
  await expect(page.getByText("Бесплатно")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Темы", level: 2 })).toBeVisible();
  await expect(page.locator("[data-topic-card]")).toContainText("Platform");
  await expect(page.getByRole("heading", { name: "Плейлисты", level: 2 })).toBeVisible();
  await expect(page.locator("[data-playlist-card]")).toContainText(
    "Создание Platform Inside",
  );
  await expect(
    page.getByRole("link", { exact: true, name: "Developer Pipeline без потери контекста" }),
  ).toHaveAttribute(
    "href",
    "/materials/developer-pipeline-bez-poteri-konteksta?from=%2Flibrary",
  );
  await expect(page).toHaveTitle("База знаний · Inside");
  await captureIssue195Evidence(page, testInfo, "library");
  await captureIssue271Evidence(page, testInfo, "library");

  await page.getByRole("main").evaluate((element) => {
    element.scrollTo({ top: element.scrollHeight });
  });
  await page.evaluate(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight });
  });
  await continuation;
  const articles = page.getByRole("article");
  await expect.poll(() => articles.count()).toBeGreaterThanOrEqual(13);
  const loadedCount = await articles.count();
  expect(loadedCount).toBeGreaterThanOrEqual(13);
  await expect(
    page.getByRole("link", { exact: true, name: "Как устроен Inside Platform" }),
  ).toBeVisible();
  const catalogStatus = page.getByText(
    /^\d+ материал(?:а|ов)? найден(?:о)? · \d+ материал(?:а|ов)? загружен(?:о)?$/u,
  );
  await expect(catalogStatus).toBeVisible();
  const counts = (await catalogStatus.innerText()).match(/\d+/gu);
  expect(counts).toHaveLength(2);
  expect(Number(counts?.[0])).toBeGreaterThanOrEqual(loadedCount);
  expect(Number(counts?.[1])).toBe(loadedCount);

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

  await expect(page).toHaveURL(/\/library$/u);
  await page.reload();
  await expect(page.getByRole("article").first()).toBeVisible();
  await expect(page).toHaveURL(/\/library$/u);
  expect(browserErrors).toEqual([]);
});

test("preserves canonical RU/EN search across reload, history and sharing", async ({
  page,
  request,
}) => {
  let documentRequestCount = 0;
  page.on("request", (browserRequest) => {
    if (browserRequest.resourceType() === "document") {
      documentRequestCount += 1;
    }
  });
  const englishUrl = "/library?q=developer+pipeline";
  const englishDocument = await request.get(englishUrl);
  const englishHtml = await englishDocument.text();
  expect(englishDocument.status()).toBe(200);
  expect(englishHtml).toContain("База знаний");
  expect(englishHtml).not.toContain("Developer Pipeline без потери контекста");
  expect(englishHtml).not.toContain("Закрытое содержимое для участников");

  await page.goto(englishUrl);
  await expect(page.getByLabel("Поиск по Базе знаний")).toHaveValue(
    "developer pipeline",
  );
  await expect(
    page.getByRole("link", { exact: true, name: "Developer Pipeline без потери контекста" }),
  ).toBeVisible();
  await expect(page.getByText("2 материала найдено")).toBeVisible();
  const documentsBeforeFilter = documentRequestCount;
  const filteredResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/library/materials?") &&
      response.url().includes("format=guide") &&
      response.status() === 200,
  );
  const formatFilter = page.getByRole("radio", {
    name: /^Гайды \d+$/u,
  });
  await formatFilter.focus();
  await page.keyboard.press("Space");
  await expect(formatFilter).toBeChecked();
  await filteredResponse;
  expect(documentRequestCount).toBe(documentsBeforeFilter);
  expect(new URL(page.url()).searchParams.getAll("format")).toEqual(["guide"]);
  const sharedUrl = page.url();

  await page.reload();
  expect(page.url()).toBe(sharedUrl);
  await expect(
    page.getByRole("link", { exact: true, name: "Developer Pipeline без потери контекста" }),
  ).toBeVisible();

  await page.goto(
    "/library?q=%D0%B0%D1%80%D1%85%D0%B8%D1%82%D0%B5%D0%BA%D1%82%D1%83%D1%80%D0%BD%D0%B0%D1%8F+07",
  );
  await expect(
    page.getByRole("link", { name: "Архитектурная заметка 07" }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("link", { exact: true, name: "Developer Pipeline без потери контекста" }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("link", { name: "Архитектурная заметка 07" }),
  ).toBeVisible();

  await page.getByLabel("Поиск по Базе знаний").fill("nothing can match 404404");
  await expect(page.getByRole("heading", { name: "Ничего не найдено" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Сбросить поиск и фильтры" }),
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
}) => {
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
  await expect(page.getByRole("link", { name: "Назад в Базу знаний" }).first()).toBeVisible();
  await expect(page.getByRole("main")).toContainText("PostgreSQL хранит current Material");
  await expect(page.locator("[data-reader-body]")).toHaveCount(1);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Перейти к содержанию" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();

  const outline = page.getByRole("navigation", { name: "В этом материале" });
  if (!(await outline.isVisible())) {
    await page.getByLabel(/Содержание:/u).click();
  }
  await expect(outline).toBeVisible();
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

test("marks an anonymous video as watched without shifting the action", async ({ page }) => {
  await page.goto("/materials/produkt-i-inzhenernyy-kontekst");
  const markWatched = page.getByRole("button", { name: "Отметить просмотренным" });
  await expect(markWatched).toBeEnabled();
  const initialBox = await markWatched.boundingBox();
  expect(initialBox).not.toBeNull();

  await markWatched.click();
  const watched = page.getByRole("button", { name: "Просмотрено" });
  await expect(watched).toHaveAttribute("aria-pressed", "true");
  const watchedBox = await watched.boundingBox();
  expect(watchedBox).not.toBeNull();
  expect(watchedBox?.width).toBe(initialBox?.width);
  expect(watchedBox?.height).toBe(initialBox?.height);
  await expect.poll(() => page.evaluate(() => (
    Object.keys(localStorage).some((key) => key.startsWith("inside.video-progress.v1:"))
  ))).toBe(true);

  await page.reload();
  await expect(page.getByRole("button", { name: "Просмотрено" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
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
      name: "Продолжение для участников",
      level: 2,
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Получить доступ" })).toHaveAttribute(
    "href",
    process.env.FULLSTACK_MEMBERSHIP_ACQUISITION_URL ??
      "https://t.me/tribute",
  );
  await expect(page.getByText("Закрытое содержимое для участников")).toHaveCount(0);

  await expect(page.locator("[data-related-state]")).toHaveCount(0);

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
}, testInfo) => {
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

  await page.goto("/materials/produkt-i-inzhenernyy-kontekst");
  const markWatched = page.getByRole("button", { name: "Отметить просмотренным" });
  await expect(markWatched).toBeEnabled();
  await markWatched.click();
  await expect(page.getByRole("button", { name: "Просмотрено" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  const watched = page.getByRole("button", { name: "Просмотрено" });
  await expect(watched).toBeEnabled();
  await watched.click();
  await expect(page.getByRole("button", { name: "Отметить просмотренным" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

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
  await expect(membershipCard.locator("[data-access-cover]")).toHaveCount(0);

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

  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Редактор Базы знаний" }),
  ).toHaveCount(0);
  await closeTelegramOnboardingIfPresent(page);
  await captureIssue271Evidence(page, testInfo, "account");
  if (testInfo.project.name === "mobile-chromium") {
    await page.goto("/authoring/materials");
  } else {
    await page
      .getByRole("navigation", { name: "Основная" })
      .getByRole("link", { name: "Редактор", exact: true })
      .click();
  }
  await expect(page).toHaveURL(/\/authoring\/materials$/u);
  await page.getByRole("link", { name: "Темы", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Темы", level: 1 })).toBeVisible();
  await expect(page.locator('input[value="Platform"]')).toBeVisible();
  await captureIssue195Evidence(page, testInfo, "admin-topics");

  await page.getByRole("link", { name: "Плейлисты", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Плейлисты", level: 1 })).toBeVisible();
  await expect(page.locator('input[value="Создание Platform Inside"]')).toBeVisible();
  await captureIssue195Evidence(page, testInfo, "admin-playlists");
});

test("returns the production not-found state for an unpublished slug", async ({ page }) => {
  await page.goto(
    "/materials/not-published?from=%2Fseries%2Fplatform-inside",
  );

  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
  await expect(page.getByRole("heading", { name: "Материал не найден" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Назад к плейлисту" })).toHaveAttribute(
    "href",
    "/series/platform-inside",
  );
});

test("navigates Library → Topic → ordered Series and exposes canonical Reader context", async ({
  page,
  request,
}, testInfo) => {
  const topicDocument = await request.get("/topics/platform");
  const topicHtml = await topicDocument.text();
  expect(topicDocument.status()).toBe(200);
  expect(topicHtml).toContain("Создание Platform Inside");
  expect(topicHtml).toContain("Загружаем материалы темы");
  expect(topicHtml).not.toContain("Закрытое содержимое для участников");

  await page.goto("/library");
  const membershipCard = page
    .getByRole("article")
    .filter({ hasText: "Developer Pipeline без потери контекста" });
  const topicLink = membershipCard.getByRole("link", {
    name: "Platform",
    exact: true,
  });
  await topicLink.focus();
  await expect(topicLink).toBeFocused();
  await topicLink.press("Enter");
  await expect(page).toHaveURL(/\/topics\/platform\?from=%2Flibrary$/u);
  await expect(page.getByRole("link", { name: "Назад в Базу знаний" })).toHaveAttribute(
    "href",
    "/library",
  );
  await expect(page.getByRole("heading", { level: 1, name: "Platform" })).toBeVisible();
  await expect(page).toHaveTitle("Platform — тема · Inside");
  await expectLibraryNavigationActive(page, testInfo);
  await expect(page.locator('[data-access-cover="locked"]')).toBeVisible();
  const topicMaterialHref = await page
    .locator("[data-material-grid]")
    .getByRole("link", {
      name: "Developer Pipeline без потери контекста",
      exact: true,
    })
    .getAttribute("href");
  expect(
    new URL(topicMaterialHref ?? "", "http://127.0.0.1:3000").searchParams.get(
      "from",
    ),
  ).toBe("/topics/platform?from=%2Flibrary");
  await expectNoSeriousAccessibilityFindings(page);
  await expectNoHorizontalOverflow(page);
  await captureIssue93Evidence(page, testInfo, "topic");
  await captureIssue195Evidence(page, testInfo, "topic");
  await captureIssue271Evidence(page, testInfo, "topic");

  const seriesLink = page.locator('[data-playlist-card]').filter({
    hasText: "Создание Platform Inside",
  });
  await expect(seriesLink).toHaveAttribute(
    "href",
    "/series/platform-inside?from=%2Ftopics%2Fplatform%3Ffrom%3D%252Flibrary",
  );
  await seriesLink.focus();
  await expect(seriesLink).toBeFocused();
  await seriesLink.press("Enter");
  await expect(page).toHaveURL(
    /\/series\/platform-inside\?from=%2Ftopics%2Fplatform%3Ffrom%3D%252Flibrary$/u,
  );
  await expect(page.getByRole("link", { name: "Назад к теме" })).toHaveAttribute(
    "href",
    "/topics/platform?from=%2Flibrary",
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Создание Platform Inside" }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Создание Platform Inside — плейлист · Inside");
  await expectLibraryNavigationActive(page, testInfo);
  await expect(
    page.locator("[data-series-order] [data-series-ordinal]").evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-series-ordinal")),
    ),
  ).resolves.toEqual(["1", "2"]);
  await expect(page.getByText("Как устроен Inside Platform")).toBeVisible();
  await expect(page.getByText("Developer Pipeline без потери контекста")).toBeVisible();
  const representativeSeriesItem = page
    .locator("[data-series-order] [data-series-ordinal]")
    .filter({ hasText: "Как устроен Inside Platform" });
  const representativeOrdinal = await representativeSeriesItem.getAttribute(
    "data-series-ordinal",
  );
  expect(representativeOrdinal).not.toBeNull();
  await expectNoSeriousAccessibilityFindings(page);
  await expectNoHorizontalOverflow(page);
  await captureIssue93Evidence(page, testInfo, "series");
  await captureIssue195Evidence(page, testInfo, "playlist");
  await captureIssue271Evidence(page, testInfo, "playlist");

  await page
    .getByRole("link", { name: "Как устроен Inside Platform", exact: true })
    .click();
  await expect(page).toHaveURL(/\/materials\/kak-ustroen-inside-platform\?/u);
  expect(new URL(page.url()).searchParams.get("from")).toBe(
    "/series/platform-inside?from=%2Ftopics%2Fplatform%3Ffrom%3D%252Flibrary",
  );
  const playlistBackLinks = page.getByRole("link", {
    name: "Назад к плейлисту",
  });
  await expect(playlistBackLinks).toHaveCount(2);
  await expect(playlistBackLinks.first()).toHaveAttribute(
    "href",
    "/series/platform-inside?from=%2Ftopics%2Fplatform%3Ffrom%3D%252Flibrary",
  );
  await expect(
    page.getByRole("link", { name: "Platform", exact: true }),
  ).toHaveAttribute("href", "/topics/platform");
  const expectedSeriesLabel =
    `Создание Platform Inside · № ${representativeOrdinal ?? ""}`;
  const readerSeriesLink = page
    .getByRole("list", { name: "Плейлисты материала" })
    .getByRole("link", { exact: true, name: expectedSeriesLabel });
  await expect(readerSeriesLink).toHaveAttribute("href", "/series/platform-inside");
  await expect(readerSeriesLink).toHaveText(expectedSeriesLabel);
  await expect(page.locator("[data-related-state]")).toHaveCount(0);

  await expect(page).toHaveTitle("Как устроен Inside Platform · Inside");
  await expectLibraryNavigationActive(page, testInfo);
  await expectNoSeriousAccessibilityFindings(page);
  await expectNoHorizontalOverflow(page);
  await captureIssue271Evidence(page, testInfo, "reader");

});

async function expectLibraryNavigationActive(page: Page, testInfo: TestInfo) {
  if (testInfo.project.name !== "mobile-chromium") return;
  await expect(
    page
      .getByRole("navigation", { name: "Мобильная навигация" })
      .getByRole("link", { name: "База знаний" }),
  ).toHaveAttribute("aria-current", "page");
}

async function expectNoSeriousAccessibilityFindings(page: Page) {
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.locator("html").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

async function closeTelegramOnboardingIfPresent(page: Page) {
  const dismiss = page.getByRole("button", {
    name: "Закрыть подключение Telegram",
  });
  const visible = await dismiss
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return;
  await dismiss.click();
  await expect(dismiss).toBeHidden();
}

async function captureIssue93Evidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  if (process.env.CAPTURE_ISSUE_93_EVIDENCE !== "1") return;
  const evidenceDirectory = resolve(
    process.cwd(),
    "../../docs/evidence/issue-93",
  );
  await mkdir(evidenceDirectory, { recursive: true });
  const viewport =
    testInfo.project.name === "mobile-chromium" ? "mobile" : "desktop";
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: resolve(evidenceDirectory, `${name}-${viewport}.png`),
  });
}

async function captureIssue195Evidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  if (process.env.CAPTURE_ISSUE_195_EVIDENCE !== "1") return;
  const evidenceDirectory = resolve(
    process.cwd(),
    "../../docs/evidence/issue-195",
  );
  await mkdir(evidenceDirectory, { recursive: true });
  const viewport =
    testInfo.project.name === "mobile-chromium" ? "mobile" : "desktop";
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: resolve(evidenceDirectory, `${name}-${viewport}.png`),
  });
}

async function captureIssue271Evidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  if (process.env.CAPTURE_ISSUE_271_EVIDENCE !== "1") return;
  const evidenceDirectory = resolve(
    process.cwd(),
    "../../docs/evidence/issue-271",
  );
  await mkdir(evidenceDirectory, { recursive: true });
  const viewport =
    testInfo.project.name === "mobile-chromium" ? "390x844" : "1440x1024";
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: resolve(evidenceDirectory, `${name}-${viewport}.png`),
  });
}

test("renders missing Topic and Series as controlled noindex states", async ({ page }) => {
  for (const path of ["/topics/not-published", "/series/not-published"] as const) {
    await page.goto(path);
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/u,
    );
    await expect(page.getByRole("heading", { name: "Подборка не найдена" })).toBeVisible();
    await expect(page.getByRole("link", { name: "В Базу знаний" })).toBeVisible();
  }
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

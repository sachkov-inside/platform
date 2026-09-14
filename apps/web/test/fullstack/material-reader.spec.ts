import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { resolve } from "node:path";

import { signInFullStack } from "../support/full-stack-session";
import { prepareEvidenceDirectory } from "../../../../scripts/evidence-path.mjs";

test("Home exposes one client-owned feed and preserves the reader return", async ({ page, request }, testInfo) => {
  const document = await request.get("/");
  expect(document.status()).toBe(200);
  expect(await document.text()).toContain("Материалы");
  await page.goto("/?format=guide");
  const feed = page.getByRole("region", { name: "Материалы", exact: true });
  await expect(feed.getByRole("article").first()).toBeVisible();
  await expect(feed.getByRole("group", { name: "Тема материала" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Что даёт подписка" })).toHaveCount(0);
  const material = feed.getByRole("heading").first().getByRole("link");
  await expect(material).toHaveAttribute("href", /\?from=%2F%3Fformat%3Dguide$/u);
  await material.click();
  await page.getByRole("link", { name: "Назад на Главную", exact: true }).click();
  await expect(page).toHaveURL(/\/\?format=guide$/u);
  await expect(page.getByRole("button", { name: "Гайды", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expectNoSeriousAccessibilityFindings(page);
  await expectNoHorizontalOverflow(page);
  await captureIssue271Evidence(page, testInfo, "home");
});

test("loads successive PostgreSQL feed pages without exposing protected text", async ({ page, request }) => {
  const initialHtml = await (await request.get("/")).text();
  expect(initialHtml).not.toContain("Закрытое содержимое для участников");
  await page.goto("/");
  const feed = page.getByRole("region", { name: "Материалы", exact: true });
  const articles = feed.getByRole("article");
  await expect(articles.first()).toBeVisible();
  const firstSlug = await articles.first().getAttribute("data-material-slug");
  const firstCount = await articles.count();
  await articles.last().scrollIntoViewIfNeeded();
  await expect.poll(() => articles.count()).toBeGreaterThan(firstCount);
  expect(await articles.first().getAttribute("data-material-slug")).toBe(firstSlug);
  await page.getByRole("searchbox").fill("Developer Pipeline без потери контекста");
  await expect(articles).toHaveCount(1);
  await expect(articles.first().locator("[data-access-cover=locked]")).toBeVisible();
  await expect(feed).not.toContainText("Закрытое содержимое для участников");
  await expectNoSeriousAccessibilityFindings(page);
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
  const englishUrl = "/?q=developer+pipeline";
  const englishDocument = await request.get(englishUrl);
  const englishHtml = await englishDocument.text();
  expect(englishDocument.status()).toBe(200);
  expect(englishHtml).toContain("Материалы");
  expect(englishHtml).not.toContain("Developer Pipeline без потери контекста");
  expect(englishHtml).not.toContain("Закрытое содержимое для участников");

  await page.goto(englishUrl);
  await expect(page.getByLabel("Поиск по материалам")).toHaveValue(
    "developer pipeline",
  );
  await expect(
    page.getByRole("link", { exact: true, name: "Developer Pipeline без потери контекста" }),
  ).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Материалов: 2" })).toHaveText("Материалов: 2");
  const documentsBeforeFilter = documentRequestCount;
  const filteredResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/library/materials?") &&
      response.url().includes("format=guide") &&
      response.status() === 200,
  );
  const formatFilter = page.getByRole("button", { name: "Гайды", exact: true });
  await formatFilter.focus();
  await page.keyboard.press("Space");
  await expect(formatFilter).toHaveAttribute("aria-pressed", "true");
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
    "/?q=%D0%B0%D1%80%D1%85%D0%B8%D1%82%D0%B5%D0%BA%D1%82%D1%83%D1%80%D0%BD%D0%B0%D1%8F+07",
  );
  await expect(
    page.getByRole("link", { name: "Архитектурная заметка 07", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("link", { exact: true, name: "Developer Pipeline без потери контекста" }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("link", { name: "Архитектурная заметка 07", exact: true }),
  ).toBeVisible();

  await page.getByLabel("Поиск по материалам").fill("nothing can match 404404");
  await expect(page.getByText("Ничего не найдено. Измените запрос или выберите другой формат.")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("q")).toBe(
    "nothing can match 404404",
  );

  await page.goto("/?topic=INVALID&sort=broken&ignored=value");
  await expect(page).toHaveURL(/\/$/u);
  await page.goto("/?after=opaque_cursor");
  await expect(page).toHaveURL(/\/$/u);
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
  await expect(page).toHaveTitle("Как устроен Inside Platform · Sachkov Inside");
  await expect(page.getByRole("link", { name: "Назад на Главную" }).first()).toBeVisible();
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

test("requires sign-in to save a video reading mark and does not create anonymous progress", async ({ page }) => {
  const readingWrites: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname === "/api/reading-progress/state") {
      readingWrites.push(request.url());
    }
  });
  await page.goto("/materials/produkt-i-inzhenernyy-kontekst");
  const action = page.getByRole("main").locator("[data-reading-action-state]");
  await expect(action).toHaveAttribute("data-reading-action-state", "anonymous");
  const signIn = action.getByRole("link", { name: "Просмотрено", exact: true });
  await expect(signIn).toHaveAttribute("href", "/account");
  await expect(action.getByRole("button", { name: "Просмотрено", exact: true })).toHaveCount(0);
  await signIn.click();
  await expect(page).toHaveURL(/\/account$/u);
  await expect(page.getByRole("main").getByRole("button", { name: "Войти", exact: true })).toBeVisible();
  expect(readingWrites).toEqual([]);
  expect(await page.evaluate(() => (
    Object.keys(localStorage).some((key) => key.startsWith("inside.video-progress.v1:"))
  ))).toBe(false);
});

test("renders a locked teaser whose purchase starts inside the platform and fails closed on invalid proof", async ({
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
  const teaser = page.locator('[data-material-reader-state="access-required"]');
  await expect(
    teaser.getByRole("heading", {
      name: /^Продолжение (для участников|входит в руководство)$/u,
      level: 2,
    }),
  ).toBeVisible();
  // Один следующий шаг — и он внутри платформы. Каталог предложений локального стенда решает,
  // есть ли что покупать: без включённой продажи материал честно остаётся без призыва.
  const purchase = teaser.getByRole("link", {
    name: /^(Получить доступ|Купить руководство)$/u,
  });
  if (await purchase.count() === 0) {
    await expect(
      teaser.getByText("Купить доступ сейчас нельзя, но материал останется здесь."),
    ).toBeVisible();
  } else {
    await expect(purchase).toHaveAttribute(
      "href",
      /^\/(?:subscription(?:\?from=[^"]+)?|guides\/[a-z0-9-]+\/buy)$/u,
    );
    expect(await purchase.getAttribute("target")).toBeNull();
  }
  await expect(teaser.locator('a[href^="http"], a[target="_blank"]')).toHaveCount(0);
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
}, testInfo) => {
  await signInFullStack(context, "OWNER");

  await page.goto("/materials/produkt-i-inzhenernyy-kontekst");
  const onboardingDismiss = page.getByRole("button", {
    name: "Закрыть подключение Telegram",
  });
  await expect(onboardingDismiss).toBeVisible({ timeout: 10_000 });
  await onboardingDismiss.click();
  const markWatched = page.getByRole("button", { name: "Просмотрено", exact: true });
  await expect(markWatched).toBeEnabled();
  if (await markWatched.getAttribute("aria-pressed") === "true") {
    await markWatched.click();
  }
  await expect(markWatched).toHaveAttribute("aria-pressed", "false");
  await markWatched.click();
  await expect(page.getByRole("button", { name: "Просмотрено" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  const watched = page.getByRole("button", { name: "Просмотрено" });
  await expect(watched).toBeEnabled();
  await watched.click();
  await expect(page.getByRole("button", { name: "Просмотрено", exact: true })).toHaveAttribute(
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
  await expect(page.getByRole("main").getByText("Закрытое содержимое для участников.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Получить доступ" })).toHaveCount(0);

  await page.goto("/?q=developer+pipeline");
  const membershipCard = page
    .getByRole("article")
    .filter({ hasText: "Developer Pipeline без потери контекста" });
  await expect(membershipCard).toBeVisible();
  await expect(membershipCard.locator("[data-access-cover]")).toHaveCount(0);

  const bffResponse = await context.request.get(
    `${process.env.FULLSTACK_WEB_BASE_URL ?? "http://127.0.0.1:3000"}/api/library/materials?q=developer+pipeline`,
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
  // Тема раскрывается кнопкой: её название, адрес и число материалов складываются в доступное имя.
  await expect(
    page.getByRole("button", { name: /^Platform \/platform · \d+ материал/u }),
  ).toBeVisible();
  await captureIssue195Evidence(page, testInfo, "admin-topics");

  await page.getByRole("link", { name: "Руководства", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Руководства", level: 1 })).toBeVisible();
  const platformGuide = page.getByRole("link", {
    name: /^Создание Platform Inside \d+ материал/u,
  });
  await expect(platformGuide).toBeVisible();
  await expect(platformGuide).toHaveAttribute("href", /^\/authoring\/guides\//u);
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
  await expect(page.getByRole("link", { name: "Назад к руководству" })).toHaveAttribute(
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

  await page.goto("/topics/platform?from=%2F");
  const membershipCard = page.getByRole("article").filter({ hasText: "Developer Pipeline без потери контекста" });
  await expect(page.getByRole("link", { name: "Назад на Главную" })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(page.getByRole("heading", { level: 1, name: "Platform" })).toBeVisible();
  await expect(page).toHaveTitle("Platform — тема · Sachkov Inside");
  await expectLibraryNavigationActive(page, testInfo);
  await expect(membershipCard.locator('[data-access-cover="locked"]')).toBeVisible();
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
  ).toBe("/topics/platform?from=%2F");
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
    "/guides/platform-inside?from=%2Ftopics%2Fplatform%3Ffrom%3D%252F",
  );
  await seriesLink.focus();
  await expect(seriesLink).toBeFocused();
  await seriesLink.press("Enter");
  await expect(page).toHaveURL(
    /\/guides\/platform-inside\?from=%2Ftopics%2Fplatform%3Ffrom%3D%252F$/u,
  );
  await expect(page.getByRole("link", { name: "Назад к теме" })).toHaveAttribute(
    "href",
    "/topics/platform?from=%2F",
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Создание Platform Inside" }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Создание Platform Inside — руководство · Sachkov Inside");
  await expectLibraryNavigationActive(page, testInfo);
  // Материалы, состояния доступа и порядок живут в программе; страница продукта рассказывает.
  await page.getByRole("link", { name: "Открыть программу", exact: true }).click();
  await expect(page).toHaveURL(/\/guides\/platform-inside\/programme/u);
  await expect(page.locator("[data-guide-programme]:visible")).toBeVisible();
  await expect(page.locator("[data-series-order] [data-series-ordinal]")).toHaveCount(2);
  await expect(
    page.locator("[data-series-order] [data-series-ordinal]").evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-series-ordinal")),
    ),
  ).resolves.toEqual(["1", "2"]);
  // У руководства с главами каждый список назван своей главой, поэтому материал ищется в маршруте.
  await expect(page.locator("[data-series-order]").getByText("Как устроен Inside Platform").first()).toBeVisible();
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
    "/guides/platform-inside/programme?page=1&at=kak-ustroen-inside-platform",
  );
  const playlistBackLinks = page.getByRole("link", {
    name: "Все материалы руководства",
  });
  await expect(playlistBackLinks).toHaveCount(1);
  await expect(playlistBackLinks.first()).toHaveAttribute(
    "href",
    "/guides/platform-inside/programme?page=1&at=kak-ustroen-inside-platform",
  );
  await expect(
    page.getByRole("link", { name: "Platform", exact: true }),
  ).toHaveAttribute("href", "/topics/platform");
  await expect(page.getByRole("link", { name: "Назад к программе" })).toHaveCount(1);
  await expect(page.locator("[data-reader-footer]")).not.toContainText("· №");

  await expect(page).toHaveTitle("Как устроен Inside Platform · Sachkov Inside");
  await expectLibraryNavigationActive(page, testInfo);
  await expectNoSeriousAccessibilityFindings(page);
  await expectNoHorizontalOverflow(page);
  await captureIssue271Evidence(page, testInfo, "reader");

});

test("uses the selected Series order for a shared Material and leaves standalone reading independent", async ({
  page,
}) => {
  // Порядок материала берёт та программа, из которой читатель пришёл: маршрут живёт там.
  await page.goto("/guides/demo-series-harness/programme");
  await page.getByRole("link", { exact: true, name: "Demo #295 · Общий гайд" }).click();
  await expect(page.locator("[data-series-reader-navigation]")).toContainText("1 из 2");
  const harnessNext = page.getByRole("link", { name: "Дальше" });
  expect(
    new URL(
      (await harnessNext.getAttribute("href")) ?? "",
      page.url(),
    ).searchParams.get("from"),
  ).toBe("/guides/demo-series-harness/programme?page=1&at=demo-295-obshchiy-gayd");
  await page.goBack();
  await expect(page).toHaveURL(/\/guides\/demo-series-harness\/programme/u);
  await page.goForward();
  await expect(
    page.getByRole("link", { name: "Дальше" }),
  ).toBeVisible();

  await page.goto("/guides/demo-series-review/programme");
  await page.getByRole("link", { exact: true, name: "Demo #295 · Общий гайд" }).click();
  await expect(page.locator("[data-series-reader-navigation]")).toContainText("1 из 3");
  const mixedNext = page.getByRole("link", {
    name: "Дальше",
  });
  expect(
    new URL(
      (await mixedNext.getAttribute("href")) ?? "",
      page.url(),
    ).searchParams.get("from"),
  ).toBe("/guides/demo-series-review/programme?page=1&at=demo-295-obshchiy-gayd");
  await mixedNext.click();
  await expect(
    page.getByRole("link", { name: "Дальше" }),
  ).toBeVisible();

  await page.goto("/materials/demo-295-samostoyatelnaya-zametka");
  await expect(page.getByRole("heading", { name: "Demo #295 · Самостоятельная заметка" })).toBeVisible();
  await expect(page.locator("[data-series-reader-navigation]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Назад на Главную" }).first()).toBeVisible();
});

async function expectLibraryNavigationActive(page: Page, testInfo: TestInfo) {
  if (testInfo.project.name !== "mobile-chromium") return;
  await expect(
    page
      .getByRole("navigation", { name: "Мобильная навигация" })
      .getByRole("link", { name: "Главная", exact: true }),
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
  const snapshots = await prepareEvidenceDirectory("issue-93");
  const viewport =
    testInfo.project.name === "mobile-chromium" ? "mobile" : "desktop";
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: resolve(snapshots, `${name}-${viewport}.png`),
  });
}

async function captureIssue195Evidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  if (process.env.CAPTURE_ISSUE_195_EVIDENCE !== "1") return;
  const snapshots = await prepareEvidenceDirectory("issue-195");
  const viewport =
    testInfo.project.name === "mobile-chromium" ? "mobile" : "desktop";
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: resolve(snapshots, `${name}-${viewport}.png`),
  });
}

async function captureIssue271Evidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  if (process.env.CAPTURE_ISSUE_271_EVIDENCE !== "1") return;
  const snapshots = await prepareEvidenceDirectory("issue-271");
  const viewport =
    testInfo.project.name === "mobile-chromium" ? "390x844" : "1440x1024";
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: resolve(snapshots, `${name}-${viewport}.png`),
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
    await expect(page.getByRole("link", { name: "На главную" })).toBeVisible();
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
  const header = page.getByRole("banner");
  const main = page.getByRole("main");
  const initialMainRect = await main.evaluate((element) => {
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
  await header.hover();
  await expect
    .poll(() =>
      main.evaluate((element) => {
        const { width, x } = element.getBoundingClientRect();
        return { width, x };
      }),
    )
    .toEqual(initialMainRect);
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

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type CDPSession,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { resolve } from "node:path";

import {
  expectLinearProgrammeReturn,
  expectProgrammeReturnTarget,
} from "../support/linear-programme";
import { signInFullStack } from "../support/full-stack-session";
import { prepareEvidenceDirectory } from "../../../../scripts/evidence-path.mjs";
import { z } from "zod";

const readerStartupScriptCpuBudgetMs = 200;

test("keeps reader startup JavaScript within its CPU budget", async ({
  page,
}, testInfo) => {
  const session = await page.context().newCDPSession(page);
  try {
    // Thread CPU time excludes network waits and time when the renderer is not scheduled.
    // This is a fresh browser context, a production build and native CPU speed (no throttling).
    await session.send("Performance.enable", { timeDomain: "threadTicks" });
    const before = await readScriptCpuSeconds(session);
    const [authStatusResponse, response] = await Promise.all([
      page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/auth/status",
      ),
      page.goto("/materials/kak-ustroen-inside-platform", {
        waitUntil: "commit",
      }),
    ]);
    expect(response?.status()).toBe(200);
    // Observe the same browser-rendered readiness fact as the INP test, without triggering input.
    await page.waitForFunction(() =>
      document.querySelector(
        '[data-material-reader-state="available"] [data-reading-action-state="anonymous"]',
      ),
    );
    const scriptCpuMs =
      ((await readScriptCpuSeconds(session)) - before) * 1_000;
    expect(authStatusResponse.status()).toBe(200);
    const authStatus: unknown = await authStatusResponse.json();
    expect(authStatus).toMatchObject({ state: "guest", accountId: null });
    const measurement = JSON.stringify({
      scriptCpuMs,
      budgetMs: readerStartupScriptCpuBudgetMs,
      timeDomain: "threadTicks",
      cpuThrottlingRate: 1,
      project: testInfo.project.name,
    });
    console.info(`Reader startup JavaScript CPU: ${measurement}`);
    await testInfo.attach("reader-startup-cpu", {
      body: measurement,
      contentType: "application/json",
    });
    expect(
      scriptCpuMs,
      "startup must record actual JavaScript execution",
    ).toBeGreaterThan(0);
    expect(
      scriptCpuMs,
      "reader startup JavaScript CPU time in milliseconds",
    ).toBeLessThanOrEqual(readerStartupScriptCpuBudgetMs);
  } finally {
    await session.detach();
  }
});

async function readScriptCpuSeconds(session: CDPSession): Promise<number> {
  const result: unknown = await session.send("Performance.getMetrics");
  const { metrics } = z
    .object({
      metrics: z.array(
        z.object({ name: z.string(), value: z.number().nonnegative() }),
      ),
    })
    .parse(result);
  return z
    .number()
    .nonnegative()
    .parse(metrics.find(({ name }) => name === "ScriptDuration")?.value);
}

test("Home filters public products and preserves the reader return", async ({
  page,
  request,
}, testInfo) => {
  const document = await request.get("/");
  expect(document.status()).toBe(200);
  expect(await document.text()).toContain("Материалы");
  await page.goto("/");
  const feed = page.getByRole("region", { name: "Материалы", exact: true });
  await expect(feed.getByRole("article").first()).toBeVisible();
  const productResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/home/materials" &&
      url.searchParams.get("q") === null &&
      url.searchParams.get("topic") === "platform" &&
      response.status() === 200
    );
  });
  await page.getByRole("button", { name: "Platform", exact: true }).click();
  await productResponse;
  await expect(feed.getByRole("article").first()).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "Тема", exact: true })
      .getByRole("button", { name: "Platform", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(feed.getByRole("group", { name: "Тема материала" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Что даёт подписка" }),
  ).toHaveCount(0);
  const material = feed.getByRole("heading").first().getByRole("link");
  await expect(material).toHaveAttribute(
    "href",
    /\?from=%2F%3Ftopic%3Dplatform$/u,
  );
  await material.click();
  await page
    .getByRole("navigation", { name: "Действия материала" })
    .getByRole("link", { name: "Назад", exact: true })
    .click();
  await expect(page).toHaveURL(/\/\?topic=platform$/u);
  await expect(
    page.getByRole("button", { name: "Platform", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expectNoSeriousAccessibilityFindings(page);
  await expectNoHorizontalOverflow(page);
  await captureIssue271Evidence(page, testInfo, "home");
});

test("loads successive PostgreSQL feed pages without exposing protected text", async ({
  page,
  request,
}) => {
  const initialHtml = await (await request.get("/")).text();
  expect(initialHtml).not.toContain("Закрытое содержимое для участников");
  const firstPageResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/home/materials" && !url.searchParams.has("after")
    );
  });
  await page.goto("/");
  const feed = page.getByRole("region", { name: "Материалы", exact: true });
  const articles = feed.getByRole("article");
  await expect(articles.first()).toBeVisible();
  const firstSlug = await articles.first().getAttribute("data-material-slug");
  const pageSchema = z.object({
    kind: z.literal("ready"),
    items: z.array(
      z.object({
        slug: z.string(),
        access: z.literal("free"),
        availability: z.literal("available"),
      }),
    ),
    nextCursor: z.string().nullable(),
    totalCount: z.number().int().min(30),
  });
  const slugs: string[] = [];
  let response = await firstPageResponse;
  let totalCount: number | undefined;
  for (;;) {
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe(
      "public, max-age=30, stale-while-revalidate=60",
    );
    const body = await response.text();
    expect(body).not.toContain("Закрытое содержимое для участников");
    const catalogPage = pageSchema.parse(JSON.parse(body));
    totalCount ??= catalogPage.totalCount;
    expect(catalogPage.totalCount).toBe(totalCount);
    expect(catalogPage.items).toHaveLength(
      Math.min(12, totalCount - slugs.length),
    );
    slugs.push(...catalogPage.items.map((item) => item.slug));
    await expect(articles).toHaveCount(slugs.length);
    expect(
      await articles.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-material-slug")),
      ),
    ).toEqual(slugs);
    expect(await articles.first().getAttribute("data-material-slug")).toBe(
      firstSlug,
    );
    if (slugs.length < totalCount) {
      expect(catalogPage.nextCursor).not.toBeNull();
      const nextPageResponse = page.waitForResponse((nextResponse) => {
        const url = new URL(nextResponse.url());
        return (
          url.pathname === "/api/home/materials" &&
          url.searchParams.get("after") === catalogPage.nextCursor
        );
      });
      await articles.last().scrollIntoViewIfNeeded();
      response = await nextPageResponse;
    } else {
      expect(catalogPage.nextCursor).toBeNull();
      break;
    }
  }
  expect(new Set(slugs).size).toBe(totalCount);
  expect(slugs).toContain("demo-295-samostoyatelnaya-zametka");
  expect(slugs).not.toContain("developer-pipeline-bez-poteri-konteksta");
  await expect(
    feed.getByText("Все материалы загружены", { exact: true }),
  ).toBeVisible();
  await expect(feed.locator("[data-access-cover=locked]")).toHaveCount(0);
  await expect(feed).not.toContainText("Закрытое содержимое для участников");
  await expectNoSeriousAccessibilityFindings(page);
});

test("Home ignores old search links and keeps its topic filter across reload, history and sharing", async ({
  page,
  request,
}) => {
  let documentRequestCount = 0;
  page.on("request", (browserRequest) => {
    if (browserRequest.resourceType() === "document") {
      documentRequestCount += 1;
    }
  });
  // Поиска на Главной нет (решение владельца 09.10.2026): текст запроса из старой ссылки не сужает
  // ленту и уходит из адреса.
  const oldSearchUrl = "/?q=developer+pipeline";
  const oldSearchDocument = await request.get(oldSearchUrl);
  const oldSearchHtml = await oldSearchDocument.text();
  expect(oldSearchDocument.status()).toBe(200);
  expect(oldSearchHtml).toContain("Материалы");
  expect(oldSearchHtml).not.toContain("Закрытое содержимое для участников");

  await page.goto(oldSearchUrl);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBeNull();
  const status = page
    .getByRole("status")
    .filter({ hasText: /^Материалов: \d+$/u });
  await expect(status).toHaveText(/^Материалов: \d+$/u);
  // Поиск «developer pipeline» находил два материала; лента без поиска показывает все.
  expect(
    Number((await status.textContent())?.replace(/\D/gu, "")),
  ).toBeGreaterThan(2);

  const documentsBeforeFilter = documentRequestCount;
  const filteredResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/home/materials" &&
      url.searchParams.get("q") === null &&
      url.searchParams.get("topic") === "platform" &&
      response.status() === 200
    );
  });
  const formatFilter = page.getByRole("button", {
    name: "Platform",
    exact: true,
  });
  await formatFilter.focus();
  await page.keyboard.press("Space");
  await expect(formatFilter).toHaveAttribute("aria-pressed", "true");
  await filteredResponse;
  const articles = page
    .getByRole("region", { name: "Материалы", exact: true })
    .getByRole("article");
  await expect(articles.first()).toBeVisible();
  expect(documentRequestCount).toBe(documentsBeforeFilter);
  expect(new URL(page.url()).searchParams.getAll("topic")).toEqual([
    "platform",
  ]);
  const sharedUrl = page.url();

  await page.reload();
  expect(page.url()).toBe(sharedUrl);
  await expect(formatFilter).toHaveAttribute("aria-pressed", "true");

  const notesFilter = page.getByRole("button", {
    name: "Все",
    exact: true,
  });
  await page.goto("/");
  await expect(notesFilter).toHaveAttribute("aria-pressed", "true");
  await page.goBack();
  await expect(formatFilter).toHaveAttribute("aria-pressed", "true");
  await page.goForward();
  await expect(notesFilter).toHaveAttribute("aria-pressed", "true");

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
  await page.addInitScript((takeRecordsEvent) => {
    const measurements = {
      cls: 0,
      inp: 0,
      lcp: 0,
      shifts: [] as {
        readonly sources: readonly string[];
        readonly value: number;
      }[],
    };
    Object.defineProperty(window, "__readerPerformance", {
      value: measurements,
    });
    if (PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
      new PerformanceObserver((list) => {
        // lib.dom has no LayoutShift yet, so the entry fields are read as unknown.
        for (const entry of list.getEntries()) {
          if (!("value" in entry) || typeof entry.value !== "number") continue;
          if ("hadRecentInput" in entry && entry.hadRecentInput === true) {
            continue;
          }
          const value = entry.value;
          const sources: readonly unknown[] =
            "sources" in entry && Array.isArray(entry.sources)
              ? entry.sources
              : [];
          measurements.cls += value;
          measurements.shifts.push({
            sources: sources.map((source) => {
              const node =
                typeof source === "object" &&
                source !== null &&
                "node" in source
                  ? source.node
                  : undefined;
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
            value,
          });
        }
      }).observe({ type: "layout-shift", buffered: true });
    }
    if (
      PerformanceObserver.supportedEntryTypes.includes(
        "largest-contentful-paint",
      )
    ) {
      new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1);
        measurements.lcp = last?.startTime ?? measurements.lcp;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    }
    if (PerformanceObserver.supportedEntryTypes.includes("event")) {
      const recordEvents = (entries: PerformanceEntryList) => {
        for (const entry of entries) {
          measurements.inp = Math.max(measurements.inp, entry.duration);
        }
      };
      const events = new PerformanceObserver((list) => {
        recordEvents(list.getEntries());
      });
      events.observe({
        type: "event",
        buffered: true,
        durationThreshold: 16,
      } as PerformanceObserverInit);
      // Колбэк наблюдателя приходит позже, чем запись встаёт в очередь; проверка забирает её сама.
      window.addEventListener(takeRecordsEvent, () => {
        recordEvents(events.takeRecords());
      });
    }
  }, takePerformanceRecords);
  // This scenario owns its Home return. Other files can add the same Material to a second
  // course; a direct URL otherwise infers its sole course only on a fresh shard database.
  const materialHref = "/materials/kak-ustroen-inside-platform?from=%2F";
  const documentResponse = await request.get(materialHref);
  const initialHtml = await documentResponse.text();

  expect(documentResponse.status()).toBe(200);
  expect(initialHtml).toContain("Как устроен Inside Platform");
  expect(initialHtml).toContain("Первый вертикальный срез");

  const browserResponse = await page.goto(materialHref);
  expect(browserResponse?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      name: "Как устроен Inside Platform",
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Первый вертикальный срез", level: 2 }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Как устроен Inside Platform · Sachkov Dev");
  await expect(
    page.getByRole("main").getByRole("link", { name: "Главная" }),
  ).toHaveCount(0);
  await expect(page.getByRole("main")).toContainText(
    "PostgreSQL хранит current Material",
  );
  await expect(page.locator("[data-reader-body]")).toHaveCount(1);
  // Ввод до конца гидрации React обрабатывает, гидрируя страницу синхронно внутри события, и INP
  // мерил бы скорость runner, а не ответ читалки (#933). Отметку гостя рисует только браузер
  // после гидрации действия чтения. Стоимость первоначального JavaScript проверяется отдельно.
  for (const panel of [
    page.getByRole("navigation", { name: "Действия материала", exact: true }),
    page.getByRole("navigation", {
      name: "Действия в конце материала",
      exact: true,
    }),
  ]) {
    const action = panel.locator("[data-reading-action-state]");
    await expect(
      action,
      "действие чтения гидрировано и получило ответ /auth/status",
    ).toHaveAttribute("data-reading-action-state", "anonymous");
    const signIn = action.getByRole("link", { name: "Изучено", exact: true });
    await expect(signIn).toBeVisible();
    await expect(signIn).toBeEnabled();
    await expect(signIn).toHaveAttribute("href", "/account");
    await expect(
      action.getByRole("button", { name: "Изучено", exact: true }),
    ).toHaveCount(0);
  }

  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Перейти к содержанию" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();

  await expect(
    page.getByRole("navigation", { name: "В этом материале" }),
  ).toHaveCount(0);
  await expect(
    page
      .locator("[data-reader-body] h2")
      .filter({ hasText: "Проверяемый результат" }),
  ).toBeVisible();
  await framesPresented(page);

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

  const collected = await page.evaluate(() => {
    const navigation = window.performance.getEntriesByType("navigation")[0];
    const measured: unknown = Reflect.get(window, "__readerPerformance");
    return {
      measured,
      ttfb:
        navigation instanceof PerformanceNavigationTiming
          ? navigation.responseStart
          : Number.POSITIVE_INFINITY,
    };
  });
  const metrics = {
    ...z
      .object({
        cls: z.number(),
        inp: z.number(),
        lcp: z.number(),
        shifts: z.array(
          z.object({ sources: z.array(z.string()), value: z.number() }),
        ),
      })
      .parse(collected.measured),
    ttfb: collected.ttfb,
  };
  expect(metrics.ttfb).toBeLessThanOrEqual(800);
  expect(metrics.lcp).toBeLessThanOrEqual(2_500);
  expect(metrics.inp).toBeLessThanOrEqual(200);
  expect(metrics.cls, JSON.stringify(metrics.shifts)).toBeLessThanOrEqual(0.1);
  expect(browserErrors).toEqual([]);
});

test("requires sign-in to save a video reading mark and does not create anonymous progress", async ({
  page,
}) => {
  const readingWrites: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      new URL(request.url()).pathname === "/api/reading-progress/state"
    ) {
      readingWrites.push(request.url());
    }
  });
  await page.goto("/materials/produkt-i-inzhenernyy-kontekst");
  for (const panel of [
    page.getByRole("navigation", { name: "Действия материала", exact: true }),
    page.getByRole("navigation", {
      name: "Действия в конце материала",
      exact: true,
    }),
  ]) {
    const action = panel.locator("[data-reading-action-state]");
    await expect(action).toHaveAttribute(
      "data-reading-action-state",
      "anonymous",
    );
    const signIn = action.getByRole("link", {
      name: "Просмотрено",
      exact: true,
    });
    await expect(signIn).toBeVisible();
    await expect(signIn).toBeEnabled();
    await expect(signIn).toHaveAttribute("href", "/account");
    await expect(
      action.getByRole("button", { name: "Просмотрено", exact: true }),
    ).toHaveCount(0);
  }
  const signIn = page
    .getByRole("navigation", { name: "Действия материала", exact: true })
    .getByRole("link", { name: "Просмотрено", exact: true });
  await signIn.click();
  await expect(page).toHaveURL(/\/account$/u);
  await expect(
    page
      .getByRole("main")
      .getByRole("button", { name: "Войти через Telegram", exact: true }),
  ).toBeVisible();
  expect(readingWrites).toEqual([]);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).some((key) =>
        key.startsWith("inside.video-progress.v1:"),
      ),
    ),
  ).toBe(false);
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
      name: /^Продолжение (для участников|входит в продукт)$/u,
      level: 2,
    }),
  ).toBeVisible();
  // Один следующий шаг — и он внутри платформы. Каталог предложений локального стенда решает,
  // есть ли что покупать: без включённой продажи материал честно остаётся без призыва.
  const purchase = teaser.getByRole("link", {
    name: /^(Получить доступ|Купить продукт)$/u,
  });
  if ((await purchase.count()) === 0) {
    await expect(
      teaser.getByText(
        "Купить доступ сейчас нельзя, но материал останется здесь.",
      ),
    ).toBeVisible();
  } else {
    await expect(purchase).toHaveAttribute(
      "href",
      /^\/(?:subscription(?:\?from=[^"]+)?|products\/[a-z0-9-]+(?:\/buy)?)$/u,
    );
    expect(await purchase.getAttribute("target")).toBeNull();
  }
  await expect(
    teaser.locator('a[href^="http"], a[target="_blank"]'),
  ).toHaveCount(0);
  await expect(
    page.getByText("Закрытое содержимое для участников"),
  ).toHaveCount(0);

  const invalidProof = await request.get(
    `${process.env["FULLSTACK_API_BASE_URL"] ?? "http://127.0.0.1:3001"}/materials/developer-pipeline-bez-poteri-konteksta`,
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
  await expect(
    page.getByRole("dialog", { name: "Подключите Telegram" }),
  ).toHaveCount(0);
  const markWatched = page
    .getByRole("navigation", { name: "Действия материала", exact: true })
    .getByRole("button", { name: "Просмотрено", exact: true });
  const watchedAtBottom = page
    .getByRole("navigation", {
      name: "Действия в конце материала",
      exact: true,
    })
    .getByRole("button", { name: "Просмотрено", exact: true });
  await expect(markWatched).toBeVisible();
  await expect(watchedAtBottom).toBeVisible();
  await expect(markWatched).toBeEnabled();
  await expect(watchedAtBottom).toBeEnabled();
  if ((await markWatched.getAttribute("aria-pressed")) === "true") {
    await markWatched.click();
  }
  await expect(markWatched).toHaveAttribute("aria-pressed", "false");
  await expect(watchedAtBottom).toHaveAttribute("aria-pressed", "false");
  await expect(markWatched).toBeEnabled();
  await expect(watchedAtBottom).toBeEnabled();
  await markWatched.click();
  await expect(markWatched).toHaveAttribute("aria-pressed", "true");
  await expect(watchedAtBottom).toHaveAttribute("aria-pressed", "true");
  await expect(markWatched).toBeEnabled();
  await expect(watchedAtBottom).toBeEnabled();
  await page.reload();
  await expect(markWatched).toBeVisible();
  await expect(watchedAtBottom).toBeVisible();
  await expect(markWatched).toBeEnabled();
  await expect(watchedAtBottom).toBeEnabled();
  await expect(markWatched).toHaveAttribute("aria-pressed", "true");
  await expect(watchedAtBottom).toHaveAttribute("aria-pressed", "true");
  await watchedAtBottom.click();
  await expect(markWatched).toHaveAttribute("aria-pressed", "false");
  await expect(watchedAtBottom).toHaveAttribute("aria-pressed", "false");
  await expect(markWatched).toBeEnabled();
  await expect(watchedAtBottom).toBeEnabled();

  const reader = await page.goto(
    "/materials/developer-pipeline-bez-poteri-konteksta",
  );
  expect(reader?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      name: "Developer Pipeline без потери контекста",
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByText("Закрытое содержимое для участников."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Получить доступ" })).toHaveCount(
    0,
  );

  // Closed cards remain in the product catalog; the public Home feed only lists free materials.
  await page.goto("/products/platform-inside/programme?part=materials");
  await page
    .getByRole("searchbox", { name: "Поиск по материалам курса" })
    .fill("Developer Pipeline без потери контекста");
  const membershipCard = page.getByRole("article").filter({
    has: page.getByRole("link", {
      name: "Developer Pipeline без потери контекста",
      exact: true,
    }),
  });
  await expect(membershipCard).toBeVisible();
  await expect(membershipCard.locator("[data-access-cover]")).toHaveCount(0);

  // The renewed session cookie is Secure: on 127.0.0.1 only the browser itself sends it.
  const bffResponse = await page.evaluate(async () => {
    const response = await fetch("/api/library/materials?q=developer+pipeline");
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      body: (await response.json()) as unknown,
    };
  });
  expect(bffResponse.status).toBe(200);
  expect(bffResponse.cacheControl).toBe("private, no-store");
  expect(bffResponse.body).toMatchObject({
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
  await expectNoTelegramOnboarding(page);
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
  if (testInfo.project.name === "mobile-chromium")
    await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page.getByRole("link", { name: "Темы", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Темы", level: 1 }),
  ).toBeVisible();
  // Тема раскрывается кнопкой: её название, адрес и число материалов складываются в доступное имя.
  await expect(
    page.getByRole("button", { name: /^Platform \/platform · \d+ материал/u }),
  ).toBeVisible();
  await captureIssue195Evidence(page, testInfo, "admin-topics");

  if (testInfo.project.name === "mobile-chromium")
    await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page.getByRole("link", { name: "Продукты", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Продукты", level: 1 }),
  ).toBeVisible();
  const platformProduct = page.getByRole("link", {
    name: /^Создание Platform Inside \d+ материал/u,
  });
  await expect(platformProduct).toBeVisible();
  await expect(platformProduct).toHaveAttribute(
    "href",
    /^\/authoring\/products\//u,
  );
  await captureIssue195Evidence(page, testInfo, "admin-playlists");
});

test("returns the production not-found state for an unpublished slug", async ({
  page,
}) => {
  await page.goto("/materials/not-published?from=%2Fseries%2Fplatform-inside");

  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
  await expect(
    page.getByRole("heading", { name: "Материал не найден" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Назад к продукту" }),
  ).toHaveAttribute("href", "/series/platform-inside");
});

test("navigates Library → Topic → ordered Series and exposes canonical Reader context", async ({
  page,
  request,
}, testInfo) => {
  const retiredTopic = await request.get("/topics/platform", {
    maxRedirects: 0,
  });
  expect(retiredTopic.status()).toBe(308);
  expect(retiredTopic.headers()["location"]).toBe("/?topic=platform");
  await page.goto("/topics/platform");
  await expect(page).toHaveURL(/\/\?topic=platform$/u);
  await expect(
    page
      .getByRole("group", { name: "Тема", exact: true })
      .getByRole("button", { name: "Platform", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expectNoSeriousAccessibilityFindings(page);
  await expectNoHorizontalOverflow(page);
  await page.goto("/products/platform-inside?from=%2F%3Ftopic%3Dplatform");
  await expect(
    page.getByRole("heading", { level: 1, name: "Создание Platform Inside" }),
  ).toBeVisible();
  await expect(page).toHaveTitle(
    "Создание Platform Inside — продукт · Sachkov Dev",
  );
  await expectProductLandingNavigation(page, testInfo);
  // Материалы, состояния доступа и порядок живут в программе; страница продукта рассказывает.
  await page
    .getByRole("link", { name: "Открыть программу", exact: true })
    .click();
  await expect(page).toHaveURL(/\/products\/platform-inside\/programme/u);
  const programme = page.locator(
    '[data-product-programme="platform-inside"]:visible',
  );
  await expect(programme).toHaveCount(1);
  await expect(programme).toBeVisible();
  // Authoring scenarios add their members-only lessons to this seeded product (#648), so it only grows.
  const programmeRows = programme.locator(
    "[data-series-order] [data-series-ordinal]",
  );
  const secondRow = programme.locator('[data-series-ordinal="2"]');
  await expect(secondRow).toHaveCount(1);
  await expect(secondRow).toBeVisible();
  await expect(
    programmeRows.evaluateAll((items) =>
      items.slice(0, 2).map((item) => item.getAttribute("data-series-ordinal")),
    ),
  ).resolves.toEqual(["1", "2"]);
  // У руководства с главами каждый список назван своей главой, поэтому материал ищется в маршруте.
  await expect(
    programme
      .locator("[data-series-order]")
      .getByRole("link", { name: "Как устроен Inside Platform", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByText("Developer Pipeline без потери контекста")
      .filter({ visible: true }),
  ).toBeVisible();
  const representativeSeriesItem = programmeRows.filter({
    hasText: "Как устроен Inside Platform",
  });
  await expect(representativeSeriesItem).toHaveCount(1);
  await expect(representativeSeriesItem).toHaveAttribute(
    "data-route-material",
    "kak-ustroen-inside-platform",
  );
  const representativeOrdinal = await representativeSeriesItem.getAttribute(
    "data-series-ordinal",
  );
  expect(representativeOrdinal).not.toBeNull();
  await expect(representativeSeriesItem).toHaveAttribute(
    "data-series-ordinal",
    "1",
  );
  await expectNoSeriousAccessibilityFindings(page);
  await expectNoHorizontalOverflow(page);
  await captureIssue93Evidence(page, testInfo, "series");
  await captureIssue195Evidence(page, testInfo, "playlist");
  await captureIssue271Evidence(page, testInfo, "playlist");

  await representativeSeriesItem
    .getByRole("link", { name: "Как устроен Inside Platform", exact: true })
    .click();
  await expect(page).toHaveURL(/\/materials\/kak-ustroen-inside-platform\?/u);
  const programmeReturnHref = expectProgrammeReturnTarget(
    new URL(page.url()).searchParams.get("from"),
    "/products/platform-inside/programme?page=1&at=kak-ustroen-inside-platform",
  );
  const programmeAction = await expectLinearProgrammeReturn(
    page,
    testInfo.project.name === "mobile-chromium",
    programmeReturnHref,
  );
  await expect(
    page.getByRole("link", { name: "Все материалы продукта", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Хлебные крошки", exact: true })
      .getByRole("link", { name: "Создание Platform Inside", exact: true }),
  ).toHaveCount(1);

  await expect(page).toHaveTitle("Как устроен Inside Platform · Sachkov Dev");
  await expectLibraryNavigationActive(page, testInfo);
  await expectNoSeriousAccessibilityFindings(page);
  await expectNoHorizontalOverflow(page);
  await captureIssue271Evidence(page, testInfo, "reader");
  await programmeAction.click();
  await expect(page).toHaveURL(new URL(programmeReturnHref, page.url()).href);
  await expect(programme).toHaveCount(1);
  await expect(representativeSeriesItem).toHaveCount(1);
  await expect(representativeSeriesItem).toHaveAttribute(
    "data-series-ordinal",
    representativeOrdinal ?? "",
  );
  await expect(representativeSeriesItem).toBeInViewport();
});

test("uses the selected Series order for a shared Material and leaves standalone reading independent", async ({
  page,
}) => {
  // Порядок материала берёт та программа, из которой читатель пришёл: маршрут живёт там.
  await page.goto("/products/demo-series-harness/programme");
  await page
    .getByRole("link", { exact: true, name: "Demo #295 · Общий гайд" })
    .click();
  const harnessNext = readerNextLink(page);
  await expect(harnessNext).toHaveAttribute(
    "href",
    /\/materials\/demo-295-finalnyy-gayd\?/u,
  );
  await expect(harnessNext).toHaveCount(1);
  await expect(harnessNext).toBeVisible();
  expectProgrammeReturnTarget(
    new URL(
      (await harnessNext.getAttribute("href")) ?? "",
      page.url(),
    ).searchParams.get("from"),
    "/products/demo-series-harness/programme?page=1&at=demo-295-obshchiy-gayd",
  );
  await page.goBack();
  await expect(page).toHaveURL(/\/products\/demo-series-harness\/programme/u);
  await page.goForward();
  await expect(harnessNext).toBeVisible();

  await page.goto("/products/demo-series-review/programme");
  await page
    .getByRole("link", { exact: true, name: "Demo #295 · Общий гайд" })
    .click();
  const mixedNext = readerNextLink(page);
  await expect(mixedNext).toHaveAttribute(
    "href",
    /\/materials\/demo-295-video-razbor\?/u,
  );
  await expect(mixedNext).toHaveCount(1);
  await expect(mixedNext).toBeVisible();
  expectProgrammeReturnTarget(
    new URL(
      (await mixedNext.getAttribute("href")) ?? "",
      page.url(),
    ).searchParams.get("from"),
    "/products/demo-series-review/programme?page=1&at=demo-295-obshchiy-gayd",
  );
  await mixedNext.click();
  await expect(mixedNext).toBeVisible();

  await page.goto("/materials/demo-295-samostoyatelnaya-zametka");
  await expect(
    page.getByRole("heading", { name: "Demo #295 · Самостоятельная заметка" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Предыдущий шаг/u }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Следующий шаг/u })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("navigation", { name: "Уроки продукта", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("main").getByRole("link", { name: "Главная" }),
  ).toHaveCount(0);
});

function readerNextLink(page: Page) {
  return page
    .getByRole("navigation", { name: "Действия материала", exact: true })
    .getByRole("link", { name: "Дальше", exact: true });
}

async function expectProductLandingNavigation(page: Page, testInfo: TestInfo) {
  if (testInfo.project.name !== "mobile-chromium") return;
  // Витрина продукта скрывает шапку телефона и оставляет собственный выход и вход в программу (#1296).
  const header = page.locator("[data-mobile-header]");
  await expect(header).toHaveCount(1);
  await expect(header).toBeHidden();
  const home = header.getByRole("link", {
    name: "Главная",
    exact: true,
    includeHidden: true,
  });
  await expect(home).toHaveCount(1);
  await expect(home).toBeHidden();
  await expect(home).toHaveAttribute("href", /^\/(?:\?topic=platform)?$/u);
  await expect(home).toHaveAttribute("aria-current", "true");

  const product = page.locator(
    '[data-product-landing="platform-inside"]:visible',
  );
  await expect(product).toHaveCount(1);
  await expect(product).toBeVisible();
  const breadcrumb = product.getByRole("navigation", {
    name: "Хлебные крошки",
    exact: true,
  });
  await expect(breadcrumb).toHaveCount(1);
  await expect(breadcrumb).toBeVisible();
  await expect(
    product.getByRole("link", { name: "Назад к теме", exact: true }),
  ).toHaveCount(0);
  const current = breadcrumb.getByText("Создание Platform Inside", {
    exact: true,
  });
  await expect(current).toHaveCount(1);
  await expect(current).toBeVisible();
  await expect(current).toHaveAttribute("aria-current", "page");
  const programme = product.getByRole("link", {
    name: "Открыть программу",
    exact: true,
  });
  await expect(programme).toHaveCount(1);
  await expect(programme).toBeVisible();
  await expect(programme).toHaveAttribute(
    "href",
    "/products/platform-inside/programme",
  );
}

async function expectLibraryNavigationActive(page: Page, testInfo: TestInfo) {
  if (testInfo.project.name !== "mobile-chromium") return;
  // Topic и Reader сохраняют видимую навигацию Главной; витрина продукта отдельно скрывает шапку.
  const home = page
    .locator("[data-mobile-header]")
    .getByRole("link", { name: "Главная", exact: true });
  await expect(home).toHaveCount(1);
  await expect(home).toBeVisible();
  await expect(home).toHaveAttribute("href", /^\/(?:\?topic=platform)?$/u);
  await expect(home).toHaveAttribute("aria-current", "true");
}

async function expectNoSeriousAccessibilityFindings(page: Page) {
  // After a client navigation Next.js streams the new <title> separately; scan the settled document.
  await expect(page).toHaveTitle(/\S/u);
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

async function expectNoTelegramOnboarding(page: Page) {
  await expect(
    page.getByRole("dialog", { name: "Подключите Telegram" }),
  ).toHaveCount(0);
}

async function captureIssue93Evidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  if (process.env["CAPTURE_ISSUE_93_EVIDENCE"] !== "1") return;
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
  if (process.env["CAPTURE_ISSUE_195_EVIDENCE"] !== "1") return;
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
  if (process.env["CAPTURE_ISSUE_271_EVIDENCE"] !== "1") return;
  const snapshots = await prepareEvidenceDirectory("issue-271");
  const viewport =
    testInfo.project.name === "mobile-chromium" ? "390x844" : "1440x1024";
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: resolve(snapshots, `${name}-${viewport}.png`),
  });
}

test("renders missing Topic and Series as controlled noindex states", async ({
  page,
}) => {
  for (const path of ["/series/not-published"] as const) {
    await page.goto(path);
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/u,
    );
    await expect(
      page.getByRole("heading", { name: "Подборка не найдена" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "На главную" })).toBeVisible();
  }
});

test("keeps desktop shell fixed while main content owns scrolling", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");

  await page.addInitScript((takeRecordsEvent) => {
    const shellCls = { value: 0 };
    Object.defineProperty(window, "__shellCls", { value: shellCls });
    const recordShifts = (entries: PerformanceEntryList) => {
      // lib.dom has no LayoutShift yet, so the entry fields are read as unknown.
      for (const entry of entries) {
        if (!("value" in entry) || typeof entry.value !== "number") continue;
        if ("hadRecentInput" in entry && entry.hadRecentInput === true) {
          continue;
        }
        shellCls.value += entry.value;
      }
    };
    const shifts = new PerformanceObserver((list) => {
      recordShifts(list.getEntries());
    });
    shifts.observe({ type: "layout-shift", buffered: true });
    window.addEventListener(takeRecordsEvent, () => {
      recordShifts(shifts.takeRecords());
    });
  }, takePerformanceRecords);
  await page.goto("/materials/kak-ustroen-inside-platform");
  const header = page.getByRole("banner");
  const main = page.getByRole("main");
  const initialMainRect = await main.evaluate((element) => {
    const { width, x } = element.getBoundingClientRect();
    return { width, x };
  });

  await page.evaluate(() => {
    const shellCls: unknown = Reflect.get(window, "__shellCls");
    if (typeof shellCls === "object" && shellCls !== null) {
      Reflect.set(shellCls, "value", 0);
    }
  });
  await header.hover();
  await hoverSettled(page);
  expect(
    await main.evaluate((element) => {
      const { width, x } = element.getBoundingClientRect();
      return { width, x };
    }),
  ).toEqual(initialMainRect);
  const shellCls = z
    .object({ value: z.number() })
    .parse(
      await page.evaluate((): unknown => Reflect.get(window, "__shellCls")),
    );
  expect(shellCls.value).toBeLessThanOrEqual(0.001);
  await wheelPresented(page, 600);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await main.evaluate((element) => element.scrollTop)).toBe(0);

  await main.hover({ position: { x: 600, y: 400 } });
  await wheelPresented(page, 600);
  // Сначала факт прокрутки основной области, потом отсутствие прокрутки окна при нём.
  await expect
    .poll(() => main.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

/** Событие, по которому наблюдатели проверок забирают свою очередь записей через `takeRecords`. */
const takePerformanceRecords = "inside:take-performance-records";

/**
 * Два кадра отрисованы, и наблюдатели забрали записи из очереди, не дожидаясь своего колбэка:
 * первый кадр применяет ввод и стили, после второго записи о первом уже стоят в очереди. Запись
 * Event Timing (INP) Chromium ставит по ответу о показе кадра, и если он опоздает, событие выпадет
 * из замера: проверка его не учтёт, но и не покраснеет от этого.
 */
async function framesPresented(page: Page) {
  await page.evaluate(async (takeRecordsEvent) => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    window.dispatchEvent(new Event(takeRecordsEvent));
  }, takePerformanceRecords);
}

/**
 * Наведение отыграло целиком: стили применены, конечные анимации и переходы, которые оно запустило,
 * закончились, а сдвиги раскладки забраны. Бесконечные анимации не ждём: они не заканчиваются, а
 * сдвиг от них проверка увидит и так.
 */
async function hoverSettled(page: Page) {
  await framesPresented(page);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().endTime !==
            Number.POSITIVE_INFINITY,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  await framesPresented(page);
}

/**
 * Колесо дошло до страницы, и кадры после него отрисованы: прокрутка от него, если она есть, уже
 * началась. `mouse.wheel` не ждёт ни доставки события, ни прокрутки.
 */
async function wheelPresented(page: Page, deltaY: number) {
  const wheel = await page.evaluateHandle(() => ({
    delivered: new Promise<void>((resolve) => {
      window.addEventListener(
        "wheel",
        () => {
          resolve();
        },
        { capture: true, once: true, passive: true },
      );
    }),
  }));
  await page.mouse.wheel(0, deltaY);
  await wheel.evaluate(({ delivered }) => delivered);
  await wheel.dispose();
  await framesPresented(page);
}

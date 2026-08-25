import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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
    const measurements = { cls: 0, inp: 0, lcp: 0 };
    Object.defineProperty(window, "__readerPerformance", { value: measurements });
    if (PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
          if (!shift.hadRecentInput) {
            measurements.cls += shift.value;
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
  const documentResponse = await request.get("/materials/inside-platform-overview");
  const initialHtml = await documentResponse.text();

  expect(documentResponse.status()).toBe(200);
  expect(initialHtml).toContain("Как устроен Inside Platform");
  expect(initialHtml).toContain("Первый вертикальный срез");

  const browserResponse = await page.goto("/materials/inside-platform-overview");
  expect(browserResponse?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Как устроен Inside Platform", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Первый вертикальный срез", level: 2 }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Как устроен Inside Platform · Inside");
  await expect(page.getByRole("link", { name: "В Библиотеку" }).first()).toBeVisible();
  await expect(page.getByRole("main")).toContainText("PostgreSQL хранит exact revision");
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
        __readerPerformance: { cls: number; inp: number; lcp: number };
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
  expect(metrics.cls).toBeLessThanOrEqual(0.1);
  expect(browserErrors).toEqual([]);
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

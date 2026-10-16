import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evidenceDirectory } from "../../../../scripts/evidence-path.mjs";

const backendPort = process.env["FAKE_BACKEND_PORT"];
if (backendPort === undefined) throw new Error("FAKE_BACKEND_PORT required");
const backend = `http://127.0.0.1:${backendPort}`;
const course = "/products/performance-course";
const programme = `${course}/programme`;
const lesson = "/materials/data-loading-image-lesson";
const recordsSchema = z.object({
  records: z.array(
    z.object({
      role: z.string(),
      method: z.string(),
      path: z.string(),
      status: z.number(),
      bytes: z.number(),
    }),
  ),
});
type Role = "guest" | "non-owner" | "active-owner";

async function session(context: BrowserContext, baseURL: string, role: Role) {
  if (role === "guest") return;
  const { wrapSession } = await import("@logto/node");
  await context.addCookies([
    {
      name: "logto_inside-web-navigation",
      httpOnly: true,
      sameSite: "Lax",
      url: baseURL,
      value: await wrapSession(
        {
          accessToken: JSON.stringify({
            [`@${backend}`]: {
              // deterministic-test-allow wall-clock: the separate production Web process and Logto validate this synthetic session against their live clock.
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
              scope: "",
              token: `matrix-${role}`,
            },
          }),
          idToken: "navigation.id.token",
          refreshToken: "navigation-refresh-token",
        },
        "inside-navigation-logto-cookie-secret-key",
      ),
    },
  ]);
}
test.beforeEach(async ({ browser, baseURL }) => {
  if (baseURL === undefined) throw new Error("Web origin required");
  const author = await browser.newContext();
  try {
    await session(author, baseURL, "active-owner");
    const response = await author.request.put(
      `${baseURL}/api/authoring/home-pin`,
      {
        headers: { origin: baseURL },
        multipart: { expectedVersion: "1", seriesId: "" },
      },
    );
    expect(response.status()).toBe(200);
  } finally {
    await author.close();
  }
});

async function reset(request: APIRequestContext) {
  expect(
    (
      await request.post(`${backend}/__data-loading`, {
        data: {
          enabled: true,
          reset: true,
          subscriptionOffered: false,
          priceKopecks: 990000,
          cohortRevision: 1,
          startsOn: "2026-11-15",
        },
      })
    ).ok(),
  ).toBe(true);
}
async function backendRecords(request: APIRequestContext) {
  return recordsSchema.parse(
    await (await request.get(`${backend}/__data-loading`)).json(),
  ).records;
}

async function save(label: string, value: unknown) {
  const directory = evidenceDirectory("issue-1466");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${label}.json`),
    JSON.stringify(value, null, 2),
  );
}

async function instrument(page: Page) {
  await page.addInitScript(() => {
    const events: {
      kind: string;
      time: number;
      path?: string;
      bytes?: number;
      value?: number;
      element?: string | undefined;
      hadRecentInput?: boolean;
    }[] = [];
    Reflect.set(window, "__dataLoadingEvents", events);
    let pendingRoutes = 0;
    Reflect.set(window, "__dataLoadingPendingRoutes", 0);
    const fetchOwner = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const [requested, options] = args;
      const requestHeaders = new Headers(
        options?.headers ??
          (requested instanceof Request ? requested.headers : undefined),
      );
      const ownedRoute =
        requestHeaders.get("rsc") === "1" &&
        !requestHeaders.has("next-router-prefetch");
      if (ownedRoute)
        Reflect.set(window, "__dataLoadingPendingRoutes", ++pendingRoutes);
      const response = await fetchOwner(...args);
      const path = new URL(response.url, location.href).pathname;
      const [input, init] = args;
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      if (headers.get("next-router-prefetch") === "3" && response.ok)
        void response
          .clone()
          .arrayBuffer()
          .then(
            () =>
              events.push({
                kind: "shell-prefetched",
                path,
                time: performance.now(),
              }),
            () => undefined,
          );
      const time = performance.now();
      void response
        .clone()
        .arrayBuffer()
        .then(
          (bytes) =>
            events.push({
              kind: "response-complete",
              path,
              time: performance.now(),
              bytes: bytes.byteLength,
            }),
          () => undefined,
        );
      if (ownedRoute)
        void response
          .clone()
          .arrayBuffer()
          .finally(() =>
            Reflect.set(window, "__dataLoadingPendingRoutes", --pendingRoutes),
          )
          .catch(() => undefined);
      events.push({ kind: "response-headers", path, time });
      return response;
    };
    for (const type of ["largest-contentful-paint", "layout-shift"]) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const element: unknown = Reflect.get(entry, "element");
          const value: unknown = Reflect.get(entry, "value");
          events.push({
            kind: type,
            element:
              element instanceof HTMLElement ? element.tagName : undefined,
            hadRecentInput: Reflect.get(entry, "hadRecentInput") === true,
            time: entry.startTime,
            value: typeof value === "number" ? value : entry.duration,
          });
        }
      }).observe({ type, buffered: true });
    }
    new MutationObserver(() => {
      for (const [kind, selector] of [
        [
          "body-ready",
          '[data-product-landing="performance-course"], [data-reader-body], [data-material-reader-state="access-required"], [data-product-programme="performance-course"], .home-feed-post',
        ],
        [
          "skeleton",
          '[data-reader-body-skeleton], [data-route-skeleton="product-landing"]',
        ],
        ["optional-ready", ".aie-cohort-status, [data-practice-view]"],
      ]) {
        if (selector === undefined || kind === undefined) continue;
        const visible = [...document.querySelectorAll(selector)].some(
          (element) =>
            element.getBoundingClientRect().height > 0 &&
            getComputedStyle(element).visibility !== "hidden" &&
            getComputedStyle(element).display !== "none",
        );
        if (
          visible &&
          !events.some(
            (event) => event.kind === kind && event.path === location.pathname,
          )
        )
          events.push({
            kind,
            path: location.pathname,
            time: performance.now(),
          });
      }
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
}
async function observations(page: Page) {
  return page.evaluate((): unknown => {
    const events: unknown = Reflect.get(window, "__dataLoadingEvents");
    return {
      events,
      resources: performance
        .getEntriesByType("resource")
        .filter(
          (entry): entry is PerformanceResourceTiming =>
            entry instanceof PerformanceResourceTiming,
        )
        .map((entry) => ({
          name: entry.name,
          startTime: entry.startTime,
          responseEnd: entry.responseEnd,
          encodedBodySize: entry.encodedBodySize,
          transferSize: entry.transferSize,
        })),
      completedAt: performance.now(),
    };
  });
}

for (const role of ["guest", "non-owner", "active-owner"] as const) {
  for (const path of ["cold", "warm", "intent"] as const) {
    test(`production matrix ${role} ${path}: course body, two cohort blocks, programme and private reader`, async ({
      page,
      context,
      request,
      baseURL,
    }, info) => {
      if (baseURL === undefined) throw new Error("Web origin required");
      await session(context, baseURL, role);
      await reset(request);
      await instrument(page);
      try {
        let courseStart = 0;
        let documentResponse;
        if (path === "cold")
          documentResponse = await page.goto(course, { waitUntil: "commit" });
        else {
          if (path === "warm") {
            await page.goto(course, { waitUntil: "commit" });
            await expect(
              page.locator('[data-product-landing="performance-course"]'),
            ).toBeVisible();
            await page
              .locator('a[href="/"]')
              .filter({ visible: true })
              .first()
              .click();
          } else await page.goto("/", { waitUntil: "commit" });
          await expect(page.locator(".home-feed-post").first()).toBeVisible();
          await request.post(`${backend}/__data-loading`, {
            data: { reset: true },
          });
          const link = page
            .locator(`a[href^="${course}"]`)
            .filter({ visible: true })
            .first();
          await expect(link).toBeVisible();
          if (path === "intent") {
            await link.hover();
            await expect
              .poll(() =>
                page.evaluate((): unknown => {
                  const events: unknown = Reflect.get(
                    window,
                    "__dataLoadingEvents",
                  );
                  return (
                    Array.isArray(events) &&
                    events.some(
                      (event: unknown) =>
                        typeof event === "object" &&
                        event !== null &&
                        Reflect.get(event, "kind") === "shell-prefetched" &&
                        Reflect.get(event, "path") ===
                          "/products/performance-course",
                    )
                  );
                }),
              )
              .toBe(true);
          }
          courseStart = await page.evaluate(() => {
            const events: unknown = Reflect.get(window, "__dataLoadingEvents");
            if (Array.isArray(events)) {
              for (let index = events.length - 1; index >= 0; index--) {
                const event: unknown = events[index];
                if (
                  typeof event === "object" &&
                  event !== null &&
                  Reflect.get(event, "kind") === "skeleton" &&
                  Reflect.get(event, "path") === "/products/performance-course"
                )
                  events.splice(index, 1);
              }
            }
            return performance.now();
          });
          await link.click();
        }
        await expect(
          page.locator('[data-product-landing="performance-course"]'),
        ).toBeVisible();
        const bodyReady = await page.evaluate(() => performance.now());
        if (role === "active-owner")
          await expect(page.locator(".aie-cohort-status")).toHaveCount(0);
        else {
          await expect(page.locator(".aie-cohort-status")).toBeVisible();
          await expect(
            page.locator(".aie-cohort-status-countdown"),
          ).toContainText("до старта");
        }
        await expect(
          page.locator(".start-countdown-badge").first(),
        ).toContainText("до старта");
        const optionalReady = await page.evaluate(() => performance.now());
        await documentResponse?.finished();
        await expect
          .poll(() =>
            page.evaluate((): unknown =>
              Reflect.get(window, "__dataLoadingPendingRoutes"),
            ),
          )
          .toBe(0);
        const totalOwnerPageComplete = await page.evaluate(() =>
          performance.now(),
        );
        const timings = {
          courseStart,
          bodyReady,
          optionalReady,
          totalOwnerPageComplete,
          millisecondsToBody: bodyReady - courseStart,
          skeletonReady: await page.evaluate((startedAt) => {
            const events: unknown = Reflect.get(window, "__dataLoadingEvents");
            if (!Array.isArray(events)) return null;
            for (const value of events) {
              const event: unknown = value;
              if (
                typeof event !== "object" ||
                event === null ||
                Reflect.get(event, "kind") !== "skeleton" ||
                Reflect.get(event, "path") !== "/products/performance-course"
              )
                continue;
              const time: unknown = Reflect.get(event, "time");
              if (typeof time === "number" && time >= startedAt) return time;
            }
            return null;
          }, courseStart),
        };
        const courseTrace = await backendRecords(request);
        const courseBrowser = await observations(page);
        // Save current-visit milestones before the cost assertion: a measured RED is evidence, not a passed regression.
        await save(`course-timing-${info.project.name}-${role}-${path}`, {
          role,
          path,
          viewport: page.viewportSize(),
          timings,
          courseTrace,
          courseBrowser,
        });
        const courseReads = courseTrace.filter(
          (record) =>
            record.path.startsWith("/billing/offers?") ||
            record.path.startsWith("/billing/cohorts"),
        );
        await save(`course-count-${info.project.name}-${role}-${path}`, {
          role,
          path,
          courseReads,
          allCourseReads: courseTrace,
        });
        const identities = [
          ...new Set(
            courseReads.map((record) => `${record.role}:${record.path}`),
          ),
        ];
        for (const identity of identities) {
          const publicTermsOffers =
            path === "cold" &&
            role === "guest" &&
            identity.includes("/billing/offers?")
              ? 1
              : 0;
          expect(
            courseReads.filter(
              (record) => `${record.role}:${record.path}` === identity,
            ).length,
            `same request-owned ${identity}`,
          ).toBe(1 + publicTermsOffers);
        }
        await page
          .locator(`a[href="${programme}"]`)
          .filter({ visible: true })
          .first()
          .click();
        await expect(
          page.locator('[data-product-programme="performance-course"]:visible'),
        ).toBeVisible();
        const programmeBrowser = await observations(page);
        // This independently addressed private fixture is not accidentally admitted to the public programme cache.
        await page.goto(lesson, { waitUntil: "commit" });
        await expect(
          page.locator(
            role === "guest"
              ? '[data-material-reader-state="access-required"]'
              : "[data-reader-body]",
          ),
        ).toBeVisible();
        const browserTrace = await observations(page);
        await save(`matrix-${info.project.name}-${role}-${path}`, {
          role,
          path,
          viewport: page.viewportSize(),
          courseTrace,
          courseBrowser,
          timings,
          programmeBrowser,
          backend: await backendRecords(request),
          browser: browserTrace,
        });
        await info.attach("data-loading-matrix", {
          body: JSON.stringify({
            role,
            path,
            viewport: page.viewportSize(),
            courseTrace,
            courseBrowser,
            timings,
            programmeBrowser,
            backend: await backendRecords(request),
            browser: browserTrace,
          }),
          contentType: "application/json",
        });
      } finally {
        await request.post(`${backend}/__data-loading`, {
          data: { enabled: false },
        });
      }
    });
  }
}

for (const role of ["guest", "non-owner", "active-owner"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const column of [400, 700] as const) {
      test(`EC3 ${role} ${theme} column ${String(column)}: actual protected image discovery and geometry`, async ({
        page,
        context,
        request,
        baseURL,
      }, info) => {
        test.skip(
          info.project.name === "mobile-chromium" && column === 700,
          "A narrow device measures its actual available column; wide-device probes independently cover 400 and 700.",
        );
        if (baseURL === undefined) throw new Error("Web origin required");
        await session(context, baseURL, role);
        await reset(request);
        await instrument(page);
        // The manual theme deliberately differs from OS preference. Column selection must follow the article, not viewport media.
        await page.emulateMedia({
          colorScheme: theme === "light" ? "dark" : "light",
        });
        await page.addInitScript(
          ({ dark, columnWidth }) => {
            const install = () => {
              const head = document.querySelector("head");
              if (
                head === null ||
                document.querySelector("#matrix-image-style") !== null
              )
                return;
              const style = document.createElement("style");
              style.id = "matrix-image-style";
              style.textContent = `html,body,[data-public-shell] {--theme-is-dark:${dark ? "1" : "0"}!important} div:has(>[data-image-composition="variants"]) {width:${String(columnWidth)}px!important;max-width:${innerWidth >= 700 ? "none" : "100%"}!important}`;
              head.append(style);
            };
            const observe = () => {
              install();
              const composition = document.querySelector(
                '[data-image-composition="variants"]',
              );
              if (
                composition?.querySelector("img") === null &&
                composition.getBoundingClientRect().height > 0
              ) {
                const box = composition.getBoundingClientRect();
                Reflect.set(window, "__reservedImageGeometry", {
                  width: box.width,
                  height: box.height,
                });
              }
            };
            new MutationObserver(observe).observe(document, {
              childList: true,
              subtree: true,
            });
            observe();
          },
          { dark: theme === "dark", columnWidth: column },
        );
        try {
          const htmlResponse = await context.request.get(`${baseURL}${lesson}`);
          expect(htmlResponse.status()).toBe(200);
          const html = await htmlResponse.text();
          expect(html).toContain("Четыре варианта изображения");
          expect(html).toContain(
            `data-material-reader-state="${role === "guest" ? "access-required" : "available"}"`,
          );
          const htmlHasImage = new RegExp(
            "<img[^>]+src=[^>]*/api/materials/",
            "u",
          ).test(html);
          expect(htmlHasImage).toBe(false);
          await request.post(`${backend}/__data-loading`, {
            data: { reset: true },
          });
          await page.goto(lesson, { waitUntil: "commit" });
          if (role === "guest") {
            await expect(
              page.locator('[data-material-reader-state="access-required"]'),
            ).toBeVisible();
            expect(
              (await backendRecords(request)).filter((record) =>
                record.path.includes("/assets/"),
              ).length,
            ).toBe(0);
            await save(
              `images-${info.project.name}-${role}-${theme}-${String(column)}`,
              {
                role,
                theme,
                column,
                htmlHasImage,
                protectedRequests: 0,
                browser: await observations(page),
              },
            );
          } else {
            const composition = page.locator(
              '[data-image-composition="variants"]',
            );
            const image = composition.locator("img");
            await expect(image).toBeVisible();
            await image.scrollIntoViewIfNeeded();
            await expect
              .poll(() =>
                image.evaluate(
                  (element) =>
                    element instanceof HTMLImageElement &&
                    element.complete &&
                    element.naturalWidth > 0,
                ),
              )
              .toBe(true);
            const geometry = await composition.evaluate((element) => {
              const box = element.getBoundingClientRect();
              return { width: box.width, height: box.height };
            });
            if (info.project.name === "desktop-chromium")
              expect(geometry.width).toBe(column);
            else expect(geometry.width).toBeLessThanOrEqual(390);
            expect(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            ).toBe(true);
            const wide = geometry.width >= 560;
            const expectedAsset = wide
              ? theme === "light"
                ? "777777779901"
                : "777777779902"
              : theme === "light"
                ? "777777779903"
                : "777777779904";
            expect(await image.getAttribute("src")).toContain(expectedAsset);
            const expectedRatio = wide
              ? theme === "light"
                ? 960 / 420
                : 960 / 500
              : theme === "light"
                ? 420 / 900
                : 420 / 1100;
            expect(geometry.width / geometry.height).toBeCloseTo(
              expectedRatio,
              2,
            );
            const reserved = z
              .object({ width: z.number(), height: z.number() })
              .parse(
                await page.evaluate((): unknown =>
                  Reflect.get(window, "__reservedImageGeometry"),
                ),
              );
            expect(geometry.width).toBeCloseTo(reserved.width, 1);
            expect(geometry.height).toBeCloseTo(reserved.height, 1);
            const delivered = (await backendRecords(request)).filter((record) =>
              record.path.includes("/assets/"),
            );
            expect(delivered.length).toBe(1);
            expect(delivered[0]?.path).toContain(expectedAsset);
            expect(delivered[0]?.role).toBe(role);
            await save(
              `images-${info.project.name}-${role}-${theme}-${String(column)}`,
              {
                role,
                theme,
                column,
                actualColumn: geometry.width,
                htmlHasImage,
                expectedAsset,
                geometry,
                reserved,
                delivered,
                browser: await observations(page),
              },
            );
          }
        } finally {
          await request.post(`${backend}/__data-loading`, {
            data: { enabled: false },
          });
        }
      });
    }
  }
}

for (const role of ["guest", "non-owner", "active-owner"] as const) {
  for (const journey of [
    "unused",
    "cold-return",
    "warm-return",
    "stale-return",
  ] as const) {
    test(`EC4 ${role} ${journey}: consumed home bytes and retained query return`, async ({
      page,
      context,
      request,
      baseURL,
    }, info) => {
      if (baseURL === undefined) throw new Error("Web origin required");
      await session(context, baseURL, role);
      await reset(request);
      await instrument(page);
      await page.clock.install();
      const feedResponses: {
        bytes: number;
        cacheControl: string | undefined;
      }[] = [];
      page.on("response", (response) => {
        if (new URL(response.url()).pathname !== "/api/home/materials") return;
        void response.body().then(
          (bytes) =>
            feedResponses.push({
              bytes: bytes.byteLength,
              cacheControl: response.headers()["cache-control"],
            }),
          () => undefined,
        );
      });
      try {
        if (journey === "warm-return" || journey === "stale-return") {
          await page.goto("/", { waitUntil: "commit" });
          await expect(page.locator(".home-feed-post").first()).toBeVisible();
          await expect.poll(() => feedResponses.length).toBe(1);
          await page
            .locator(`a[href^="${course}"]`)
            .filter({ visible: true })
            .first()
            .click();
        } else await page.goto(course, { waitUntil: "commit" });
        await expect(
          page.locator('[data-product-landing="performance-course"]'),
        ).toBeVisible();
        await page.clock.runFor(250);
        // Clock advancement starts prefetch; the completed body is its independent barrier.
        await expect.poll(() => feedResponses.length).toBe(1);
        const beforeReturn = [...feedResponses];
        if (journey === "unused") {
          await page
            .locator(`a[href="${programme}"]`)
            .filter({ visible: true })
            .first()
            .click();
          await expect(
            page.locator(
              '[data-product-programme="performance-course"]:visible',
            ),
          ).toBeVisible();
          await page.clock.runFor(250);
          await page
            .locator('a[href^="/materials/performance-lesson-1?"]')
            .filter({ visible: true })
            .first()
            .click();
          await expect(
            page.locator("[data-reader-body]:visible"),
          ).toBeVisible();
          await page.clock.runFor(250);
          const courseReader = page.locator("[data-course-reading]:visible");
          const allProgramme = courseReader.getByRole("button", {
            name: "Вся программа",
            exact: true,
          });
          const mobile = await allProgramme.isVisible();
          if (mobile) {
            await allProgramme.click();
            const dialog = courseReader.getByRole("dialog");
            await expect(dialog).toBeVisible();
            await dialog
              .getByRole("button", { name: "Закрыть программу", exact: true })
              .click();
            await expect(dialog).toHaveCount(0);
          }
          await (
            mobile
              ? courseReader
                  .getByRole("navigation", { name: "Хлебные крошки" })
                  .getByRole("link")
                  .first()
              : courseReader
                  .getByRole("navigation", { name: "Хлебные крошки" })
                  .getByRole("link")
                  .first()
          ).click();
          await expect(
            page.locator(
              '[data-product-programme="performance-course"]:visible',
            ),
          ).toBeVisible();
          await page.clock.runFor(250);
          // Negative assertion after the programme's committed render and the whole scheduled interval.
          expect(feedResponses.length).toBe(1);
          await save(`home-${info.project.name}-${role}-${journey}`, {
            role,
            journey,
            consumed: false,
            unusedBytes: beforeReturn.reduce(
              (total, response) => total + response.bytes,
              0,
            ),
            feedResponses,
            backend: await backendRecords(request),
            browser: await observations(page),
          });
        } else {
          if (journey === "stale-return") await page.clock.runFor(30001);
          const start = await page.evaluate(() => performance.now());
          await page
            .locator('a[href="/"]')
            .filter({ visible: true })
            .first()
            .click();
          await expect(page.locator(".home-feed-post").first()).toBeVisible();
          const bodyReady = await page.evaluate(() => performance.now());
          if (journey === "stale-return")
            await expect.poll(() => feedResponses.length).toBe(2);
          else expect(feedResponses.length).toBe(1);
          await save(`home-${info.project.name}-${role}-${journey}`, {
            role,
            journey,
            consumed: true,
            unusedBytes: 0,
            cacheHitOnReturn: journey !== "stale-return",
            millisecondsToHomeBody: bodyReady - start,
            feedResponses,
            backend: await backendRecords(request),
            browser: await observations(page),
          });
        }
      } finally {
        await request.post(`${backend}/__data-loading`, {
          data: { enabled: false },
        });
      }
    });
  }
}

test("FLOW04 cold and warm closed guest eligibility stays fresh while public projection is reused", async ({
  page,
  request,
}, info) => {
  await reset(request);
  const path = "/materials/data-loading-subscription-lesson";
  try {
    await page.goto(path, { waitUntil: "commit" });
    await expect(
      page.locator('[data-material-reader-state="access-required"]'),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Получить доступ", exact: true }),
    ).toHaveCount(0);
    const cold = (await backendRecords(request)).filter(
      (record) => record.path === path,
    );
    await request.post(`${backend}/__data-loading`, {
      data: { subscriptionOffered: true, reset: true },
    });
    await page.reload({ waitUntil: "commit" });
    const invitation = page.getByRole("link", {
      name: "Получить доступ",
      exact: true,
    });
    await expect(invitation).toBeVisible();
    await expect(invitation).toHaveAttribute(
      "href",
      `/payment/checkout?from=${encodeURIComponent(`${path}?from=%2F`)}`,
    );
    const warm = (await backendRecords(request)).filter(
      (record) => record.path === path,
    );
    expect(warm.length).toBe(1);
    expect(
      (await backendRecords(request)).filter((record) =>
        record.path.includes("/assets/"),
      ).length,
    ).toBe(0);
    await save(`eligibility-${info.project.name}`, {
      cold,
      warm,
      falseHadInvitation: false,
      trueHasInvitation: true,
      protectedImages: 0,
    });
  } finally {
    await request.post(`${backend}/__data-loading`, {
      data: { enabled: false },
    });
  }
});

for (const role of ["guest", "non-owner"] as const) {
  test(`FLOW03 ${role}: a new request refreshes private prices and the public cohort`, async ({
    page,
    context,
    request,
    baseURL,
  }, info) => {
    if (baseURL === undefined) throw new Error("Web origin required");
    await session(context, baseURL, role);
    await reset(request);
    try {
      await page.goto(course, { waitUntil: "commit" });
      const status = page.locator(".aie-cohort-status");
      await expect(status).toBeVisible();
      await expect(status).toContainText(
        role === "guest" ? /9\s*900/u : /8\s*900/u,
      );
      await expect(status).toContainText("ноября");
      const before = await backendRecords(request);
      await request.post(`${backend}/__data-loading`, {
        data: {
          reset: true,
          priceKopecks: 1290000,
          cohortRevision: 2,
          startsOn: "2026-12-15",
        },
      });
      await page.reload({ waitUntil: "commit" });
      await expect(status).toContainText(
        role === "guest" ? /12\s*900/u : /11\s*900/u,
      );
      await expect(status).toContainText("декабря");
      const after = await backendRecords(request);
      const offers = after.filter((record) =>
        record.path.startsWith("/billing/offers?"),
      );
      const cohorts = after.filter((record) =>
        record.path.startsWith("/billing/cohorts"),
      );
      expect(offers).toHaveLength(1);
      expect(offers[0]?.role).toBe(role);
      expect(cohorts).toHaveLength(1);
      expect(cohorts[0]?.role).toBe("guest");
      await save(`price-freshness-${info.project.name}-${role}`, {
        role,
        before,
        after,
        publicProjectionReused: true,
        priceChangedOnNewRequest: true,
        publicCohortAnonymous: true,
      });
    } finally {
      await request.post(`${backend}/__data-loading`, {
        data: { enabled: false },
      });
    }
  });
}

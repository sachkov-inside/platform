import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evidenceDirectory } from "../../../../scripts/evidence-path.mjs";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { z } from "zod";
import {
  openProgrammeChapter,
  programmeChapterWindow,
} from "../support/programme-chapter";

const backend = `http://127.0.0.1:${process.env["FAKE_BACKEND_PORT"] ?? ""}`;
const journal = z.object({
  reads: z.array(
    z.object({ path: z.string(), authorized: z.boolean(), status: z.number() }),
  ),
});
async function saveEvidence(
  info: TestInfo,
  name: string,
  body: string | Buffer,
) {
  const directory = evidenceDirectory("issue-1710");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${info.project.name}-${name}`), body);
}
async function signIn(context: BrowserContext, baseURL: string, slug: string) {
  const { wrapSession } = await import("@logto/node");
  await context.addCookies([
    {
      name: "logto_inside-web-navigation",
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
      value: await wrapSession(
        {
          accessToken: JSON.stringify({
            [`@${backend}`]: {
              // deterministic-test-allow wall-clock: the separate production Web and Logto processes validate this synthetic session with their live clock.
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
              scope: "",
              token: `reader-state:${slug}`,
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
/** Тому, кто ещё не учится, анимация зовёт попробовать бесплатные уроки (#1647). */
async function expectTryFreeOnFilm(page: Page, slug: string) {
  const film = page.locator(".aie-learning-film");
  await expect(film.getByRole("link")).toHaveCount(1);
  await expect(
    film.getByRole("link", { name: "Попробовать бесплатно" }),
  ).toHaveAttribute("href", `/products/${slug}/programme`);
}

for (const scenario of [
  "guest",
  "paid",
  "manual",
  "stopped",
  "archive",
  "waitlist",
  "unknown",
] as const) {
  test(`one request-owned Product reader projection: ${scenario}`, async ({
    page,
    context,
    request,
    baseURL,
  }, info) => {
    if (baseURL === undefined) throw new Error("Web origin required");
    const slug = `reader-state-${scenario}${info.project.name === "mobile-chromium" ? "-mobile" : ""}`;
    if (["paid", "manual", "archive", "unknown"].includes(scenario)) {
      await signIn(context, baseURL, slug);
    }
    // Личная часть приходит потоком после гидратации провайдера; она не должна расходиться с
    // ответом сервера (#1938).
    const renderErrors: string[] = [];
    page.on("pageerror", (error) => renderErrors.push(error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /#418|#423|#425|hydrat|did not match|didn't match/iu.test(
          message.text(),
        )
      )
        renderErrors.push(message.text());
    });
    await request.delete(`${backend}/__product-reader-state`);
    const documentResponse = await page.goto(`/products/${slug}`, {
      waitUntil: "commit",
    });
    await documentResponse?.finished();
    const reads = journal.parse(
      await (await request.get(`${backend}/__product-reader-state`)).json(),
    ).reads;
    const journalBody = JSON.stringify({ scenario, reads }, null, 2);
    await saveEvidence(info, `${scenario}-http.json`, journalBody);
    await info.attach("product-reader-state-http-journal.json", {
      body: journalBody,
      contentType: "application/json",
    });

    const visibleLanding = page
      .locator(`[data-product-landing="${slug}"]`)
      .filter({ visible: true });
    await expect(visibleLanding).toHaveCount(1);
    await expect(visibleLanding).toBeVisible();
    const holder = ["paid", "manual", "archive"].includes(scenario);
    if (holder) {
      await expect(
        page
          .locator(".aie-learning-film")
          .getByRole("link", { name: "Продолжить обучение" }),
      ).toBeVisible();
      await expect(visibleLanding.locator(".aie-status")).toBeHidden();
    } else if (scenario === "waitlist") {
      // Сервер рисует гостю «Проверяю запись…»; доступная кнопка появляется только после
      // гидратации слотов, поэтому она же служит барьером для проверки ошибок ниже.
      const joins = page.getByRole("button", {
        name: "Вступить в список ожидания",
      });
      await expect(joins).toHaveCount(2);
      for (const join of await joins.all()) await expect(join).toBeEnabled();
      // Курс с бесплатными уроками зовёт из билета попробовать бесплатно (#1647).
      await expect(
        page
          .getByRole("link", { name: "Попробовать бесплатно", exact: true })
          .last(),
      ).toHaveAttribute("href", `/products/${slug}/programme`);
    } else if (scenario === "guest") {
      // Первый экран цену не показывает; покупку несёт билет нижнего блока (#1647).
      await expect(
        page.getByRole("link", { name: /^Приобрести доступ/u }).first(),
      ).toHaveAttribute("href", `/products/${slug}/buy`);
      await expect(page.getByRole("link", { name: /^Оплатить/u })).toHaveCount(
        0,
      );
    } else {
      await expect(
        page.getByRole("link", { name: /^(Оплатить|Приобрести доступ)/u }),
      ).toHaveCount(0);
      // Неизвестный доступ может принадлежать ученику: ему бесплатное не предлагается.
      if (scenario === "unknown") {
        const film = visibleLanding.locator(".aie-learning-film");
        const programme = film.getByRole("link", {
          name: "Посмотреть программу",
        });
        await expect(programme).toBeVisible();
        await expect(programme).toHaveAttribute(
          "href",
          `/products/${slug}/programme`,
        );
        await expect(
          film.getByRole("link", { name: /бесплатно/u }),
        ).toHaveCount(0);
      } else await expectTryFreeOnFilm(page, slug);
    }
    for (const suffix of ["/access", "/intake", "/membership"])
      expect(
        reads.filter((row) => row.path.endsWith(suffix)).length,
      ).toBeLessThanOrEqual(1);
    expect(
      reads.filter((row) =>
        row.path.startsWith("/billing/product-sales-states?"),
      ),
    ).toHaveLength(1);
    const continuations = reads.filter((row) =>
      row.path.startsWith("/reading-activity/product-continuation/"),
    );
    expect(continuations).toHaveLength(holder ? 1 : 0);
    expect(continuations.every((row) => row.authorized)).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(renderErrors).toEqual([]);
    if (["manual", "waitlist", "unknown"].includes(scenario)) {
      const capture = await screenshotWholePage(page);
      await saveEvidence(info, `${scenario}.png`, capture);
      await info.attach(`reader-state-${scenario}.png`, {
        body: capture,
        contentType: "image/png",
      });
    }
  });
}

test("each product resumes its own ready waitlist intent across a client navigation", async ({
  page,
  context,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("Web origin required");
  const first = {
    productSlug: "reader-state-waitlist",
    productId: "17100000-0000-4000-8000-000000000006",
  };
  const next = {
    productSlug: "reader-state-waitlist-mobile",
    productId: "17100000-0000-4000-8000-000000000106",
  };
  await signIn(context, baseURL, "reader-state-paid");
  const begin = async (product: typeof first) => {
    const response = await context.request.post(
      new URL("/api/product-waitlist/intent", baseURL).href,
      {
        headers: { origin: new URL(baseURL).origin },
        data: product,
      },
    );
    expect(response.ok()).toBe(true);
    const result = z
      .object({ kind: z.literal("continue"), returnTo: z.string() })
      .parse(await response.json());
    return new URL(result.returnTo, baseURL);
  };
  const firstReturn = await begin(first);
  const nextPath = "/products/" + next.productSlug;
  firstReturn.searchParams.set("from", nextPath);
  const writes: unknown[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/product-waitlist/join" &&
      request.method() === "POST"
    )
      writes.push(request.postDataJSON());
  });
  const expired =
    "Время подтверждения истекло. Вы ещё не в списке. Попробуйте снова.";
  await page.goto(firstReturn.href);
  await expect(page.getByText(expired, { exact: true })).toHaveCount(2);
  expect(writes).toEqual([{ productId: first.productId }]);
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  await begin(next);
  const link = page.getByRole("link", { name: "Назад к продукту" });
  await expect(link).toHaveAttribute("href", nextPath);
  await link.click();
  await expect(page).toHaveURL(new URL(nextPath, baseURL).href);
  await expect(
    page
      .locator(`[data-product-landing="${next.productSlug}"]:visible`)
      .getByText(expired, { exact: true }),
  ).toHaveCount(2);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  expect(writes).toEqual([
    { productId: first.productId },
    { productId: next.productId },
  ]);
});

for (const result of ["ready", "failed"] as const) {
  test(`the restored ${result} purchase refreshes its individual payment link`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("Web origin required");
    await signIn(context, baseURL, "reader-state-paid");
    try {
      const setup = await request.post(
        backend + "/__purchase-settlement?result=" + result,
      );
      expect(setup.ok()).toBe(true);
      const { linkId } = z
        .object({ linkId: z.uuid() })
        .parse(await setup.json());
      // #2244 measures this page's refresh independently of the AppShell billing listener.
      await page.addInitScript(() => {
        Object.defineProperty(window, "BroadcastChannel", { value: undefined });
        window.addEventListener(
          "inside.account.billing.changed",
          (event) => {
            const root = document.documentElement;
            root.dataset["billingEvents"] = String(
              Number(root.dataset["billingEvents"] ?? 0) + 1,
            );
            if (
              event instanceof CustomEvent &&
              typeof event.detail === "string"
            )
              document.documentElement.setAttribute(
                "data-billing-announcement",
                event.detail,
              );
            event.stopImmediatePropagation();
          },
          { capture: true },
        );
      });
      const restore = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
          "/api/account/billing/product-purchase",
      );
      await page.goto("/payment/links/" + linkId);
      expect(await (await restore).json()).toMatchObject({
        ok: true,
        value: result === "ready" ? { access: "ready" } : { state: "failed" },
      });
      await expect(
        page.getByRole("heading", { name: "Обновлённое название курса" }),
      ).toBeVisible();
      expect(
        await page
          .locator("html")
          .evaluate((root) =>
            Number(root.getAttribute("data-billing-events") ?? 0),
          ),
      ).toBe(result === "ready" ? 1 : 0);
      if (result === "ready") {
        await expect(
          page.getByRole("link", { name: "Открыть продукт" }),
        ).toBeVisible();
        expect(
          z
            .uuid()
            .safeParse(
              await page
                .locator("html")
                .getAttribute("data-billing-announcement"),
            ).success,
        ).toBe(true);
      } else {
        await expect(
          page.getByRole("heading", { name: "Ссылка отозвана" }),
        ).toBeVisible();
      }
    } finally {
      expect(
        (await request.post(backend + "/__purchase-settlement")).ok(),
      ).toBe(true);
    }
  });
}

test("the same public Product shell isolates guest, holder and later guest across requests", async ({
  browser,
  request,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("Web origin required");
  const slug = `reader-state-paid${info.project.name === "mobile-chromium" ? "-mobile" : ""}`;
  await request.delete(`${backend}/__product-reader-state`);
  for (const holder of [false, true, false]) {
    const context = await browser.newContext({
      viewport: info.project.use.viewport ?? null,
    });
    try {
      if (holder) await signIn(context, baseURL, slug);
      const page = await context.newPage();
      const response = await page.goto(`${baseURL}/products/${slug}`, {
        waitUntil: "commit",
      });
      await response?.finished();
      if (holder)
        await expect(
          page
            .locator(".aie-learning-film")
            .getByRole("link", { name: "Продолжить обучение" }),
        ).toBeVisible();
      else {
        await expectTryFreeOnFilm(page, slug);
        await expect(
          page.getByRole("link", { name: /^Приобрести доступ/u }).first(),
        ).toHaveAttribute("href", `/products/${slug}/buy`);
      }
    } finally {
      await context.close();
    }
  }
  const journalBody = JSON.stringify(
    await (await request.get(`${backend}/__product-reader-state`)).json(),
    null,
    2,
  );
  await saveEvidence(info, "cross-request-http.json", journalBody);
  await info.attach("cross-request-http-journal.json", {
    body: journalBody,
    contentType: "application/json",
  });
});

async function invalidateHomePin(context: BrowserContext, baseURL: string) {
  const response = await context.request.put(
    `${baseURL}/api/authoring/home-pin`,
    {
      headers: { origin: baseURL },
      data: { expectedVersion: 1, productId: null },
    },
  );
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({
    kind: "ready",
    pin: { productId: null },
  });
}

test("the AI-first pin keeps the home feed in place when the continuation appears (#652)", async ({
  page,
  context,
  request,
  baseURL,
  isMobile,
}) => {
  if (baseURL === undefined) throw new Error("Web origin required");
  const slug = `reader-state-paid${isMobile ? "-mobile" : ""}`;
  await signIn(context, baseURL, slug);
  const requested = Promise.withResolvers<undefined>();
  const progress = Promise.withResolvers<undefined>();
  try {
    const pin = await request.post(
      `${backend}/__product-reader-state?pin=${slug}&presentation=ai-first-process`,
    );
    expect(pin.ok()).toBe(true);
    await invalidateHomePin(context, baseURL);
    await page.route(
      "**/api/reading-progress/product-continuation",
      async (route) => {
        requested.resolve(undefined);
        await progress.promise;
        await route.continue();
      },
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const card = page.locator('[data-product-presentation="ai-first-process"]');
    const feed = page.getByRole("region", { name: "Материалы", exact: true });
    const link = card.getByRole("link", { name: "Продолжить обучение" });
    await expect(card).toBeVisible();
    await expect(feed).toBeVisible();
    await requested.promise;
    await expect(link).toHaveCount(0);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const positions = () =>
      feed.evaluate((node) => {
        const card = document.querySelector(
          '[data-product-presentation="ai-first-process"]',
        );
        if (card === null) throw new Error("The AI-first pin is missing");
        return {
          cardTop: card.getBoundingClientRect().top,
          feedTop: node.getBoundingClientRect().top,
        };
      });
    const before = await positions();
    progress.resolve(undefined);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", `/products/${slug}/programme`);
    const after = await positions();
    expect(after.cardTop).toBeCloseTo(before.cardTop, 0);
    expect(after.feedTop).toBeCloseTo(before.feedTop, 0);
  } finally {
    progress.resolve(undefined);
    const reset = await request.post(`${backend}/__product-reader-state`);
    await invalidateHomePin(context, baseURL);
    expect(reset.ok()).toBe(true);
  }
});

test("Home displays the same Product learning state while its shared pin stays public", async ({
  browser,
  request,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("Web origin required");
  const slug = `reader-state-paid${info.project.name === "mobile-chromium" ? "-mobile" : ""}`;
  const owner = await browser.newContext({
    viewport: info.project.use.viewport ?? null,
  });
  await signIn(owner, baseURL, slug);
  try {
    await request.post(`${backend}/__product-reader-state?pin=${slug}`);
    await invalidateHomePin(owner, baseURL);
    await request.delete(`${backend}/__product-reader-state`);
    const page = await owner.newPage();
    const response = await page.goto(baseURL, { waitUntil: "commit" });
    await response?.finished();
    // На телефоне у карточки курса кнопки нет (решение владельца 23.11.2026): состояние обучения
    // приходит в разметку и остаётся скрытым.
    // Пока потоковая вставка не завершена, скрытая копия границы Suspense тоже в документе: у
    // обеих ссылок один адрес, поэтому достаточно первой.
    await expect(
      page
        .getByRole("link", {
          name: "Продолжить обучение",
          exact: true,
          includeHidden: info.project.name === "mobile-chromium",
        })
        .first(),
    ).toHaveAttribute("href", `/products/${slug}/programme`);
    const reads = journal.parse(
      await (await request.get(`${backend}/__product-reader-state`)).json(),
    ).reads;
    expect(
      reads.filter((row) =>
        row.path.startsWith("/reading-activity/product-continuation/"),
      ),
    ).toHaveLength(1);
    expect(
      reads
        .filter((row) => row.path === "/library/home")
        .every((row) => !row.authorized),
    ).toBe(true);
    const journalBody = JSON.stringify(reads, null, 2);
    await saveEvidence(info, "home-http.json", journalBody);
    await info.attach("home-reader-http-journal.json", {
      body: journalBody,
      contentType: "application/json",
    });
    const guest = await browser.newContext({
      viewport: info.project.use.viewport ?? null,
    });
    try {
      const guestPage = await guest.newPage();
      const guestResponse = await guestPage.goto(baseURL, {
        waitUntil: "commit",
      });
      await guestResponse?.finished();
      await expect(
        guestPage.getByRole("link", {
          name: "Продолжить обучение",
          exact: true,
        }),
      ).toHaveCount(0);
    } finally {
      await guest.close();
    }
  } finally {
    await request.post(`${backend}/__product-reader-state`);
    await invalidateHomePin(owner, baseURL);
    await owner.close();
  }
});

test("continue from a chapter window returns to its lesson after Back", async ({
  page,
  context,
  request,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("Web origin required");
  const slug = `reader-state-paid${info.project.name === "mobile-chromium" ? "-mobile" : ""}`;
  await signIn(context, baseURL, slug);
  await request.post(`${backend}/__product-reader-state?pin=${slug}`);
  try {
    await page.goto(`/products/${slug}/programme`);
    const continueLink = (
      await openProgrammeChapter(page, "current")
    ).getByRole("link", { name: /^Продолжить: /u });
    const href = await continueLink.getAttribute("href");
    if (href === null) throw new Error("Continue action without a lesson");
    const lesson = new URL(href, baseURL).pathname.split("/").at(-1) ?? "";
    await continueLink.click();
    await page.waitForURL(new RegExp(`/materials/${lesson}`, "u"));
    // The continue action records its lesson like a row does, so Back returns to that row.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`[?&]at=${lesson}`, "u"));
    const reopened = programmeChapterWindow(page);
    await expect(reopened).toBeVisible();
    await expect(
      reopened.locator(`[data-route-material="${lesson}"]`),
    ).toBeInViewport();
  } finally {
    await request.post(`${backend}/__product-reader-state`);
  }
});

for (const optional of ["all", "community"] as const) {
  for (const surface of ["Product", "Home", "Programme"] as const) {
    test(`held ${optional} optional responses do not block learning on ${surface}`, async ({
      page,
      context,
      request,
      baseURL,
    }, info) => {
      if (baseURL === undefined) throw new Error("Web origin required");
      const slug = `reader-state-paid${info.project.name === "mobile-chromium" ? "-mobile" : ""}`;
      await signIn(context, baseURL, slug);
      await request.post(`${backend}/__product-reader-state?pin=${slug}`);
      await page.request.put(`${baseURL}/api/authoring/home-pin`, {
        headers: { origin: baseURL },
        data: { expectedVersion: 1, productId: null },
      });
      await request.delete(`${backend}/__product-reader-state`);
      await request.post(
        `${backend}/__reader-optional-hold?held=true&target=${optional}`,
      );
      let documentResponse;
      try {
        documentResponse = await page.goto(
          surface === "Home"
            ? "/"
            : `/products/${slug}${surface === "Programme" ? "/programme" : ""}`,
          { waitUntil: "commit" },
        );
        if (surface === "Product") {
          await expect(
            page
              .locator(".aie-learning-film")
              .getByRole("link", { name: "Продолжить обучение" }),
          ).toBeVisible();
          await expect(page.locator(".aie-status")).toBeHidden();
        } else if (surface === "Home") {
          // На телефоне кнопка карточки курса скрыта (решение владельца 23.11.2026).
          await expect(
            page
              .getByRole("link", {
                name: "Продолжить обучение",
                includeHidden: info.project.name === "mobile-chromium",
              })
              .first(),
          ).toHaveAttribute("href", `/products/${slug}/programme`);
        } else {
          // The continue action leads the window of the chapter the next lesson belongs to.
          await expect(
            (await openProgrammeChapter(page, "current")).getByRole("link", {
              name: /^Продолжить: /u,
            }),
          ).toBeVisible();
        }
        const gate = z
          .object({
            held: z.boolean(),
            aborted: z.number(),
            blocked: z.array(z.string()),
          })
          .parse(
            await (
              await request.get(`${backend}/__reader-optional-hold`)
            ).json(),
          );
        expect(gate.held).toBe(true);
        expect(gate.aborted).toBe(0);
        expect(
          gate.blocked.some((path) =>
            optional === "all"
              ? path.startsWith("/billing/product-prices")
              : path.includes("community-entry"),
          ),
        ).toBe(true);
        const reads = journal.parse(
          await (await request.get(`${backend}/__product-reader-state`)).json(),
        ).reads;
        expect(
          reads.filter((row) => row.path.endsWith("/access")),
        ).toHaveLength(1);
        expect(
          reads.filter((row) =>
            row.path.startsWith("/reading-activity/product-continuation/"),
          ),
        ).toHaveLength(1);
        expect(
          reads.some((row) => row.path.startsWith("/billing/product-prices")),
        ).toBe(true);
        await saveEvidence(
          info,
          `${surface}-${optional}-held-optional-http.json`,
          JSON.stringify({ gate, reads }, null, 2),
        );
      } finally {
        await request.post(`${backend}/__reader-optional-hold?held=false`);
        await documentResponse?.finished();
        await request.post(`${backend}/__product-reader-state?pin=`);
        await page.request.put(`${baseURL}/api/authoring/home-pin`, {
          headers: { origin: baseURL },
          data: { expectedVersion: 1, productId: null },
        });
      }
    });
  }
}

test("both waitlist slots retry the committed join without starting a second intent", async ({
  page,
  context,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("Web origin required");
  const slug = `reader-state-waitlist${info.project.name === "mobile-chromium" ? "-mobile" : ""}`;
  await signIn(context, baseURL, slug);
  await page.goto(`/products/${slug}`);
  const actions = page.getByRole("button", {
    name: "Вступить в список ожидания",
  });
  const alerts = page.getByText(
    "Не удалось проверить или сохранить запись. Попробуйте снова.",
    { exact: true },
  );
  const writes: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      request.method() === "POST" &&
      path.startsWith("/api/product-waitlist/")
    )
      writes.push(path);
  });
  await expect(actions).toHaveCount(2);
  await actions.first().click();
  await expect(alerts).toHaveCount(2);
  const intent = "/api/product-waitlist/intent";
  const join = "/api/product-waitlist/join";
  expect(writes).toEqual([intent, join]);
  const response = page.waitForResponse(
    (response) => new URL(response.url()).pathname === join,
  );
  await actions.last().click();
  expect(await (await response).json()).toMatchObject({ kind: "unavailable" });
  await expect(alerts).toHaveCount(2);
  expect(writes).toEqual([intent, join, join]);
});

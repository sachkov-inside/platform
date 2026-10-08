import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  expect,
  request as apiRequest,
  test as base,
  type BrowserContext,
  type Page,
  type Request,
} from "@playwright/test";

import { evidenceDirectory } from "../../../../scripts/evidence-path.mjs";
import { z } from "zod";

/** Оболочка нужного маршрута получена целиком; другие запросы страницы не задают барьер. */
const test = base.extend<{
  shellPrefetched: (shell: RegExp) => Promise<void>;
}>({
  shellPrefetched: async ({ page }, provide, testInfo) => {
    await installProbe(page);
    await provide(async (shell) => {
      await expect
        .poll(
          () =>
            page.evaluate((): unknown => {
              const probe: unknown = Reflect.get(window, "__navigationProbe");
              return typeof probe === "object" && probe !== null
                ? Reflect.get(probe, "prefetchedShells")
                : "проба не установлена";
            }),
          {
            message: `Получен целиком ответ общей оболочки ${String(shell)}`,
            timeout: testInfo.timeout,
          },
        )
        .toEqual(expect.arrayContaining([expect.stringMatching(shell)]));
    });
  },
});

/** Порт подставного backend выбирает `playwright.navigation.config.ts`; спека его только читает. */
function fakeBackendPort() {
  const port = process.env["FAKE_BACKEND_PORT"];
  if (port === undefined || port === "") {
    throw new Error(
      "FAKE_BACKEND_PORT is required: run the spec through its configuration",
    );
  }
  return port;
}

const backend = `http://127.0.0.1:${fakeBackendPort()}`;
const programme = "/products/navigation-proof/programme";
const product = "/products/navigation-proof";
const freeLesson = "navigation-lesson-1";
// RuntimeShell не зависит от slug: Next.js переиспользует её между адресами одного маршрута.
const materialShell = /^\/materials\/[^/]+$/u;
const productShell = /^\/products\/[^/]+$/u;
const programmeShell = /^\/products\/[^/]+\/programme$/u;
const paidLesson = "navigation-lesson-3";
/** Этим текстом подставной backend помечает тело платного урока, отданное по токену. */
const protectedBodyMarker = "ЗАКРЫТОЕ-ТЕЛО-УРОКА";

/**
 * Сессия вошедшего читателя. Web берёт действующий токен прямо из cookie и к провайдеру входа не
 * обращается, а подставной backend открывает платные уроки любому, кто предъявил токен.
 */
async function memberSessionCookie(baseURL: string) {
  // Пакет поставляется только как ES-модуль, а набор собирается в CommonJS.
  const { wrapSession } = await import("@logto/node");
  const session = await wrapSession(
    {
      accessToken: JSON.stringify({
        [`@${backend}`]: {
          // deterministic-test-allow wall-clock: Legacy clock read; fixed domain or monotonic clock migration is tracked in #1177.
          expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
          scope: "",
          token: "navigation-member-token",
        },
      }),
      idToken: "navigation.id.token",
      refreshToken: "navigation-refresh-token",
    },
    "inside-navigation-logto-cookie-secret-key",
  );
  return {
    httpOnly: true,
    name: "logto_inside-web-navigation",
    sameSite: "Lax" as const,
    url: baseURL,
    value: session,
  };
}

async function signInAsMember(context: BrowserContext, baseURL: string) {
  await context.addCookies([await memberSessionCookie(baseURL)]);
}

/**
 * Общий кеш сервера один на весь набор и живёт пять минут: без сброса исход проверки зависел бы от
 * того, что открывали до неё — в другом проекте или в прошлой попытке. Сбрасывает его то же, что и
 * в жизни: авторская запись через BFF, здесь — закреп Главной (ADR 0027). Запись идёт отдельным
 * клиентом, поэтому браузер проверки остаётся гостем.
 */
async function expireServerCatalogCache(baseURL: string) {
  const { url, ...cookie } = await memberSessionCookie(baseURL);
  const { hostname } = new URL(url);
  const author = await apiRequest.newContext({
    baseURL,
    extraHTTPHeaders: { origin: baseURL },
    storageState: {
      cookies: [
        { ...cookie, domain: hostname, expires: -1, path: "/", secure: false },
      ],
      origins: [],
    },
  });
  const response = await author.put("/api/authoring/home-pin", {
    multipart: { expectedVersion: "1", seriesId: "" },
  });
  expect(response.status(), "авторская запись закрепа принята").toBe(200);
  expect(await response.json()).toEqual({
    kind: "ready",
    pin: { seriesId: null, version: 2 },
  });
  await author.dispose();
}

interface TransitionMetrics {
  /** Какие скелеты побывали на экране между нажатием и готовой страницей. */
  readonly skeletons: readonly string[];
  /** Запросы RSC, которые страница сделала ради перехода; предзагрузка сюда не входит. */
  readonly navigationRequests: number;
  readonly millisecondsToReady: number;
  /** От нажатия до отрисованного нового адреса по отметкам `inside:navigation` самой страницы. */
  readonly routerTransitionMilliseconds: number | null;
  /**
   * Самое высокое положение подвала, пока страница загружалась, в долях высоты окна. Скелет из
   * одной плашки поднимал подвал к верху экрана; у скелета в рамке страницы он остаётся внизу.
   */
  readonly highestFooterWhileLoading: number | null;
}

async function controlBackend(control: {
  readonly delayMs?: number;
  readonly unavailable?: boolean;
}) {
  await fetch(`${backend}/__control`, {
    body: JSON.stringify(control),
    method: "POST",
  });
}
const setBackendDelay = (delayMs: number) => controlBackend({ delayMs });

async function backendRequests(): Promise<
  readonly { readonly authorized: boolean; readonly path: string }[]
> {
  const response = await fetch(`${backend}/__requests`);
  return z
    .object({
      requests: z.array(
        z.object({ authorized: z.boolean(), path: z.string() }),
      ),
    })
    .parse(await response.json()).requests;
}

/**
 * Записывает всё занятое (`aria-busy`) и все скелеты маршрутов, которые появлялись в документе, и
 * считает запросы RSC в момент вызова `fetch`: счёт в самой странице не зависит от того, когда
 * событие запроса дойдёт до проверки.
 */
async function installProbe(page: Page) {
  await page.addInitScript(() => {
    const probe = {
      highestFooterWhileLoading: null as number | null,
      /** Запросы RSC ради перехода; предзагрузка сюда не входит. */
      navigationRequests: 0,
      /** Запросы RSC, ответ на которые ещё не дочитан до конца. */
      pendingRequests: 0,
      /** Завершённые успешные ответы RuntimeShell; дерево /_tree сюда не входит. */
      prefetchedShells: [] as string[],
      skeletons: [] as string[],
    };
    Object.assign(window, { __navigationProbe: probe });
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const headers = new Headers(
        init?.headers ??
          (input instanceof globalThis.Request ? input.headers : undefined),
      );
      if (headers.get("rsc") !== "1") return nativeFetch(input, init);
      if (!headers.has("next-router-prefetch")) probe.navigationRequests += 1;
      probe.pendingRequests += 1;
      const response = nativeFetch(input, init);
      // Копию ответа дочитываем сами: роутер может бросить поток, взяв из него нужное, а сервер
      // закончил работу над запросом, только когда отдал ответ целиком или запрос оборван.
      void response
        .then(async (answer) => {
          await answer.clone().arrayBuffer();
          if (headers.get("next-router-prefetch") === "3" && answer.ok)
            probe.prefetchedShells.push(new URL(answer.url).pathname);
        })
        .catch(() => undefined)
        .finally(() => {
          probe.pendingRequests -= 1;
        });
      return response;
    };
    const describe = (element: Element) =>
      element.getAttribute("data-route-skeleton") ??
      element.getAttribute("data-discovery-state") ??
      element.getAttribute("data-material-reader-state") ??
      element.getAttribute("aria-label") ??
      element.tagName.toLowerCase();
    const scan = () => {
      const busy = document.querySelectorAll(
        "main [aria-busy='true'], main [data-route-skeleton]",
      );
      for (const element of busy) {
        const name = describe(element);
        if (!probe.skeletons.includes(name)) probe.skeletons.push(name);
      }
      if (busy.length > 0) {
        // Подвал площадки, а не подвал урока с соседями по продукту.
        const footer =
          document
            .querySelector("main nav[aria-label='Документы Inside']")
            ?.closest("footer") ?? null;
        if (footer !== null) {
          const position =
            footer.getBoundingClientRect().top / window.innerHeight;
          probe.highestFooterWhileLoading = Math.min(
            probe.highestFooterWhileLoading ?? position,
            position,
          );
        }
      }
    };
    const start = () => {
      new MutationObserver(scan).observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
      });
      scan();
    };
    // An init script can run before the document element exists, which the lib type omits.
    if ((document.documentElement as HTMLElement | null) === null)
      document.addEventListener("DOMContentLoaded", start);
    else start();
  });
}

async function resetProbe(page: Page) {
  await page.evaluate(() => {
    const probe: unknown = Reflect.get(window, "__navigationProbe");
    if (typeof probe !== "object" || probe === null) return;
    // Проба читает поля при каждой записи, поэтому новые значения сразу становятся её состоянием.
    Reflect.set(probe, "skeletons", []);
    Reflect.set(probe, "highestFooterWhileLoading", null);
    Reflect.set(probe, "navigationRequests", 0);
  });
}

/**
 * На все запросы RSC, начатые страницей, ответ получен целиком. Сервер к этому моменту закончил их
 * рисовать, поэтому каждое чтение backend ради них уже есть в журнале подставного backend.
 */
async function rscRequestsSettled(page: Page) {
  await expect
    .poll(() =>
      page.evaluate((): unknown => {
        const probe: unknown = Reflect.get(window, "__navigationProbe");
        return typeof probe === "object" && probe !== null
          ? Reflect.get(probe, "pendingRequests")
          : "проба не установлена";
      }),
    )
    .toBe(0);
}

/**
 * Страница устоялась: её личная часть пришла, занятых мест не осталось. Переход, начатый раньше,
 * ждёт эту часть вместе с задержкой React до 300 мс (ADR 0027), и замер показал бы её, а не переход.
 */
async function personalPartLanded(page: Page) {
  await expect(
    page.locator(
      "#content [data-series-access-pending]:visible, #content [data-material-reader-state='pending']:visible, main [aria-busy='true']:visible",
    ),
  ).toHaveCount(0);
}

/** Замер одного перехода от устоявшейся страницы до готовой следующей. */
async function transition(
  page: Page,
  act: () => Promise<void>,
  ready: () => Promise<void>,
): Promise<TransitionMetrics> {
  await personalPartLanded(page);
  await resetProbe(page);
  // deterministic-test-allow wall-clock: Legacy clock read; fixed domain or monotonic clock migration is tracked in #1177.
  const startedAt = Date.now();
  await act();
  await ready();
  // deterministic-test-allow wall-clock: Legacy clock read; fixed domain or monotonic clock migration is tracked in #1177.
  const millisecondsToReady = Date.now() - startedAt;
  // Окно замера закрывает не пауза, а устоявшаяся страница с полученными ответами. Запросы,
  // без которых переход не завершить, роутер шлёт синхронно в самом переходе, до отрисовки новой
  // страницы (`spawnDynamicRequests` в Next.js), поэтому к готовой странице они уже посчитаны.
  await personalPartLanded(page);
  await rscRequestsSettled(page);
  const probe = z
    .object({
      highestFooterWhileLoading: z.number().nullable(),
      navigationRequests: z.number(),
      skeletons: z.array(z.string()),
    })
    .parse(
      await page.evaluate((): unknown =>
        Reflect.get(window, "__navigationProbe"),
      ),
    );
  const routerTransitionMilliseconds = await page.evaluate(() => {
    const measure = performance
      .getEntriesByName("inside:navigation", "measure")
      .at(-1);
    performance.clearMeasures("inside:navigation");
    return measure === undefined ? null : Math.round(measure.duration);
  });
  return {
    highestFooterWhileLoading: probe.highestFooterWhileLoading,
    millisecondsToReady,
    navigationRequests: probe.navigationRequests,
    routerTransitionMilliseconds,
    skeletons: [...probe.skeletons],
  };
}

// Пока поток ещё идёт, React держит пришедшую часть в скрытом контейнере вне `#content`, а прежний
// урок Next.js оставляет в документе скрытым, поэтому готовность ищется среди видимого в основной области.
/**
 * Core Web Vitals, которые страница сама отметила в User Timing. CLS и INP библиотека сообщает, когда
 * вкладка уходит в фон, поэтому проверка объявляет её скрытой.
 */
async function readWebVitals(page: Page): Promise<Record<string, number>> {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // Факт, которого ждёт проверка, — сама отметка CLS, а не истёкшая пауза.
  await page.waitForFunction(
    () =>
      performance.getEntriesByName("inside:web-vital:CLS", "mark").length > 0,
  );
  return page.evaluate(() => {
    const vitals: Record<string, number> = {};
    for (const mark of performance.getEntriesByType("mark")) {
      if (!mark.name.startsWith("inside:web-vital:")) continue;
      if (!(mark instanceof PerformanceMark)) continue;
      const detail: unknown = mark.detail;
      if (
        typeof detail !== "object" ||
        detail === null ||
        !("value" in detail) ||
        typeof detail.value !== "number"
      ) {
        continue;
      }
      vitals[mark.name.slice("inside:web-vital:".length)] =
        Math.round(detail.value * 1_000) / 1_000;
    }
    return vitals;
  });
}

/**
 * Предзагрузка страницы урока целиком — та, что рисует урок на сервере, а не оболочка маршрута.
 * Браузер закончил с ней, когда запрос завершён или оборван: клиент Next.js обрывает поток, взяв
 * из него всё нужное, поэтому ждать приходится события запроса, а не конца ответа.
 */
function pagePrefetchSettled(page: Page, slug: string): Promise<Request> {
  return new Promise((resolve) => {
    const settle = (request: Request) => {
      const headers = request.headers();
      if (
        !request.url().includes(`/materials/${slug}`) ||
        headers["next-router-prefetch"] === undefined ||
        headers["next-router-segment-prefetch"] !== undefined
      )
        return;
      page.off("requestfinished", settle);
      page.off("requestfailed", settle);
      resolve(request);
    };
    page.on("requestfinished", settle);
    page.on("requestfailed", settle);
  });
}

/** Тот же запрос предзагрузки, повторённый из проверки: его тело читается целиком, в отличие от оборванного. */
async function replayPrefetch(page: Page, request: Request): Promise<string> {
  const sent = request.headers();
  const routerHeaders = [
    "rsc",
    "next-router-prefetch",
    "next-router-segment-prefetch",
    "next-router-state-tree",
    "next-url",
  ];
  const response = await page.context().request.get(request.url(), {
    headers: Object.fromEntries(
      routerHeaders.flatMap((name) =>
        sent[name] === undefined ? [] : [[name, sent[name]]],
      ),
    ),
  });
  expect(response.status(), "предзагрузка повторена успешно").toBe(200);
  return response.text();
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Положение опор страницы: по ним видно, сдвинул ли следующий слой предыдущий. */
async function boxesOf(
  page: Page,
  selectors: readonly string[],
): Promise<readonly Box[]> {
  return page.evaluate(
    (list) =>
      list.map((selector) => {
        const element = document.querySelector(`#content ${selector}`);
        if (element === null) throw new Error(`Нет опоры ${selector}`);
        const { left, top, width, height } = element.getBoundingClientRect();
        return { height, left, top, width };
      }),
    selectors,
  );
}

const lessonReady = (page: Page, slug: string) => async () => {
  await page.waitForURL((url) => url.pathname === `/materials/${slug}`);
  await expect(
    page.locator(
      "#content [data-material-reader-state='available']:visible, #content [data-material-reader-state='access-required']:visible",
    ),
  ).toBeVisible();
};
// Посещённую страницу Next.js держит в документе скрытой, поэтому готовность ищется среди видимого.
const programmeReady =
  (page: Page, path = programme) =>
  async () => {
    await page.waitForURL((url) => url.pathname === path);
    await expect(
      page
        .locator(
          "#content [data-product-programme]:visible a[href*='/materials/']",
        )
        .first(),
    ).toBeVisible();
  };

/**
 * Замеры и снимки — свидетельства задачи #670. Обычный прогон кладёт их в артефакты;
 * `UPDATE_EVIDENCE=issue-670` — в `docs/evidence/issue-670`. Стадия «до» — тот же набор на коде без
 * изменений: каталог `test/navigation` и `playwright.navigation.config.ts` копируются во временный
 * worktree на `main`, где набор запускается с `NAVIGATION_EVIDENCE_STAGE=before`; его утверждения
 * там падают, а замеры, записанные до них, остаются.
 */
function evidenceFile(fileName: string): string {
  const path = join(
    evidenceDirectory("issue-670"),
    process.env["NAVIGATION_EVIDENCE_STAGE"] ?? "after",
    fileName,
  );
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

function record(
  name: string,
  project: string,
  metrics: Record<string, unknown>,
) {
  writeFileSync(
    evidenceFile(`${name}-${project}.json`),
    `${JSON.stringify(metrics, null, 2)}\n`,
  );
}

test.beforeEach(async ({ baseURL }) => {
  if (baseURL === undefined) throw new Error("Проверке нужен адрес приложения");
  await controlBackend({ delayMs: 0, unavailable: false });
  await expireServerCatalogCache(baseURL);
});
test.afterEach(async () => {
  await controlBackend({ delayMs: 0, unavailable: false });
});

test("оболочка урока предзагружена даже при незавершённом постороннем запросе", async ({
  page,
  shellPrefetched,
}) => {
  const heldResponse = Promise.withResolvers<undefined>();
  await page.route("**/__unrelated_navigation_request", async (route) => {
    await heldResponse.promise;
    await route.fulfill({ body: "done" });
  });
  try {
    await page.goto(programme);
    await programmeReady(page)();
    const unrelated = page.waitForRequest("**/__unrelated_navigation_request");
    await page.evaluate(() => {
      void fetch("/__unrelated_navigation_request").catch(() => undefined);
    });
    await unrelated;
    await shellPrefetched(materialShell);
  } finally {
    heldResponse.resolve(undefined);
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("оболочка другого урока завершает барьер, пока предзагрузка первого ещё заблокирована", async ({
  page,
  shellPrefetched,
}) => {
  const heldResponse = Promise.withResolvers<undefined>();
  const firstRequested = Promise.withResolvers<undefined>();
  await page.route("**/materials/navigation-lesson-1?*", async (route) => {
    if (route.request().headers()["next-router-prefetch"] !== undefined) {
      firstRequested.resolve(undefined);
      await heldResponse.promise;
    }
    await route.continue();
  });
  try {
    await page.goto(programme);
    await programmeReady(page)();
    await firstRequested.promise;
    await shellPrefetched(materialShell);
  } finally {
    heldResponse.resolve(undefined);
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("программа ↔ урок: свой скелет на первом переходе и мгновенный повтор", async ({
  page,
  shellPrefetched,
}, testInfo) => {
  await page.goto(programme);
  await programmeReady(page)();
  await shellPrefetched(materialShell);
  await setBackendDelay(700);

  const lessonLink = page
    .locator(`[data-product-programme] a[href*='/materials/${freeLesson}']`)
    .first();
  const toLesson = await transition(
    page,
    () => lessonLink.click(),
    lessonReady(page, freeLesson),
  );
  const backToProgramme = await transition(
    page,
    () => page.getByRole("link", { name: "Назад к программе" }).first().click(),
    programmeReady(page),
  );
  const repeatLesson = await transition(
    page,
    () =>
      page
        .locator(`[data-product-programme] a[href*='/materials/${freeLesson}']`)
        .first()
        .click(),
    lessonReady(page, freeLesson),
  );
  const repeatProgramme = await transition(
    page,
    () => page.getByRole("link", { name: "Назад к программе" }).first().click(),
    programmeReady(page),
  );
  const historyBack = await transition(
    page,
    () => page.goBack().then(() => undefined),
    lessonReady(page, freeLesson),
  );
  const historyForward = await transition(
    page,
    () => page.goForward().then(() => undefined),
    programmeReady(page),
  );

  const metrics = {
    backToProgramme,
    historyBack,
    historyForward,
    repeatLesson,
    repeatProgramme,
    toLesson,
  };
  record("programme-lesson", testInfo.project.name, metrics);
  const webVitals = await readWebVitals(page);
  record("web-vitals", testInfo.project.name, webVitals);
  // Порог «хорошо» у CLS — 0,1; цикл переходов не должен набрать и его.
  expect(webVitals["CLS"], "переходы не сдвигают раскладку").toBeLessThan(0.1);

  const foreign = (seen: readonly string[], own: string) =>
    seen.filter((name) => name !== own);
  // Общая часть урока ещё не в кеше, а backend отвечает 700 мс: скелет обязан показаться, и именно свой.
  expect(
    toLesson.skeletons,
    "первый переход в урок показывает скелет урока",
  ).toContain("material-reader");
  expect(
    foreign(toLesson.skeletons, "material-reader"),
    "и никакого другого",
  ).toEqual([]);
  // Без этого нули ниже ничего не доказывали бы: проба обязана видеть запросы роутера.
  expect(
    toLesson.navigationRequests,
    "первый переход в урок запрашивает RSC",
  ).toBeGreaterThan(0);
  expect(
    toLesson.highestFooterWhileLoading ?? 1,
    "подвал не поднимается под скелет урока",
  ).toBeGreaterThan(0.6);
  expect(
    foreign(backToProgramme.skeletons, "product-programme"),
    "возврат в программу не показывает чужой скелет",
  ).toEqual([]);
  expect(
    repeatLesson.skeletons,
    "повторный переход в урок идёт без скелета",
  ).toEqual([]);
  expect(
    repeatLesson.navigationRequests,
    "повторный переход в урок не запрашивает RSC",
  ).toBe(0);
  expect(
    repeatProgramme.skeletons,
    "повторный возврат в программу идёт без скелета",
  ).toEqual([]);
  expect(
    repeatProgramme.navigationRequests,
    "повторный возврат в программу не запрашивает RSC",
  ).toBe(0);
  expect(historyBack.skeletons).toEqual([]);
  expect(historyBack.navigationRequests, "«назад» не делает запросов").toBe(0);
  expect(historyForward.skeletons).toEqual([]);
  expect(historyForward.navigationRequests, "«вперёд» не делает запросов").toBe(
    0,
  );
});

test("продукт → программа → платный урок: у каждой страницы свой скелет", async ({
  page,
  shellPrefetched,
}, testInfo) => {
  await page.goto(product);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shellPrefetched(programmeShell);
  await setBackendDelay(700);

  const toProgramme = await transition(
    page,
    () => page.locator(`a[href='${programme}']`).first().click(),
    programmeReady(page),
  );
  const toPaidLesson = await transition(
    page,
    () =>
      page
        .locator(`[data-product-programme] a[href*='/materials/${paidLesson}']`)
        .first()
        .click(),
    lessonReady(page, paidLesson),
  );
  record("product-programme-paid-lesson", testInfo.project.name, {
    toPaidLesson,
    toProgramme,
  });

  expect(
    toProgramme.skeletons.filter((name) => name !== "product-programme"),
  ).toEqual([]);
  // Личная часть закрытого урока ждёт backend: на месте тела стоит его собственный скелет.
  expect(toPaidLesson.skeletons).toContain("material-reader");
  expect(
    toPaidLesson.skeletons.filter((name) => name !== "material-reader"),
  ).toEqual([]);
  await expect(
    page.locator(
      "#content [data-material-reader-state='access-required']:visible",
    ),
  ).toBeVisible();
});

test("намерение предзагружает общую часть урока: переход без скелета даже при медленном backend", async ({
  page,
  shellPrefetched,
}, testInfo) => {
  await page.goto(programme);
  await programmeReady(page)();
  await shellPrefetched(materialShell);

  const lessonLink = page
    .locator(
      `[data-product-programme] a[href*='/materials/navigation-lesson-2']`,
    )
    .first();
  const prefetched = pagePrefetchSettled(page, "navigation-lesson-2");
  if (testInfo.project.name.startsWith("mobile"))
    await lessonLink.dispatchEvent("touchstart");
  else await lessonLink.hover();
  // Заголовки предзагрузки приходят раньше её тела. Замедлять backend можно, только когда браузер
  // с ней закончил: иначе задержка достаётся самой предзагрузке, и нажатие её обгоняет.
  const prefetchResponse = await (await prefetched).response();
  // Окно страницы ограничивает и общую часть: браузер держит предзагруженное 60 секунд, а не
  // пять минут серверного профиля (ADR 0027).
  expect(
    prefetchResponse?.headers()["x-nextjs-stale-time"],
    "предзагруженное живёт окно страницы",
  ).toBe("60");
  await setBackendDelay(700);

  const toLesson = await transition(
    page,
    () => lessonLink.click(),
    lessonReady(page, "navigation-lesson-2"),
  );
  record("intent-prefetch", testInfo.project.name, { toLesson });

  // Backend отвечает 700 мс; урок без скелета значит, что общая часть пришла до нажатия.
  expect(toLesson.skeletons, "общая часть урока пришла до нажатия").toEqual([]);
});

test("повторный переход не ходит в backend, а гость нигде не предъявляет токен", async ({
  page,
  shellPrefetched,
}) => {
  await fetch(`${backend}/__requests`, { method: "DELETE" });
  await page.goto(programme);
  await programmeReady(page)();
  await shellPrefetched(materialShell);
  const lessonLink = () =>
    page
      .locator(`[data-product-programme] a[href*='/materials/${freeLesson}']`)
      .first();
  await lessonLink().click();
  await lessonReady(page, freeLesson)();
  await page.getByRole("link", { name: "Назад к программе" }).first().click();
  await programmeReady(page)();
  // Журнал backend очищается, когда первый круг закончен целиком: личная часть программы пришла.
  await personalPartLanded(page);
  // Закрытый урок гостю не кешируется целиком: его личная часть читает backend при любом кеше,
  // поэтому чтения без токена в этом круге есть всегда.
  await page
    .locator(`[data-product-programme] a[href*='/materials/${paidLesson}']`)
    .first()
    .click();
  await lessonReady(page, paidLesson)();
  await page.getByRole("link", { name: "Назад к программе" }).first().click();
  await programmeReady(page)();
  await personalPartLanded(page);

  const firstRound = await backendRequests();
  expect(
    firstRound.length,
    "первый круг действительно читал backend",
  ).toBeGreaterThan(0);
  expect(
    firstRound.filter((request) => request.authorized),
    "гость не предъявляет токен",
  ).toEqual([]);

  await fetch(`${backend}/__requests`, { method: "DELETE" });
  await lessonLink().click();
  await lessonReady(page, freeLesson)();
  await page.getByRole("link", { name: "Назад к программе" }).first().click();
  await programmeReady(page)();
  await personalPartLanded(page);
  await rscRequestsSettled(page);

  const requests = await backendRequests();
  // Личные чтения браузера (прогресс, закладки) гостю выключены, а страницы взяты из памяти.
  expect(requests.map((request) => request.path)).toEqual([]);
});

test("авторская запись сбрасывает общий кеш: следующий гость читает backend заново", async ({
  baseURL,
  browser,
}) => {
  if (baseURL === undefined) throw new Error("Проверке нужен адрес приложения");
  const guestReads = async () =>
    (await backendRequests()).filter((request) =>
      request.path.startsWith("/library/products/navigation-proof"),
    ).length;
  const openProductAsNewGuest = async () => {
    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    await guestPage.goto(`${baseURL}${product}`);
    await expect(
      guestPage.locator("#content [data-product-landing]"),
    ).toBeVisible();
    await guest.close();
  };

  await openProductAsNewGuest();
  await fetch(`${backend}/__requests`, { method: "DELETE" });
  await openProductAsNewGuest();
  // Без записи второй гость получает продукт из общего кеша: на этом стоит и сам набор, который
  // сбрасывает кеш перед каждой проверкой, — без этой пары утверждений сброс ничем бы не проверялся.
  expect(await guestReads(), "второй гость читает продукт из общего кеша").toBe(
    0,
  );

  await expireServerCatalogCache(baseURL);
  await openProductAsNewGuest();
  expect(
    await guestReads(),
    "после авторской записи продукт читается заново",
  ).toBeGreaterThan(0);
});

test("сбой каталога не застывает в кеше: повтор после восстановления открывает урок", async ({
  page,
}) => {
  // Кеш сброшен перед проверкой, поэтому сбой достаётся и общей части урока, а не только личной.
  await controlBackend({ unavailable: true });
  await page.goto(
    `/materials/navigation-lesson-4?from=${encodeURIComponent(programme)}`,
  );
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Материал временно недоступен",
    }),
  ).toBeVisible();

  await controlBackend({ unavailable: false });
  // Запись о сбое истекает сама, без сброса: повтор нажимается, пока урок не откроется.
  await expect(async () => {
    await page
      .getByRole("button", { name: "Повторить" })
      .click({ timeout: 1_000 });
    await expect(
      page.locator(
        "#content [data-material-reader-state='access-required']:visible",
      ),
    ).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
});

test("закрытое тело не попадает ни в предзагрузку, ни в общий кеш, а выход сразу закрывает урок", async ({
  baseURL,
  browser,
  context,
  page,
  shellPrefetched,
}) => {
  if (baseURL === undefined) throw new Error("Проверке нужен адрес приложения");
  await signInAsMember(context, baseURL);
  // Оборванный клиентом ответ предзагрузки прочитать нельзя, поэтому запросы запоминаются и после
  // повторяются из проверки с той же сессией: так тело каждого читается целиком.
  const paidLessonPrefetches: Request[] = [];
  page.on("request", (request) => {
    if (
      request.headers()["next-router-prefetch"] !== undefined &&
      request.url().includes(`/materials/${paidLesson}`)
    )
      paidLessonPrefetches.push(request);
  });

  await page.goto(programme);
  await programmeReady(page)();
  const lessonLink = page
    .locator(`[data-product-programme] a[href*='/materials/${paidLesson}']`)
    .first();
  // Вошедшему платный урок открыт: личная часть программы пришла с его доступностью.
  await expect(
    page.locator(
      `#content [data-material-slug='${paidLesson}'][data-material-availability='available']:visible`,
    ),
  ).toBeVisible();
  // Предзагрузка страницы целиком рисует урок на сервере с сессией вошедшего: именно она могла бы
  // унести закрытое тело. Нажатие ждёт, пока браузер с ней закончит. Слушатель ставится, когда
  // ответ оболочки урока уже пришёл: запрос дерева /_tree — не предзагрузка страницы целиком.
  await shellPrefetched(materialShell);
  const pagePrefetch = pagePrefetchSettled(page, paidLesson);
  await lessonLink.hover();
  const pagePrefetchBody = await replayPrefetch(page, await pagePrefetch);
  // Тело настоящее: в нём общая часть урока. Пустой или чужой ответ проверку бы обманул.
  expect(pagePrefetchBody, "предзагрузка несёт общую часть урока").toContain(
    "Первый платный урок",
  );
  expect(
    pagePrefetchBody,
    "предзагрузка страницы не несёт закрытого тела",
  ).not.toContain(protectedBodyMarker);

  await lessonLink.click();
  await page.waitForURL((url) => url.pathname === `/materials/${paidLesson}`);
  await expect(page.getByText(protectedBodyMarker).first()).toBeVisible();
  const prefetchBodies = await Promise.all(
    paidLessonPrefetches.map((request) => replayPrefetch(page, request)),
  );
  expect(
    prefetchBodies.length,
    "платный урок действительно предзагружался",
  ).toBeGreaterThan(0);
  expect(
    prefetchBodies.filter((body) => body.includes(protectedBodyMarker)),
    "ни одна предзагрузка не несёт закрытого тела",
  ).toEqual([]);

  // Гость в другом браузере открывает тот же урок после вошедшего: общий кеш знает только тизер.
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  const guestResponse = await guestPage.goto(
    `${baseURL}/materials/${paidLesson}?from=${encodeURIComponent(programme)}`,
  );
  await expect(
    guestPage.locator(
      "#content [data-material-reader-state='access-required']:visible",
    ),
  ).toBeVisible();
  expect(await guestResponse?.text()).not.toContain(protectedBodyMarker);
  await guest.close();

  // Выход — полная загрузка документа без cookie сессии: урок закрыт сразу, без окна кеша.
  await context.clearCookies();
  await page.reload();
  await expect(
    page.locator(
      "#content [data-material-reader-state='access-required']:visible",
    ),
  ).toBeVisible();
  await expect(page.getByText(protectedBodyMarker)).toHaveCount(0);
});

/** Стадия «до» снимает кадры на коде без слоёв: общей части и её опор там ещё нет. */
const beforeStage = process.env["NAVIGATION_EVIDENCE_STAGE"] === "before";

test("снимки перехода «программа → урок → программа» при медленном backend", async ({
  page,
  shellPrefetched,
}, testInfo) => {
  test.skip(
    beforeStage,
    "на коде без слоёв те же кадры снимает отдельная проверка",
  );
  const project = testInfo.project.name;
  const loading = page.locator("main [aria-busy='true']").first();
  await page.goto(programme);
  await programmeReady(page)();
  await shellPrefetched(materialShell);
  await setBackendDelay(1_500);

  const lessonAnchors = ["[data-reader-return='top']", "[data-reader-header]"];
  await page
    .locator(`[data-product-programme] a[href*='/materials/${paidLesson}']`)
    .first()
    .click();
  await expect(loading).toBeVisible();
  await expect(
    page.locator("#content [data-material-reader-state='pending']:visible"),
  ).toBeVisible();
  const lessonSharedPart = await boxesOf(page, lessonAnchors);
  await page.screenshot({
    path: evidenceFile(`programme-to-lesson-loading-${project}.png`),
  });
  await lessonReady(page, paidLesson)();
  expect(
    await boxesOf(page, lessonAnchors),
    "личная часть урока не двигает возврат и шапку",
  ).toEqual(lessonSharedPart);
  await page.screenshot({ path: evidenceFile(`lesson-ready-${project}.png`) });

  // Возврат в программу за пределами окна кеша снимается на свежей странице урока.
  await page.goto(
    `/materials/${paidLesson}?from=${encodeURIComponent(programme)}`,
  );
  await lessonReady(page, paidLesson)();
  await shellPrefetched(programmeShell);
  await page.getByRole("link", { name: "Назад к программе" }).first().click();
  await page.waitForURL((url) => url.pathname === programme);
  const programmeAnchors = [
    "[data-programme-part='back']",
    "[data-programme-part='header']",
    "[data-series-ordinal='1']",
  ];
  await expect(
    page.locator("#content [data-series-access-pending]").first(),
  ).toBeVisible();
  const programmeSharedPart = await boxesOf(page, programmeAnchors);
  await page.screenshot({
    path: evidenceFile(`lesson-to-programme-loading-${project}.png`),
  });
  await expect(
    page.locator("#content [data-series-access-pending]"),
  ).toHaveCount(0);
  expect(
    await boxesOf(page, programmeAnchors),
    "личная часть программы не двигает шапку и первый урок",
  ).toEqual(programmeSharedPart);
  await page.screenshot({
    path: evidenceFile(`programme-ready-${project}.png`),
  });
});

test("снимки «до»: те же кадры перехода на коде без слоёв", async ({
  page,
  shellPrefetched,
}, testInfo) => {
  test.skip(
    !beforeStage,
    "нужна только стадии «до»: NAVIGATION_EVIDENCE_STAGE=before",
  );
  const project = testInfo.project.name;
  const loading = page.locator("main [aria-busy='true']").first();
  await page.goto(programme);
  await programmeReady(page)();
  await shellPrefetched(materialShell);
  await setBackendDelay(1_500);

  await page
    .locator(`[data-product-programme] a[href*='/materials/${paidLesson}']`)
    .first()
    .click();
  await expect(loading).toBeVisible();
  await page.screenshot({
    path: evidenceFile(`programme-to-lesson-loading-${project}.png`),
  });
  await lessonReady(page, paidLesson)();
  await page.screenshot({ path: evidenceFile(`lesson-ready-${project}.png`) });

  await page.goto(
    `/materials/${paidLesson}?from=${encodeURIComponent(programme)}`,
  );
  await lessonReady(page, paidLesson)();
  await shellPrefetched(programmeShell);
  await page.getByRole("link", { name: "Назад к программе" }).first().click();
  await page.waitForURL((url) => url.pathname === programme);
  await expect(loading).toBeVisible();
  await page.screenshot({
    path: evidenceFile(`lesson-to-programme-loading-${project}.png`),
  });
  await programmeReady(page)();
  await page.screenshot({
    path: evidenceFile(`programme-ready-${project}.png`),
  });
});

test("Главная ↔ продукт: свой скелет продукта, Главная без скелета, повтор без запросов", async ({
  page,
  shellPrefetched,
}, testInfo) => {
  await page.goto("/");
  const productLink = page
    .getByRole("link", { name: /Открыть (продукт|практикум)/u })
    .first();
  await expect(productLink).toBeVisible();
  await shellPrefetched(productShell);
  await setBackendDelay(700);

  const productReady = async () => {
    await page.waitForURL((url) => url.pathname === product);
    await expect(page.locator("#content [data-product-landing]")).toBeVisible();
  };
  const homeReady = async () => {
    await page.waitForURL((url) => url.pathname === "/");
    await expect(
      page.getByRole("link", { name: /Открыть (продукт|практикум)/u }).first(),
    ).toBeVisible();
  };
  const toProduct = await transition(
    page,
    () => productLink.click(),
    productReady,
  );
  const backHome = await transition(
    page,
    () => page.getByRole("link", { name: "Назад на Главную" }).first().click(),
    homeReady,
  );
  const repeatProduct = await transition(
    page,
    () =>
      page
        .getByRole("link", { name: /Открыть (продукт|практикум)/u })
        .first()
        .click(),
    productReady,
  );
  const repeatHome = await transition(
    page,
    () => page.getByRole("link", { name: "Назад на Главную" }).first().click(),
    homeReady,
  );
  record("home-product", testInfo.project.name, {
    backHome,
    repeatHome,
    repeatProduct,
    toProduct,
  });

  expect(
    toProduct.skeletons.filter((name) => name !== "product-landing"),
    "продукт показывает только свой скелет",
  ).toEqual([]);
  // Главная блокирующая: закреп читается до первого кадра, поэтому скелета всей страницы у неё нет (#562).
  expect(
    backHome.skeletons.filter(
      (name) => name !== "Материалы" && name !== "loading",
    ),
    "Главная не показывает чужой скелет",
  ).toEqual([]);
  expect(
    repeatProduct.navigationRequests,
    "повторный переход в продукт не запрашивает RSC",
  ).toBe(0);
  expect(repeatProduct.skeletons).toEqual([]);
  expect(
    repeatHome.navigationRequests,
    "повторный возврат на Главную не запрашивает RSC",
  ).toBe(0);
});

test("смена режима прохождения сбрасывает страницы, которые браузер помнит в прежнем режиме", async ({
  page,
}) => {
  const modesProgramme = "/products/navigation-modes/programme";
  // Соседний урок остаётся в документе скрытым, поэтому шаг ищется среди видимого.
  const step = (mode: "example" | "own") =>
    page
      .locator("#content")
      .getByText(`ШАГ-ДЛЯ-РЕЖИМА-${mode}`)
      .filter({ visible: true });
  await page.goto(modesProgramme);
  await programmeReady(page, modesProgramme)();
  await page
    .locator(
      "#content [data-product-programme]:visible a[href*='/materials/navigation-lesson-5']",
    )
    .first()
    .click();
  await lessonReady(page, "navigation-lesson-5")();
  // У урока продукта с режимами личная часть есть всегда: вариант шага выбирает сервер.
  await expect(step("example")).toBeVisible();

  await page.getByRole("link", { name: /Дальше/u }).click();
  await lessonReady(page, "navigation-lesson-6")();
  await page.getByRole("button", { exact: true, name: "Свой проект" }).click();
  await expect(step("own")).toBeVisible();

  // Первый урок открыт меньше минуты назад и лежит в памяти браузера в прежнем режиме.
  await page.getByRole("link", { name: "Предыдущий материал" }).click();
  await lessonReady(page, "navigation-lesson-5")();
  await expect(step("own")).toBeVisible();
  await expect(step("example")).toHaveCount(0);
});

/** Обложка продукта в видимой странице, а не её копия в скрытом контейнере потока. */
const productCover = "#content [data-product-part='hero'] img";

/**
 * Записывает каждого кандидата LCP с начала загрузки. Запись об обложке приходит после её отрисовки,
 * а не после загрузки: когда `image.complete` уже верно, последним кандидатом бывает ещё текст
 * первого экрана (#1007).
 */
async function recordLargestContentfulPaintCandidates(page: Page) {
  await page.addInitScript(() => {
    const candidates: unknown[] = [];
    Object.assign(window, { __largestContentfulPaintCandidates: candidates });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const element =
          "element" in entry && entry.element instanceof Element
            ? entry.element
            : null;
        candidates.push({
          // Подпись показывает в отказе, что было крупнейшим на первом экране.
          elementLabel:
            element === null
              ? "узел уже убран из документа"
              : `${element.tagName} ${element.textContent.trim().slice(0, 80)}`.trim(),
          heroCover:
            element?.tagName === "IMG" &&
            element.closest("[data-product-part='hero']") !== null,
          startTime: entry.startTime,
        });
      }
    }).observe({ buffered: true, type: "largest-contentful-paint" });
  });
}

const largestContentfulPaintCandidates = z.array(
  z.object({
    elementLabel: z.string(),
    heroCover: z.boolean(),
    startTime: z.number(),
  }),
);

function readLargestContentfulPaintCandidates(page: Page) {
  return page.evaluate((): unknown => {
    const candidates: unknown = Reflect.get(
      window,
      "__largestContentfulPaintCandidates",
    );
    return Array.isArray(candidates)
      ? candidates
      : "кандидаты LCP не записываются";
  });
}

test("обложка первого экрана продукта грузится сразу и даёт LCP в пределах «хорошо»", async ({
  page,
}, testInfo) => {
  await recordLargestContentfulPaintCandidates(page);
  await page.goto("/products/navigation-cover");

  // Если ответ `/auth/status` меняет context над ещё не показанной частью, React рисует её на клиенте,
  // а копия с сервера до показа лежит в скрытом контейнере вне `#content` (#740, #747).
  const cover = page.locator(productCover);
  await expect(cover).toHaveAttribute("fetchpriority", "high");
  await expect(cover).toHaveAttribute("loading", "eager");
  // Факт, которого ждёт проверка, — запись LCP об отрисованной обложке. Загруженная картинка ещё не
  // отрисована, и последним кандидатом в этот момент бывает текст первого экрана (#1007).
  await expect
    .poll(() => readLargestContentfulPaintCandidates(page), {
      message: "LCP записал отрисованную обложку",
    })
    .toContainEqual(expect.objectContaining({ heroCover: true }));

  // Оба вывода — из одного чтения. Весь ответ PerformanceObserver лежит во вложении к результату.
  const candidates = largestContentfulPaintCandidates.parse(
    await readLargestContentfulPaintCandidates(page),
  );
  await testInfo.attach("кандидаты LCP", {
    body: JSON.stringify(candidates, null, 2),
    contentType: "application/json",
  });
  const lcp = candidates.at(-1);
  expect(lcp, "крупнейший элемент первого экрана — обложка продукта").toEqual(
    expect.objectContaining({ heroCover: true }),
  );
  // Порог «хорошо» у LCP — 2,5 секунды.
  expect(lcp?.startTime).toBeLessThan(2_500);
});

/**
 * Помечает каждый элемент, который создал скрипт. Разметку, пришедшую с сервера, создаёт парсер, а
 * часть страницы, которую React не смог гидрировать и нарисовал заново, — `createElement` (#747).
 */
async function markScriptCreatedElements(page: Page) {
  await page.addInitScript(() => {
    const created = new WeakSet<Element>();
    const createElement: unknown = Reflect.get(document, "createElement");
    if (typeof createElement !== "function") return;
    Object.defineProperty(document, "createElement", {
      value: (...args: unknown[]) => {
        const element: unknown = Reflect.apply(createElement, document, args);
        if (element instanceof Element) created.add(element);
        return element;
      },
    });
    Object.assign(window, { __createdByScript: created });
  });
}

function productCoverFromServer(page: Page): Promise<boolean> {
  return page.locator(productCover).evaluate((image) => {
    const created: unknown = Reflect.get(window, "__createdByScript");
    if (!(created instanceof WeakSet))
      throw new Error("Метки созданных скриптом элементов не установлены");
    return !created.has(image);
  });
}

test("ответ о входе не заставляет рисовать заново часть страницы, ещё не пришедшую потоком", async ({
  page,
}) => {
  await markScriptCreatedElements(page);
  // Продукт ждёт backend, а ответ гостю о входе backend не читает: он приходит, пока продукт в пути.
  await setBackendDelay(1_500);
  const authStatus = page.waitForResponse((response) =>
    response.url().endsWith("/auth/status"),
  );
  await page.goto("/products/navigation-cover");
  expect(await (await authStatus).json()).toMatchObject({ state: "guest" });
  await expect(page.locator(productCover)).toBeVisible();
  // Без этого тест прошёл бы и там, где ответ опоздал и пришёл после всей страницы.
  expect(
    await page.evaluate(() => {
      const [navigation] = performance.getEntriesByType("navigation");
      const [status] = performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.endsWith("/auth/status"));
      return (
        navigation instanceof PerformanceNavigationTiming &&
        status instanceof PerformanceResourceTiming &&
        status.responseEnd < navigation.responseEnd
      );
    }),
    "ответ о входе пришёл, пока страница ещё шла потоком",
  ).toBe(true);

  expect(
    await productCoverFromServer(page),
    "обложка — узел из серверной разметки, а не нарисованный браузером заново",
  ).toBe(true);
});

test("первый ответ о входе не пересоздаёт уже нарисованную страницу вошедшего читателя", async ({
  baseURL,
  context,
  page,
}) => {
  if (baseURL === undefined) throw new Error("Проверке нужен адрес приложения");
  await signInAsMember(context, baseURL);
  await markScriptCreatedElements(page);
  // Оболочка спрашивает представление аккаунта только рендером, который применил ответ о входе.
  const accountPresentation = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/account",
  );
  await page.goto("/products/navigation-cover");
  await accountPresentation;

  expect(
    await productCoverFromServer(page),
    "обложка — узел из серверной разметки, а не нарисованный браузером заново",
  ).toBe(true);
});

test("архивные продукт, программа и урок открываются держателю после гостевого 404", async ({
  page,
  context,
  baseURL,
  browser,
}) => {
  if (baseURL === undefined) throw new Error("baseURL is required");
  const archive = "/products/navigation-archive";
  await page.goto(`${archive}/programme`);
  await expect(
    page.getByRole("heading", { name: "Подборка не найдена" }),
  ).toBeVisible();
  await signInAsMember(context, baseURL);
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Архивный продукт" }),
  ).toBeVisible();
  await page.goto(archive);
  await expect(
    page.getByRole("heading", { level: 1, name: "Архивный продукт" }),
  ).toBeVisible();
  await page.goto(
    `/materials/navigation-lesson-7?from=${encodeURIComponent(`${archive}/programme`)}`,
  );
  await expect(
    page.getByText(protectedBodyMarker, { exact: false }).first(),
  ).toBeVisible();
  const guest = await browser.newContext();
  try {
    const guestPage = await guest.newPage();
    for (const path of [
      archive,
      `${archive}/programme`,
      "/materials/navigation-lesson-7",
    ]) {
      await guestPage.goto(path);
      await expect(
        guestPage.getByRole("heading", {
          name: path.startsWith("/materials/")
            ? "Материал не найден"
            : "Подборка не найдена",
        }),
      ).toBeVisible();
      await expect(
        guestPage.getByText(protectedBodyMarker, { exact: false }),
      ).toHaveCount(0);
    }
  } finally {
    await guest.close();
  }
});

test("old Offer links reach the canonical product checkout and retain the selected tariff", async ({
  page,
}) => {
  const offer = "66666666-6666-4666-8666-666666666601";
  await page.goto(`/subscription?offer=${offer}&from=telegram&promo=COURSE`);
  await expect(page).toHaveURL(
    `/products/navigation-proof/buy?offer=${offer}&from=telegram&promo=COURSE`,
  );
});

test("a hidden tariff survives sign-in and resolves its own product", async ({
  page,
  context,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("Web baseURL is required");
  const offer = "66666666-6666-4666-8666-666666666603";
  const link = `/payment/checkout?offer=${offer}&promo=COURSE`;
  await page.goto(`/subscription?offer=${offer}&promo=COURSE`);
  await expect(
    page.getByRole("main").getByRole("button", { name: "Войти", exact: true }),
  ).toBeVisible();
  await expect(page.locator('input[name="returnTo"]')).toHaveValue(link);
  await signInAsMember(context, baseURL);
  await page.goto(link);
  await expect(page).toHaveURL(
    `/products/navigation-modes/buy?offer=${offer}&promo=COURSE`,
  );
});

test("client navigation to another Offer resets the selected tariff on the same Product", async ({
  page,
  context,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("Web baseURL is required");
  await signInAsMember(context, baseURL);
  const firstOffer = "66666666-6666-4666-8666-666666666601";
  const secondOffer = "66666666-6666-4666-8666-666666666605";
  await page.goto(`/products/navigation-proof/buy?offer=${firstOffer}`);
  await expect(
    page.locator('input[value="66666666-6666-4666-8666-666666666602"]'),
  ).toBeChecked();
  await page.evaluate((href) => {
    Reflect.set(window, "__offerNavigationDocument", true);
    const next: unknown = Reflect.get(window, "next");
    if (next === null || typeof next !== "object")
      throw new Error("Next router is absent");
    const router: unknown = Reflect.get(next, "router");
    if (router === null || typeof router !== "object")
      throw new Error("Next router is absent");
    const push: unknown = Reflect.get(router, "push");
    if (typeof push !== "function")
      throw new Error("Next router cannot navigate");
    Reflect.apply(push, router, [href]);
  }, `/products/navigation-proof/buy?offer=${secondOffer}`);
  await expect(page).toHaveURL(
    `/products/navigation-proof/buy?offer=${secondOffer}`,
  );
  await expect(
    page.locator('input[value="66666666-6666-4666-8666-666666666606"]'),
  ).toBeChecked();
  expect(
    await page.evaluate((): unknown =>
      Reflect.get(window, "__offerNavigationDocument"),
    ),
  ).toBe(true);
});

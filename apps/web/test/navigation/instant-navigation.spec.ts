import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { expect, request as apiRequest, test, type BrowserContext, type Page, type Request } from "@playwright/test";

import { evidenceDirectory } from "../../../../scripts/evidence-path.mjs";

const backend = `http://127.0.0.1:${process.env.FAKE_BACKEND_PORT ?? "3190"}`;
const programme = "/guides/navigation-proof/programme";
const product = "/guides/navigation-proof";
const freeLesson = "navigation-lesson-1";
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
      accessToken: JSON.stringify({ [`@${backend}`]: { expiresAt: Math.floor(Date.now() / 1_000) + 3_600, scope: "", token: "navigation-member-token" } }),
      idToken: "navigation.id.token",
      refreshToken: "navigation-refresh-token",
    },
    "inside-navigation-logto-cookie-secret-key",
  );
  return { httpOnly: true, name: "logto_inside-web-navigation", sameSite: "Lax" as const, url: baseURL, value: session };
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
    storageState: { cookies: [{ ...cookie, domain: hostname, expires: -1, path: "/", secure: false }], origins: [] },
  });
  const response = await author.put("/api/authoring/home-pin", { multipart: { expectedVersion: "1", seriesId: "" } });
  expect(response.status(), "авторская запись закрепа принята").toBe(200);
  expect(await response.json()).toEqual({ kind: "ready", pin: { seriesId: null, version: 2 } });
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

async function controlBackend(control: { readonly delayMs?: number; readonly unavailable?: boolean }) {
  await fetch(`${backend}/__control`, { body: JSON.stringify(control), method: "POST" });
}
const setBackendDelay = (delayMs: number) => controlBackend({ delayMs });

async function backendRequests(): Promise<readonly { readonly authorized: boolean; readonly path: string }[]> {
  const response = await fetch(`${backend}/__requests`);
  return ((await response.json()) as { requests: { authorized: boolean; path: string }[] }).requests;
}

/** Записывает всё занятое (`aria-busy`) и все скелеты маршрутов, которые появлялись в документе. */
async function installProbe(page: Page) {
  await page.addInitScript(() => {
    const probe = { highestFooterWhileLoading: null as number | null, skeletons: [] as string[] };
    Object.assign(window, { __navigationProbe: probe });
    const describe = (element: Element) =>
      element.getAttribute("data-route-skeleton") ??
      element.getAttribute("data-discovery-state") ??
      element.getAttribute("data-material-reader-state") ??
      element.getAttribute("aria-label") ??
      element.tagName.toLowerCase();
    const scan = () => {
      const busy = document.querySelectorAll("main [aria-busy='true'], main [data-route-skeleton]");
      for (const element of busy) {
        const name = describe(element);
        if (!probe.skeletons.includes(name)) probe.skeletons.push(name);
      }
      if (busy.length > 0) {
        // Подвал площадки, а не подвал урока с соседями по продукту.
        const footer = document.querySelector("main nav[aria-label='Документы Inside']")?.closest("footer") ?? null;
        if (footer !== null) {
          const position = footer.getBoundingClientRect().top / window.innerHeight;
          probe.highestFooterWhileLoading = Math.min(probe.highestFooterWhileLoading ?? position, position);
        }
      }
    };
    const start = () => {
      new MutationObserver(scan).observe(document.documentElement, { attributes: true, childList: true, subtree: true });
      scan();
    };
    if (document.documentElement === null) document.addEventListener("DOMContentLoaded", start);
    else start();
  });
}

async function resetProbe(page: Page) {
  await page.evaluate(() => {
    const probe = (window as unknown as { __navigationProbe: { highestFooterWhileLoading: number | null; skeletons: string[] } }).__navigationProbe;
    probe.skeletons.length = 0;
    probe.highestFooterWhileLoading = null;
  });
}

function isNavigationRequest(request: Request): boolean {
  const headers = request.headers();
  return headers.rsc === "1" && headers["next-router-prefetch"] === undefined;
}

/**
 * Страница устоялась: её личная часть пришла, занятых мест не осталось. Переход, начатый раньше,
 * ждёт эту часть вместе с задержкой React до 300 мс (ADR 0027), и замер показал бы её, а не переход.
 */
async function personalPartLanded(page: Page) {
  await expect(page.locator("#content [data-series-access-pending]:visible, #content [data-material-reader-state='pending']:visible, main [aria-busy='true']:visible")).toHaveCount(0);
}

/** Замер одного перехода от устоявшейся страницы до готовой следующей. */
async function transition(page: Page, act: () => Promise<void>, ready: () => Promise<void>): Promise<TransitionMetrics> {
  await personalPartLanded(page);
  await resetProbe(page);
  let navigationRequests = 0;
  const count = (request: Request) => { if (isNavigationRequest(request)) navigationRequests += 1; };
  page.on("request", count);
  const startedAt = Date.now();
  await act();
  await ready();
  const millisecondsToReady = Date.now() - startedAt;
  // Запрос, начатый переходом, мог ещё не уйти: даём ему такт.
  await page.waitForTimeout(150);
  page.off("request", count);
  const probe = await page.evaluate(() => (window as unknown as { __navigationProbe: { highestFooterWhileLoading: number | null; skeletons: string[] } }).__navigationProbe);
  const routerTransitionMilliseconds = await page.evaluate(() => {
    const measure = performance.getEntriesByName("inside:navigation", "measure").at(-1);
    performance.clearMeasures("inside:navigation");
    return measure === undefined ? null : Math.round(measure.duration);
  });
  return { highestFooterWhileLoading: probe.highestFooterWhileLoading, millisecondsToReady, navigationRequests, routerTransitionMilliseconds, skeletons: [...probe.skeletons] };
}

// Пока поток ещё идёт, React держит пришедшую часть в скрытом контейнере вне `#content`, а прежний
// урок Next.js оставляет в документе скрытым, поэтому готовность ищется среди видимого в основной области.
/**
 * Core Web Vitals, которые страница сама отметила в User Timing. CLS и INP библиотека сообщает, когда
 * вкладка уходит в фон, поэтому проверка объявляет её скрытой.
 */
async function readWebVitals(page: Page): Promise<Record<string, number>> {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // Факт, которого ждёт проверка, — сама отметка CLS, а не истёкшая пауза.
  await page.waitForFunction(() => performance.getEntriesByName("inside:web-vital:CLS", "mark").length > 0);
  return page.evaluate(() => {
    const vitals: Record<string, number> = {};
    for (const mark of performance.getEntriesByType("mark")) {
      if (!mark.name.startsWith("inside:web-vital:")) continue;
      const detail = (mark as PerformanceMark).detail as { value: number };
      vitals[mark.name.slice("inside:web-vital:".length)] = Math.round(detail.value * 1_000) / 1_000;
    }
    return vitals;
  });
}

/**
 * Очередь предзагрузки видимых ссылок опустела: роутер начинает её после гидрации и шлёт запросы
 * один за другим, поэтому её конец — затихшая сеть свежего документа. Барьер годится только сразу
 * после `goto`: для уже затихшего документа Playwright отвечает сразу, ничего не дожидаясь, а
 * backend, замедленный раньше времени, достался бы самой предзагрузке.
 */
async function viewportPrefetchDrained(page: Page) {
  await page.waitForLoadState("networkidle");
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
      if (!request.url().includes(`/materials/${slug}`) || headers["next-router-prefetch"] === undefined || headers["next-router-segment-prefetch"] !== undefined) return;
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
  const routerHeaders = ["rsc", "next-router-prefetch", "next-router-segment-prefetch", "next-router-state-tree", "next-url"];
  const response = await page.context().request.get(request.url(), {
    headers: Object.fromEntries(routerHeaders.flatMap((name) => (sent[name] === undefined ? [] : [[name, sent[name]]]))),
  });
  expect(response.status(), "предзагрузка повторена успешно").toBe(200);
  return response.text();
}

interface Box { readonly left: number; readonly top: number; readonly width: number; readonly height: number }

/** Положение опор страницы: по ним видно, сдвинул ли следующий слой предыдущий. */
async function boxesOf(page: Page, selectors: readonly string[]): Promise<readonly Box[]> {
  return page.evaluate((list) => list.map((selector) => {
    const element = document.querySelector(`#content ${selector}`);
    if (element === null) throw new Error(`Нет опоры ${selector}`);
    const { left, top, width, height } = element.getBoundingClientRect();
    return { height, left, top, width };
  }), selectors);
}

const lessonReady = (page: Page, slug: string) => async () => {
  await page.waitForURL((url) => url.pathname === `/materials/${slug}`);
  await expect(page.locator("#content [data-material-reader-state='available']:visible, #content [data-material-reader-state='access-required']:visible")).toBeVisible();
};
// Посещённую страницу Next.js держит в документе скрытой, поэтому готовность ищется среди видимого.
const programmeReady = (page: Page, path = programme) => async () => {
  await page.waitForURL((url) => url.pathname === path);
  await expect(page.locator("#content [data-guide-programme]:visible a[href*='/materials/']").first()).toBeVisible();
};

/**
 * Замеры и снимки — свидетельства задачи #670. Обычный прогон кладёт их в артефакты;
 * `UPDATE_EVIDENCE=issue-670` — в `docs/evidence/issue-670`. Стадия «до» — тот же набор на коде без
 * изменений: каталог `test/navigation` и `playwright.navigation.config.ts` копируются во временный
 * worktree на `main`, где набор запускается с `NAVIGATION_EVIDENCE_STAGE=before`; его утверждения
 * там падают, а замеры, записанные до них, остаются.
 */
function evidenceFile(fileName: string): string {
  const path = join(evidenceDirectory("issue-670"), process.env.NAVIGATION_EVIDENCE_STAGE ?? "after", fileName);
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

function record(name: string, project: string, metrics: Record<string, unknown>) {
  writeFileSync(evidenceFile(`${name}-${project}.json`), `${JSON.stringify(metrics, null, 2)}\n`);
}

test.beforeEach(async ({ baseURL }) => {
  if (baseURL === undefined) throw new Error("Проверке нужен адрес приложения");
  await controlBackend({ delayMs: 0, unavailable: false });
  await expireServerCatalogCache(baseURL);
});
test.afterEach(async () => {
  await controlBackend({ delayMs: 0, unavailable: false });
});

test("программа ↔ урок: свой скелет на первом переходе и мгновенный повтор", async ({ page }, testInfo) => {
  await installProbe(page);
  await page.goto(programme);
  await programmeReady(page)();
  await viewportPrefetchDrained(page);
  await setBackendDelay(700);

  const lessonLink = page.locator(`[data-guide-programme] a[href*='/materials/${freeLesson}']`).first();
  const toLesson = await transition(page, () => lessonLink.click(), lessonReady(page, freeLesson));
  const backToProgramme = await transition(page, () => page.getByRole("link", { name: "Назад к программе" }).first().click(), programmeReady(page));
  const repeatLesson = await transition(page, () => page.locator(`[data-guide-programme] a[href*='/materials/${freeLesson}']`).first().click(), lessonReady(page, freeLesson));
  const repeatProgramme = await transition(page, () => page.getByRole("link", { name: "Назад к программе" }).first().click(), programmeReady(page));
  const historyBack = await transition(page, () => page.goBack().then(() => undefined), lessonReady(page, freeLesson));
  const historyForward = await transition(page, () => page.goForward().then(() => undefined), programmeReady(page));

  const metrics = { backToProgramme, historyBack, historyForward, repeatLesson, repeatProgramme, toLesson };
  record("programme-lesson", testInfo.project.name, metrics);
  const webVitals = await readWebVitals(page);
  record("web-vitals", testInfo.project.name, webVitals);
  // Порог «хорошо» у CLS — 0,1; цикл переходов не должен набрать и его.
  expect(webVitals.CLS, "переходы не сдвигают раскладку").toBeLessThan(0.1);

  const foreign = (seen: readonly string[], own: string) => seen.filter((name) => name !== own);
  // Общая часть урока ещё не в кеше, а backend отвечает 700 мс: скелет обязан показаться, и именно свой.
  expect(toLesson.skeletons, "первый переход в урок показывает скелет урока").toContain("material-reader");
  expect(foreign(toLesson.skeletons, "material-reader"), "и никакого другого").toEqual([]);
  expect(toLesson.highestFooterWhileLoading ?? 1, "подвал не поднимается под скелет урока").toBeGreaterThan(0.6);
  expect(foreign(backToProgramme.skeletons, "guide-programme"), "возврат в программу не показывает чужой скелет").toEqual([]);
  expect(repeatLesson.skeletons, "повторный переход в урок идёт без скелета").toEqual([]);
  expect(repeatLesson.navigationRequests, "повторный переход в урок не запрашивает RSC").toBe(0);
  expect(repeatProgramme.skeletons, "повторный возврат в программу идёт без скелета").toEqual([]);
  expect(repeatProgramme.navigationRequests, "повторный возврат в программу не запрашивает RSC").toBe(0);
  expect(historyBack.skeletons).toEqual([]);
  expect(historyBack.navigationRequests, "«назад» не делает запросов").toBe(0);
  expect(historyForward.skeletons).toEqual([]);
  expect(historyForward.navigationRequests, "«вперёд» не делает запросов").toBe(0);
});

test("продукт → программа → платный урок: у каждой страницы свой скелет", async ({ page }, testInfo) => {
  await installProbe(page);
  await page.goto(product);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await viewportPrefetchDrained(page);
  await setBackendDelay(700);

  const toProgramme = await transition(page, () => page.locator(`a[href='${programme}']`).first().click(), programmeReady(page));
  const toPaidLesson = await transition(page, () => page.locator(`[data-guide-programme] a[href*='/materials/${paidLesson}']`).first().click(), lessonReady(page, paidLesson));
  record("product-programme-paid-lesson", testInfo.project.name, { toPaidLesson, toProgramme });

  expect(toProgramme.skeletons.filter((name) => name !== "guide-programme")).toEqual([]);
  // Личная часть закрытого урока ждёт backend: на месте тела стоит его собственный скелет.
  expect(toPaidLesson.skeletons).toContain("material-reader");
  expect(toPaidLesson.skeletons.filter((name) => name !== "material-reader")).toEqual([]);
  await expect(page.locator("#content [data-material-reader-state='access-required']:visible")).toBeVisible();
});

test("намерение предзагружает общую часть урока: переход без скелета даже при медленном backend", async ({ page }, testInfo) => {
  await installProbe(page);
  await page.goto(programme);
  await programmeReady(page)();
  await viewportPrefetchDrained(page);

  const lessonLink = page.locator(`[data-guide-programme] a[href*='/materials/navigation-lesson-2']`).first();
  const prefetched = pagePrefetchSettled(page, "navigation-lesson-2");
  if (testInfo.project.name.startsWith("mobile")) await lessonLink.dispatchEvent("touchstart");
  else await lessonLink.hover();
  // Заголовки предзагрузки приходят раньше её тела. Замедлять backend можно, только когда браузер
  // с ней закончил: иначе задержка достаётся самой предзагрузке, и нажатие её обгоняет.
  const prefetchResponse = await (await prefetched).response();
  // Окно страницы ограничивает и общую часть: браузер держит предзагруженное 60 секунд, а не
  // пять минут серверного профиля (ADR 0027).
  expect(prefetchResponse?.headers()["x-nextjs-stale-time"], "предзагруженное живёт окно страницы").toBe("60");
  await setBackendDelay(700);

  const toLesson = await transition(page, () => lessonLink.click(), lessonReady(page, "navigation-lesson-2"));
  record("intent-prefetch", testInfo.project.name, { toLesson });

  // Backend отвечает 700 мс; урок без скелета значит, что общая часть пришла до нажатия.
  expect(toLesson.skeletons, "общая часть урока пришла до нажатия").toEqual([]);
});

test("повторный переход не ходит в backend, а гость нигде не предъявляет токен", async ({ page }) => {
  await fetch(`${backend}/__requests`, { method: "DELETE" });
  await page.goto(programme);
  await programmeReady(page)();
  await viewportPrefetchDrained(page);
  const lessonLink = () => page.locator(`[data-guide-programme] a[href*='/materials/${freeLesson}']`).first();
  await lessonLink().click();
  await lessonReady(page, freeLesson)();
  await page.getByRole("link", { name: "Назад к программе" }).first().click();
  await programmeReady(page)();
  // Журнал backend очищается, когда первый круг закончен целиком: личная часть программы пришла.
  await personalPartLanded(page);
  // Закрытый урок гостю не кешируется целиком: его личная часть читает backend при любом кеше,
  // поэтому чтения без токена в этом круге есть всегда.
  await page.locator(`[data-guide-programme] a[href*='/materials/${paidLesson}']`).first().click();
  await lessonReady(page, paidLesson)();
  await page.getByRole("link", { name: "Назад к программе" }).first().click();
  await programmeReady(page)();
  await personalPartLanded(page);

  const firstRound = await backendRequests();
  expect(firstRound.length, "первый круг действительно читал backend").toBeGreaterThan(0);
  expect(firstRound.filter((request) => request.authorized), "гость не предъявляет токен").toEqual([]);

  await fetch(`${backend}/__requests`, { method: "DELETE" });
  await lessonLink().click();
  await lessonReady(page, freeLesson)();
  await page.getByRole("link", { name: "Назад к программе" }).first().click();
  await programmeReady(page)();
  await page.waitForTimeout(300);

  const requests = await backendRequests();
  // Личные чтения браузера (прогресс, закладки) гостю выключены, а страницы взяты из памяти.
  expect(requests.map((request) => request.path)).toEqual([]);
});

test("авторская запись сбрасывает общий кеш: следующий гость читает backend заново", async ({ baseURL, browser }) => {
  if (baseURL === undefined) throw new Error("Проверке нужен адрес приложения");
  const guestReads = async () => (await backendRequests()).filter((request) => request.path.startsWith("/library/guides/navigation-proof")).length;
  const openProductAsNewGuest = async () => {
    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    await guestPage.goto(`${baseURL}${product}`);
    await expect(guestPage.locator("#content [data-guide-product]")).toBeVisible();
    await guest.close();
  };

  await openProductAsNewGuest();
  await fetch(`${backend}/__requests`, { method: "DELETE" });
  await openProductAsNewGuest();
  // Без записи второй гость получает продукт из общего кеша: на этом стоит и сам набор, который
  // сбрасывает кеш перед каждой проверкой, — без этой пары утверждений сброс ничем бы не проверялся.
  expect(await guestReads(), "второй гость читает продукт из общего кеша").toBe(0);

  await expireServerCatalogCache(baseURL);
  await openProductAsNewGuest();
  expect(await guestReads(), "после авторской записи продукт читается заново").toBeGreaterThan(0);
});

test("сбой каталога не застывает в кеше: повтор после восстановления открывает урок", async ({ page }) => {
  // Кеш сброшен перед проверкой, поэтому сбой достаётся и общей части урока, а не только личной.
  await controlBackend({ unavailable: true });
  await page.goto(`/materials/navigation-lesson-4?from=${encodeURIComponent(programme)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Материал временно недоступен" })).toBeVisible();

  await controlBackend({ unavailable: false });
  // Запись о сбое истекает сама, без сброса: повтор нажимается, пока урок не откроется.
  await expect(async () => {
    await page.getByRole("button", { name: "Повторить" }).click({ timeout: 1_000 });
    await expect(page.locator("#content [data-material-reader-state='access-required']:visible")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
});

test("закрытое тело не попадает ни в предзагрузку, ни в общий кеш, а выход сразу закрывает урок", async ({ baseURL, browser, context, page }) => {
  if (baseURL === undefined) throw new Error("Проверке нужен адрес приложения");
  await signInAsMember(context, baseURL);
  // Оборванный клиентом ответ предзагрузки прочитать нельзя, поэтому запросы запоминаются и после
  // повторяются из проверки с той же сессией: так тело каждого читается целиком.
  const paidLessonPrefetches: Request[] = [];
  page.on("request", (request) => {
    if (request.headers()["next-router-prefetch"] !== undefined && request.url().includes(`/materials/${paidLesson}`)) paidLessonPrefetches.push(request);
  });

  await page.goto(programme);
  await programmeReady(page)();
  const lessonLink = page.locator(`[data-guide-programme] a[href*='/materials/${paidLesson}']`).first();
  // Вошедшему платный урок открыт: личная часть программы пришла с его доступностью.
  await expect(page.locator(`#content [data-material-slug='${paidLesson}'][data-material-availability='available']:visible`)).toBeVisible();
  // Предзагрузка страницы целиком рисует урок на сервере с сессией вошедшего: именно она могла бы
  // унести закрытое тело. Нажатие ждёт, пока браузер с ней закончит. Слушатель ставится, когда
  // предзагрузка видимых ссылок уже прошла: её запрос оболочки на этот же адрес — не та предзагрузка.
  await viewportPrefetchDrained(page);
  const pagePrefetch = pagePrefetchSettled(page, paidLesson);
  await lessonLink.hover();
  const pagePrefetchBody = await replayPrefetch(page, await pagePrefetch);
  // Тело настоящее: в нём общая часть урока. Пустой или чужой ответ проверку бы обманул.
  expect(pagePrefetchBody, "предзагрузка несёт общую часть урока").toContain("Первый платный урок");
  expect(pagePrefetchBody, "предзагрузка страницы не несёт закрытого тела").not.toContain(protectedBodyMarker);

  await lessonLink.click();
  await page.waitForURL((url) => url.pathname === `/materials/${paidLesson}`);
  await expect(page.getByText(protectedBodyMarker).first()).toBeVisible();
  const prefetchBodies = await Promise.all(paidLessonPrefetches.map((request) => replayPrefetch(page, request)));
  expect(prefetchBodies.length, "платный урок действительно предзагружался").toBeGreaterThan(0);
  expect(prefetchBodies.filter((body) => body.includes(protectedBodyMarker)), "ни одна предзагрузка не несёт закрытого тела").toEqual([]);

  // Гость в другом браузере открывает тот же урок после вошедшего: общий кеш знает только тизер.
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  const guestResponse = await guestPage.goto(`${baseURL}/materials/${paidLesson}?from=${encodeURIComponent(programme)}`);
  await expect(guestPage.locator("#content [data-material-reader-state='access-required']:visible")).toBeVisible();
  expect(await guestResponse?.text()).not.toContain(protectedBodyMarker);
  await guest.close();

  // Выход — полная загрузка документа без cookie сессии: урок закрыт сразу, без окна кеша.
  await context.clearCookies();
  await page.reload();
  await expect(page.locator("#content [data-material-reader-state='access-required']:visible")).toBeVisible();
  await expect(page.getByText(protectedBodyMarker)).toHaveCount(0);
});

/** Стадия «до» снимает кадры на коде без слоёв: общей части и её опор там ещё нет. */
const beforeStage = process.env.NAVIGATION_EVIDENCE_STAGE === "before";

test("снимки перехода «программа → урок → программа» при медленном backend", async ({ page }, testInfo) => {
  test.skip(beforeStage, "на коде без слоёв те же кадры снимает отдельная проверка");
  const project = testInfo.project.name;
  const loading = page.locator("main [aria-busy='true']").first();
  await page.goto(programme);
  await programmeReady(page)();
  await viewportPrefetchDrained(page);
  await setBackendDelay(1_500);

  const lessonAnchors = ["[data-reader-return='top']", "[data-reader-header]"];
  await page.locator(`[data-guide-programme] a[href*='/materials/${paidLesson}']`).first().click();
  await expect(loading).toBeVisible();
  await expect(page.locator("#content [data-material-reader-state='pending']:visible")).toBeVisible();
  const lessonSharedPart = await boxesOf(page, lessonAnchors);
  await page.screenshot({ path: evidenceFile(`programme-to-lesson-loading-${project}.png`) });
  await lessonReady(page, paidLesson)();
  expect(await boxesOf(page, lessonAnchors), "личная часть урока не двигает возврат и шапку").toEqual(lessonSharedPart);
  await page.screenshot({ path: evidenceFile(`lesson-ready-${project}.png`) });

  // Возврат в программу за пределами окна кеша снимается на свежей странице урока.
  await page.goto(`/materials/${paidLesson}?from=${encodeURIComponent(programme)}`);
  await lessonReady(page, paidLesson)();
  await viewportPrefetchDrained(page);
  await page.getByRole("link", { name: "Назад к программе" }).first().click();
  await page.waitForURL((url) => url.pathname === programme);
  const programmeAnchors = ["[data-programme-part='back']", "[data-programme-part='header']", "[data-series-ordinal='1']"];
  await expect(page.locator("#content [data-series-access-pending]").first()).toBeVisible();
  const programmeSharedPart = await boxesOf(page, programmeAnchors);
  await page.screenshot({ path: evidenceFile(`lesson-to-programme-loading-${project}.png`) });
  await expect(page.locator("#content [data-series-access-pending]")).toHaveCount(0);
  expect(await boxesOf(page, programmeAnchors), "личная часть программы не двигает шапку и первый урок").toEqual(programmeSharedPart);
  await page.screenshot({ path: evidenceFile(`programme-ready-${project}.png`) });
});

test("снимки «до»: те же кадры перехода на коде без слоёв", async ({ page }, testInfo) => {
  test.skip(!beforeStage, "нужна только стадии «до»: NAVIGATION_EVIDENCE_STAGE=before");
  const project = testInfo.project.name;
  const loading = page.locator("main [aria-busy='true']").first();
  await page.goto(programme);
  await programmeReady(page)();
  await viewportPrefetchDrained(page);
  await setBackendDelay(1_500);

  await page.locator(`[data-guide-programme] a[href*='/materials/${paidLesson}']`).first().click();
  await expect(loading).toBeVisible();
  await page.screenshot({ path: evidenceFile(`programme-to-lesson-loading-${project}.png`) });
  await lessonReady(page, paidLesson)();
  await page.screenshot({ path: evidenceFile(`lesson-ready-${project}.png`) });

  await page.goto(`/materials/${paidLesson}?from=${encodeURIComponent(programme)}`);
  await lessonReady(page, paidLesson)();
  await viewportPrefetchDrained(page);
  await page.getByRole("link", { name: "Назад к программе" }).first().click();
  await page.waitForURL((url) => url.pathname === programme);
  await expect(loading).toBeVisible();
  await page.screenshot({ path: evidenceFile(`lesson-to-programme-loading-${project}.png`) });
  await programmeReady(page)();
  await page.screenshot({ path: evidenceFile(`programme-ready-${project}.png`) });
});

test("Главная ↔ продукт: свой скелет продукта, Главная без скелета, повтор без запросов", async ({ page }, testInfo) => {
  await installProbe(page);
  await page.goto("/");
  const productLink = page.getByRole("link", { name: /Открыть (продукт|практикум)/u }).first();
  await expect(productLink).toBeVisible();
  await viewportPrefetchDrained(page);
  await setBackendDelay(700);

  const productReady = async () => {
    await page.waitForURL((url) => url.pathname === product);
    await expect(page.locator("#content [data-guide-product]")).toBeVisible();
  };
  const homeReady = async () => {
    await page.waitForURL((url) => url.pathname === "/");
    await expect(page.getByRole("link", { name: /Открыть (продукт|практикум)/u }).first()).toBeVisible();
  };
  const toProduct = await transition(page, () => productLink.click(), productReady);
  const backHome = await transition(page, () => page.getByRole("link", { name: "Назад на Главную" }).first().click(), homeReady);
  const repeatProduct = await transition(page, () => page.getByRole("link", { name: /Открыть (продукт|практикум)/u }).first().click(), productReady);
  const repeatHome = await transition(page, () => page.getByRole("link", { name: "Назад на Главную" }).first().click(), homeReady);
  record("home-product", testInfo.project.name, { backHome, repeatHome, repeatProduct, toProduct });

  expect(toProduct.skeletons.filter((name) => name !== "guide-product"), "продукт показывает только свой скелет").toEqual([]);
  // Главная блокирующая: закреп читается до первого кадра, поэтому скелета всей страницы у неё нет (#562).
  expect(backHome.skeletons.filter((name) => name !== "Материалы" && name !== "loading"), "Главная не показывает чужой скелет").toEqual([]);
  expect(repeatProduct.navigationRequests, "повторный переход в продукт не запрашивает RSC").toBe(0);
  expect(repeatProduct.skeletons).toEqual([]);
  expect(repeatHome.navigationRequests, "повторный возврат на Главную не запрашивает RSC").toBe(0);
});

test("смена режима прохождения сбрасывает страницы, которые браузер помнит в прежнем режиме", async ({ page }) => {
  const modesProgramme = "/guides/navigation-modes/programme";
  // Соседний урок остаётся в документе скрытым, поэтому шаг ищется среди видимого.
  const step = (mode: "example" | "own") => page.locator("#content").getByText(`ШАГ-ДЛЯ-РЕЖИМА-${mode}`).filter({ visible: true });
  await page.goto(modesProgramme);
  await programmeReady(page, modesProgramme)();
  await page.locator("#content [data-guide-programme]:visible a[href*='/materials/navigation-lesson-5']").first().click();
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

test("обложка первого экрана продукта грузится сразу и даёт LCP в пределах «хорошо»", async ({ page }) => {
  await page.goto("/guides/navigation-cover");

  // React показывает пришедшую часть с задержкой до 300 мс. Если в это окно гидрация получает обновление
  // выше границы, React рисует её на клиенте, а копия с сервера ещё лежит в скрытом контейнере вне
  // `#content` (#740). Обложку страницы ищет основная область.
  const cover = page.locator("#content [data-product-part='hero'] img");
  await expect(cover).toHaveAttribute("fetchpriority", "high");
  await expect(cover).toHaveAttribute("loading", "eager");
  // Факт, которого ждёт проверка, — картинка обложки действительно отрисована.
  await expect.poll(() => cover.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);

  const lcp = await page.evaluate(() => new Promise<{ readonly heroCover: boolean; readonly startTime: number }>((resolve) => {
    new PerformanceObserver((list, observer) => {
      const entry = list.getEntries().at(-1);
      if (entry === undefined) return;
      observer.disconnect();
      const element = "element" in entry && entry.element instanceof Element ? entry.element : null;
      resolve({ heroCover: element?.tagName === "IMG" && element.closest("[data-product-part='hero']") !== null, startTime: entry.startTime });
    }).observe({ buffered: true, type: "largest-contentful-paint" });
  }));
  expect(lcp.heroCover, "крупнейший элемент первого экрана — обложка продукта").toBe(true);
  // Порог «хорошо» у LCP — 2,5 секунды.
  expect(lcp.startTime).toBeLessThan(2_500);
});

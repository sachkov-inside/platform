import { request as playwrightRequest, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

/**
 * Роли сквозного набора. Имя роли — это то, чем она является для продукта; в какой переменной
 * запускатор передал её сессию, знает только эта таблица. Две последние роли существуют для
 * проверки самого срока сессии: у первой доступ истёк и продлевается, у второй продлить нечем.
 */
const sessionEnvironmentNames = {
  OWNER: "FULLSTACK_LOGTO_SESSION",
  MEMBER: "FULLSTACK_LOGTO_MEMBER_SESSION",
  NON_MEMBER: "FULLSTACK_LOGTO_NON_MEMBER_SESSION",
  EXPIRED_MEMBER: "FULLSTACK_LOGTO_EXPIRED_MEMBER_SESSION",
  STALE_MEMBER: "FULLSTACK_LOGTO_STALE_MEMBER_SESSION",
  PAST_EXPIRY: "FULLSTACK_LOGTO_SESSION_PAST_EXPIRY",
  WITHOUT_RENEWAL: "FULLSTACK_LOGTO_SESSION_WITHOUT_RENEWAL",
} as const;

export type FullStackRole = keyof typeof sessionEnvironmentNames;

export function fullStackBaseUrl(): string {
  return process.env.FULLSTACK_WEB_BASE_URL ?? "http://127.0.0.1:3000";
}

/** Cookie сессии без проверки: нужен там, где проверяется само поведение недействующей сессии. */
export async function addFullStackSessionCookie(
  context: BrowserContext,
  role: FullStackRole,
): Promise<void> {
  const environmentName = sessionEnvironmentNames[role];
  const cookieName = process.env.FULLSTACK_LOGTO_COOKIE_NAME;
  const value = process.env[environmentName];
  if (cookieName === undefined || value === undefined) {
    throw new Error(
      `Missing local identity fixture for ${role} (${environmentName})`,
    );
  }
  await context.addCookies([
    {
      name: cookieName,
      value,
      url: fullStackBaseUrl(),
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

/**
 * Вход под подготовленной сессией. Кроме cookie проверяется, что приложение эту сессию принимает
 * прямо сейчас. Иначе истёкший доступ виден не как истечение, а как «элемент не появился» или
 * гостевая разметка в середине набора — и падение уводит искать несуществующий дефект.
 */
export async function signInFullStack(
  context: BrowserContext,
  role: FullStackRole = "NON_MEMBER",
): Promise<void> {
  await addFullStackSessionCookie(context, role);
  const state = await fullStackSessionState(context);
  if (state === "authenticated") {
    await passFirstSignInScreen(context);
    return;
  }
  // Гостевое состояние означает, что приложение сессию не приняло: её не удалось продлить.
  // Всё остальное — недоступность зависимости, и называть её истёкшей сессией было бы новым
  // ложным следом вместо убранного.
  throw new Error(
    state === "guest"
      ? `Full-stack session ${role} is signed out: the identity fixture could not renew its ` +
        "access token. This is an expired session, not a defect in the page under test."
      : `Full-stack session ${role} could not be checked: /auth/status reported ${state}. ` +
        "The application or its API is unavailable; the session itself may be fine.",
  );
}

/**
 * Экран первого входа закрывает кабинет и покупки, пока действующая редакция условий не принята.
 * Сценарии проходят его настоящей кнопкой; уже принятые условия экран сразу пропускает.
 */
async function passFirstSignInScreen(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(`${fullStackBaseUrl()}/welcome?returnTo=%2F`);
    // The dialog is interactive only once it is modal; the server-rendered copy is not yet hydrated.
    const accept = page.locator("dialog:modal").getByRole("button", { name: "Принять условия и продолжить" });
    // An account that already accepted is redirected away; one still here must be able to accept.
    // The page streams, so the redirect may arrive after `goto` resolves: wait for whichever comes first.
    const outcome = await Promise.race([
      accept.waitFor({ timeout: 15_000 }).then(() => "accept" as const),
      page.waitForURL((url) => url.pathname !== "/welcome", { timeout: 15_000 }).then(() => "left" as const),
    ]);
    if (outcome === "accept") {
      await accept.click({ timeout: 15_000 });
      await page.waitForURL((url) => url.pathname !== "/welcome");
    }
  } finally {
    await page.close();
  }
}

/** Что приложение думает о текущей сессии: `authenticated`, `guest` или `unavailable`. */
export async function fullStackSessionState(
  context: BrowserContext,
): Promise<string> {
  const response = await context.request.get(
    `${fullStackBaseUrl()}/auth/status`,
  );
  if (!response.ok()) {
    return `HTTP ${String(response.status())}`;
  }
  return String(((await response.json()) as { readonly state?: string }).state);
}

/** Use the browser cookie rules for real user mutations, including refreshed Secure cookies on loopback. */
export async function fullStackBrowserRequest(page: Page, path: string, method = "GET", fields?: Record<string, string>) {
  const result = await page.evaluate(async ({ path, method, fields }) => {
    const body = fields === undefined ? undefined : new FormData();
    if (body !== undefined && fields !== undefined) for (const [key, value] of Object.entries(fields)) body.set(key, value);
    const response = await fetch(path, { method, ...(body === undefined ? {} : { body }), credentials: "same-origin" });
    return { ok: response.ok, status: response.status, body: await response.text() };
  }, { path, method, fields });
  return { ok: () => result.ok, status: () => result.status, json: (): Promise<unknown> => Promise.resolve(JSON.parse(result.body) as unknown) };
}

/**
 * HTTP-запросы от имени сессии страницы. Продлённая сессия ставит cookie с `Secure`; браузер шлёт его
 * на 127.0.0.1, а собственный клиент Playwright — нет, и запрос уходит гостем. Здесь cookie браузера
 * передаются явно.
 */
export async function fullStackPageRequest(page: Page): Promise<APIRequestContext> {
  // `cookies(url)` for an http URL drops Secure cookies the same way, so the domain is filtered here.
  const host = new URL(fullStackBaseUrl()).hostname;
  const cookie = (await page.context().cookies())
    .filter(({ domain }) => domain.replace(/^\./u, "") === host)
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  return playwrightRequest.newContext({
    baseURL: fullStackBaseUrl(),
    extraHTTPHeaders: cookie === "" ? {} : { cookie },
  });
}

import type { BrowserContext } from "@playwright/test";

/**
 * Сессии сквозного набора. Имя переменной — это и есть имя роли, под которой идёт проверка.
 * Две последние существуют только для проверки самого срока сессии.
 */
export type FullStackSessionName =
  | "FULLSTACK_LOGTO_SESSION"
  | "FULLSTACK_LOGTO_MEMBER_SESSION"
  | "FULLSTACK_LOGTO_NON_MEMBER_SESSION"
  | "FULLSTACK_LOGTO_EXPIRED_MEMBER_SESSION"
  | "FULLSTACK_LOGTO_STALE_MEMBER_SESSION"
  | "FULLSTACK_LOGTO_SESSION_PAST_EXPIRY"
  | "FULLSTACK_LOGTO_SESSION_WITHOUT_RENEWAL";

export function fullStackBaseUrl(): string {
  return process.env.FULLSTACK_WEB_BASE_URL ?? "http://127.0.0.1:3000";
}

/** Cookie сессии без проверки: нужен там, где проверяется само поведение недействующей сессии. */
export async function addFullStackSessionCookie(
  context: BrowserContext,
  name: FullStackSessionName,
): Promise<void> {
  const cookieName = process.env.FULLSTACK_LOGTO_COOKIE_NAME;
  const value = process.env[name];
  if (cookieName === undefined || value === undefined) {
    throw new Error(`Missing local identity fixture for ${name}`);
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
  name: FullStackSessionName = "FULLSTACK_LOGTO_NON_MEMBER_SESSION",
): Promise<void> {
  await addFullStackSessionCookie(context, name);
  const response = await context.request.get(`${fullStackBaseUrl()}/auth/status`);
  const state = response.ok()
    ? ((await response.json()) as { readonly state?: string }).state
    : `HTTP ${String(response.status())}`;
  if (state !== "authenticated") {
    throw new Error(
      `Full-stack session ${name} is not signed in (/auth/status reported ${String(state)}). ` +
        "The identity fixture could not renew its access token, so this is an expired session, " +
        "not a defect in the page under test.",
    );
  }
}

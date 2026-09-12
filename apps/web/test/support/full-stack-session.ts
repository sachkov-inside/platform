import type { BrowserContext } from "@playwright/test";

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
  if (state === "authenticated") return;
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

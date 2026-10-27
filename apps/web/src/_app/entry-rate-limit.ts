import { entryClient } from "@/shared/lib/ingress-client";
export { entryClient } from "@/shared/lib/ingress-client";
export type { EntryClient } from "@/shared/lib/ingress-client";

import type { WebRuntimeMode } from "@/shared/config/index.server";

/**
 * Базовое ограничение частоты на входных маршрутах: вход, команды оплаты и контакта для чеков,
 * переход по ссылке из рассылки и отчёты браузера. Это предохранитель общего сервера от потока
 * запросов с одного адреса, а не защита учётной записи: подбор кода и пароля ограничивают backend
 * и Logto. Счётчики живут в памяти единственного процесса web — ADR 0028. Единственный потребитель —
 * `proxy.ts`, поэтому модуль принадлежит слою приложения, а не `shared`.
 */
export const ENTRY_RATE_WINDOW_SECONDS = 60;

export type EntryRouteKind =
  "sign-in" | "billing-command" | "public-link" | "client-report";

/**
 * Сколько запросов одного вида принимается с одного адреса за окно. Вход — это пара запросов
 * (`/auth/sign-in` и `/callback`), поэтому его предел выше команды. Ссылки из рассылки
 * запрашивает и сервис предпросмотра, который ходит с немногих адресов.
 */
export const entryRequestsPerWindow = {
  "sign-in": 60,
  "billing-command": 20,
  "public-link": 120,
  "client-report": 60,
} as const satisfies Record<EntryRouteKind, number>;

/**
 * Команды, которые обращаются к банку или отправляют письмо с кодом. Отмена, возобновление и отзыв
 * способа оплаты меняют только запись в базе и сюда не входят.
 */
const billingCommandPaths = [
  "/api/account/billing/purchase",
  "/api/account/billing/contact/start",
  "/api/account/billing/contact/confirm",
] as const;

/** Отчёты, которые браузер присылает без сессии. */
const clientReportPaths = [
  "/api/web-vitals",
  "/api/render-errors",
  "/api/analytics",
] as const;

/** Все пути, которые ограничитель различает; `proxy.ts` обязан сопоставлять ровно их. */
export const entryRoutePaths = [
  "/auth/sign-in",
  "/api/product-waitlist/intent",
  "/callback",
  "/communications/visit",
  "/payment/links/:path*",
  "/telegram/continue",
  ...billingCommandPaths,
  ...clientReportPaths,
] as const;

const billingCommands = new Set<string>(billingCommandPaths);
const clientReports = new Set<string>(clientReportPaths);

export function classifyEntryRoute(
  method: string,
  pathname: string,
): EntryRouteKind | undefined {
  if (
    method === "POST" &&
    (pathname === "/auth/sign-in" ||
      pathname === "/api/product-waitlist/intent")
  )
    return "sign-in";
  if (method === "GET" && pathname === "/callback") return "sign-in";
  if (method === "POST" && billingCommands.has(pathname))
    return "billing-command";
  if (method === "POST" && clientReports.has(pathname)) return "client-report";
  if (
    (method === "GET" || method === "HEAD") &&
    (pathname === "/communications/visit" ||
      pathname === "/telegram/continue" ||
      /^\/payment\/links\/[^/]+$/.test(pathname))
  ) {
    return "public-link";
  }
  return undefined;
}

/** Сколько окон держится в памяти; при переполнении первыми уходят истёкшие, затем самые старые. */
const MAX_TRACKED_WINDOWS = 10_000;

export type EntryRateDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

export interface EntryRateLimiter {
  take(kind: EntryRouteKind, clientKey: string): EntryRateDecision;
}

export function createEntryRateLimiter(
  now: () => number = Date.now,
): EntryRateLimiter {
  const windowMilliseconds = ENTRY_RATE_WINDOW_SECONDS * 1_000;
  const windows = new Map<
    string,
    { readonly startedAt: number; count: number }
  >();

  function makeRoom(at: number): void {
    if (windows.size < MAX_TRACKED_WINDOWS) return;
    for (const [key, window] of windows) {
      if (at - window.startedAt >= windowMilliseconds) windows.delete(key);
    }
    // Окна вставляются в порядке начала, поэтому первое — самое старое.
    while (windows.size >= MAX_TRACKED_WINDOWS) {
      const oldest = windows.keys().next();
      if (oldest.done === true) return;
      windows.delete(oldest.value);
    }
  }

  return {
    take(kind, clientKey) {
      const at = now();
      const key = `${kind} ${clientKey}`;
      let window = windows.get(key);
      if (window === undefined || at - window.startedAt >= windowMilliseconds) {
        windows.delete(key);
        makeRoom(at);
        window = { startedAt: at, count: 0 };
        windows.set(key, window);
      }
      window.count += 1;
      if (window.count <= entryRequestsPerWindow[kind])
        return { allowed: true };
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((window.startedAt + windowMilliseconds - at) / 1_000),
        ),
      };
    },
  };
}

export function entryRateLimitedResponse(retryAfterSeconds: number): Response {
  return new Response(
    "Слишком много запросов. Повторите попытку через минуту.\n",
    {
      status: 429,
      headers: {
        "cache-control": "no-store, private",
        "content-type": "text/plain; charset=utf-8",
        "retry-after": String(retryAfterSeconds),
      },
    },
  );
}

/**
 * Решение для одного запроса: `undefined` пропускает его дальше. Ограничение действует только в
 * production-сборке; стенд и проверки на `next dev` его не видят.
 */
export function limitEntryRequest(
  limiter: EntryRateLimiter,
  request: Request,
  mode: WebRuntimeMode,
): Response | undefined {
  if (mode !== "production") return undefined;
  const kind = classifyEntryRoute(
    request.method,
    new URL(request.url).pathname,
  );
  if (kind === undefined) return undefined;
  const client = entryClient(request.headers);
  if (client.loopback) return undefined;
  const decision = limiter.take(kind, client.key);
  return decision.allowed
    ? undefined
    : entryRateLimitedResponse(decision.retryAfterSeconds);
}

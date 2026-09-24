import { z } from "zod";

/**
 * Базовое ограничение частоты на входных маршрутах: вход, команды оплаты и переход по ссылке из
 * рассылки. Это предохранитель общего сервера от потока запросов с одного адреса, а не защита
 * учётной записи: подбор кода и пароля ограничивают backend и Logto. Счётчики живут в памяти
 * единственного процесса web и теряются при перезапуске — ADR 0028.
 */
export const ENTRY_RATE_WINDOW_SECONDS = 60;

export type EntryRouteKind = "sign-in" | "payment" | "public-link";

/** Сколько запросов одного вида принимается с одного адреса за окно. */
export const entryRequestsPerWindow = {
  "sign-in": 30,
  payment: 20,
  "public-link": 60,
} as const satisfies Record<EntryRouteKind, number>;

/** Команды, которые обращаются к банку или отправляют письмо с кодом. */
const paymentCommandPaths = [
  "/api/account/billing/purchase",
  "/api/account/billing/payment-method/change",
  "/api/account/billing/subscription/change",
  "/api/account/billing/contact/start",
  "/api/account/billing/contact/confirm",
] as const;

/** Все пути, которые ограничитель различает; `proxy.ts` обязан сопоставлять ровно их. */
export const entryRoutePaths = [
  "/auth/sign-in",
  "/callback",
  "/communications/visit",
  ...paymentCommandPaths,
] as const;

const paymentCommands = new Set<string>(paymentCommandPaths);

export function classifyEntryRoute(method: string, pathname: string): EntryRouteKind | undefined {
  if (method === "POST" && pathname === "/auth/sign-in") return "sign-in";
  if (method === "GET" && pathname === "/callback") return "sign-in";
  if (method === "POST" && paymentCommands.has(pathname)) return "payment";
  if ((method === "GET" || method === "HEAD") && pathname === "/communications/visit") {
    return "public-link";
  }
  return undefined;
}

const clientAddressSchema = z.union([z.ipv4(), z.ipv6()]);

/**
 * Адрес клиента. Caddy заменяет недоверенный входящий `X-Forwarded-For` адресом соединения, а без
 * Caddy заголовок заполняет сам Next.js, поэтому первое значение — адрес, с которым пришёл запрос.
 */
export function entryClientAddress(headers: Headers): string {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const parsed = clientAddressSchema.safeParse(first);
  return parsed.success ? parsed.data.toLowerCase() : "unidentified";
}

/**
 * Loopback приходит только мимо Caddy: проверки production-сборки и служебные вызовы на хосте.
 * Снаружи такой адрес не прислать — Caddy перезаписывает заголовок.
 */
export function isLoopbackAddress(address: string): boolean {
  return address === "::1" || /^(?:::ffff:)?127\./u.test(address);
}

/** Сколько окон держится в памяти; при переполнении первыми уходят истёкшие, затем самые старые. */
const MAX_TRACKED_WINDOWS = 10_000;

export type EntryRateDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

export interface EntryRateLimiter {
  take(kind: EntryRouteKind, clientAddress: string): EntryRateDecision;
}

export function createEntryRateLimiter(now: () => number = Date.now): EntryRateLimiter {
  const windowMilliseconds = ENTRY_RATE_WINDOW_SECONDS * 1_000;
  const windows = new Map<string, { readonly startedAt: number; count: number }>();

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
    take(kind, clientAddress) {
      const at = now();
      const key = `${kind} ${clientAddress}`;
      let window = windows.get(key);
      if (window === undefined || at - window.startedAt >= windowMilliseconds) {
        windows.delete(key);
        makeRoom(at);
        window = { startedAt: at, count: 0 };
        windows.set(key, window);
      }
      window.count += 1;
      if (window.count <= entryRequestsPerWindow[kind]) return { allowed: true };
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((window.startedAt + windowMilliseconds - at) / 1_000)),
      };
    },
  };
}

export function entryRateLimitedResponse(retryAfterSeconds: number): Response {
  return new Response("Слишком много запросов. Повторите попытку через минуту.\n", {
    status: 429,
    headers: {
      "cache-control": "no-store, private",
      "content-type": "text/plain; charset=utf-8",
      "retry-after": String(retryAfterSeconds),
    },
  });
}

/**
 * Решение для одного запроса: `undefined` пропускает его дальше. Ограничение действует только в
 * production-сборке; стенд и проверки на `next dev` его не видят.
 */
export function limitEntryRequest(
  limiter: EntryRateLimiter,
  request: Request,
  environment: string | undefined,
): Response | undefined {
  if (environment !== "production") return undefined;
  const kind = classifyEntryRoute(request.method, new URL(request.url).pathname);
  if (kind === undefined) return undefined;
  const clientAddress = entryClientAddress(request.headers);
  if (isLoopbackAddress(clientAddress)) return undefined;
  const decision = limiter.take(kind, clientAddress);
  return decision.allowed ? undefined : entryRateLimitedResponse(decision.retryAfterSeconds);
}

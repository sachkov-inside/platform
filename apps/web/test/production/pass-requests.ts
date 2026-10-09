import type {
  APIResponse,
  BrowserContext,
  Page,
  Request as BrowserRequest,
} from "@playwright/test";
import { z } from "zod";

import type { BlockedPassRequest, PassIdentity } from "./pass-cells";
import {
  learnerMcpReadTools,
  ownerMcpReadTools,
  productionTarget,
} from "./pass-config";

/**
 * Allowlist запросов production-прохода (#906). Раннер проверяет каждый запрос до отправки: Node
 * `fetch` через `createPassFetch`, запрос browser context через `passContextGet`, страницу через
 * `guardPassContext`. Разрешены чтения (GET и HEAD), MCP POST к названным read-only tools, выдача
 * playback session и закрытый перечень операций входа. Protected storage принимает только GET без
 * тела после asset-маршрута Web. Любой другой запрос раннер отклоняет и сам
 * не отправляет. Node и запросы context не идут по redirect. Шаг redirect в браузере Playwright не
 * даёт перехватить: `guardPassContext` проверяет его после отправки, и такой шаг вне allowlist
 * делает итог красным. Логику доказывает module-тест
 * `test/module/production-access-requests.test.ts`.
 */
export type PassOperation =
  /** GET или HEAD: чтение. */
  | "read"
  /** Вход Platform: BFF выпускает запрос авторизации и принимает callback. */
  | "platform-sign-in"
  /** Learner MCP: `initialize` и вызов read-only tool. */
  | "learner-mcp-read"
  /** Владельческий MCP: `initialize` и вызов read-only tool. */
  | "owner-mcp-read"
  /**
   * Playback session видео: проверка права `play` и подпись короткого JWT без записи в базу
   * (решение владельца в #906).
   */
  | "video-playback-read"
  /** Вход Logto по one-time token: четыре шага experience API Logto 1.41. */
  | "logto-sign-in"
  /** Management API Logto: поиск identity, one-time token и PAT прохода. */
  | "logto-pass-identity";

export interface PassRequest {
  readonly method: string;
  readonly url: string;
  readonly body?: string | null | undefined;
  /** Непосредственный запрос перед browser redirect; прямое чтение storage запрещено. */
  readonly redirectedFrom?: Pick<PassRequest, "method" | "url" | "body">;
}

export type PassRequestDecision =
  | { readonly allowed: true; readonly operation: PassOperation }
  | { readonly allowed: false; readonly reason: string };

/**
 * Пути Platform, которые пишут даже на GET: засчитывают переход по ссылке рассылки. Next.js
 * отвечает на HEAD обработчиком GET, поэтому путь закрыт для любого метода.
 */
const platformRecordingPaths = ["/communications/visit"];
/** PAT прохода; другие PAT пользователя проход не удаляет. */
export const passPatPrefix = "inside-production-access-";
const videoPlaybackSessions = "/api/material-video-playback-sessions";

const platformSignIn = [
  ["POST", "/auth/sign-in"],
  ["GET", "/callback"],
] as const;
/**
 * `packages/experience/src/apis/experience` Logto 1.41: вход существующего пользователя. Начало
 * взаимодействия (`PUT /api/experience`) проверяется отдельно: только `interactionEvent: SignIn`,
 * регистрация нового пользователя не проходит.
 */
const logtoSignIn = [
  ["POST", "/api/experience/verification/one-time-token/verify"],
  ["POST", "/api/experience/identification"],
  ["POST", "/api/experience/submit"],
] as const;
const passTokenGrants = [
  "client_credentials",
  "urn:ietf:params:oauth:grant-type:token-exchange",
];
const personalAccessTokens = /^\/api\/users\/[^/]+\/personal-access-tokens$/u;
const passPersonalAccessToken =
  /^\/api\/users\/[^/]+\/personal-access-tokens\/([^/]+)$/u;

const signInInteractionSchema = z.object({
  interactionEvent: z.literal("SignIn"),
});

const jsonRpcSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.object({ name: z.string().optional() }).loose().optional(),
});

export function checkPassRequest(request: PassRequest): PassRequestDecision {
  const method = request.method.toUpperCase();
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return reject("the URL is invalid");
  }
  if (url.protocol !== "https:") return reject("only HTTPS is allowed");
  const origin = url.origin;
  const path = normalizedPath(url.pathname);
  if (path === null) return reject("the path is malformed");

  if (origin === productionTarget.protectedStorage) {
    if (method !== "GET" || (request.body != null && request.body !== ""))
      return reject(
        "protected storage only allows a bodyless GET asset redirect",
      );
    const from = request.redirectedFrom;
    if (
      from?.method.toUpperCase() !== "GET" ||
      (from.body != null && from.body !== "")
    )
      return reject(
        "protected storage requires a bodyless GET from the application asset route",
      );
    let source: URL;
    try {
      source = new URL(from.url);
    } catch {
      return reject("the asset redirect source URL is invalid");
    }
    const sourcePath = normalizedPath(source.pathname);
    if (
      source.origin !== productionTarget.web ||
      sourcePath === null ||
      !/^\/api\/materials\/[^/]+\/assets\/[^/]+(?:\/images\/[0-9]+)?$/u.test(
        sourcePath,
      )
    )
      return reject(
        "protected storage requires a redirect from the application asset route",
      );
    return allow("read");
  }
  if (
    origin === productionTarget.web ||
    origin === new URL(productionTarget.ownerMcp).origin
  ) {
    if (platformRecordingPaths.includes(path))
      return reject(`${path} records a visit`);
    if (named(platformSignIn, method, path)) return allow("platform-sign-in");
    if (method === "GET" || method === "HEAD") return allow("read");
    if (method === "POST" && url.href === productionTarget.learnerMcp)
      return mcpCall(request.body, learnerMcpReadTools, "learner-mcp-read");
    if (method === "POST" && url.href === productionTarget.ownerMcp)
      return mcpCall(request.body, ownerMcpReadTools, "owner-mcp-read");
    if (method === "POST" && path === videoPlaybackSessions)
      return allow("video-playback-read");
    return reject(`${method} ${path} is not a read`);
  }
  if (origin === productionTarget.logto) {
    if (method === "PUT" && path === "/api/experience")
      return signInInteractionSchema.safeParse(parseJson(request.body)).success
        ? allow("logto-sign-in")
        : reject("the Logto interaction is not a sign-in");
    if (named(logtoSignIn, method, path)) return allow("logto-sign-in");
    if (method === "POST" && path === "/oidc/token")
      return passTokenGrants.includes(
        new URLSearchParams(request.body ?? "").get("grant_type") ?? "",
      )
        ? allow("logto-pass-identity")
        : reject("the token grant is not a pass grant");
    if (method === "GET" && path === "/api/users")
      return allow("logto-pass-identity");
    if (method === "POST" && path === "/api/one-time-tokens")
      return allow("logto-pass-identity");
    if (
      (method === "POST" || method === "GET") &&
      personalAccessTokens.test(path)
    )
      return allow("logto-pass-identity");
    const token = passPersonalAccessToken.exec(path)?.[1];
    if (method === "DELETE" && token?.startsWith(passPatPrefix) === true)
      return allow("logto-pass-identity");
    if (method === "GET" || method === "HEAD") return allow("read");
    return reject(`${method} ${path} is not a pass operation`);
  }
  return reject(`origin ${origin} is not in the pass allowlist`);
}

/**
 * Путь без кодирования, повторных и конечных `/`: `/communications/visit/` и закодированная форма —
 * тот же маршрут. `null` — путь не декодируется.
 */
function normalizedPath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const collapsed = decoded.replace(/\/{2,}/gu, "/");
  return collapsed.length > 1 ? collapsed.replace(/\/+$/u, "") : collapsed;
}

function parseJson(body: string | null | undefined): unknown {
  try {
    return JSON.parse(body ?? "") as unknown;
  } catch {
    return undefined;
  }
}

function mcpCall(
  body: string | null | undefined,
  tools: readonly string[],
  operation: "learner-mcp-read" | "owner-mcp-read",
): PassRequestDecision {
  const parsed = jsonRpcSchema.safeParse(parseJson(body));
  if (!parsed.success)
    return reject("the MCP body is not one JSON-RPC message");
  const { method, params } = parsed.data;
  if (method === "initialize" || method === "notifications/initialized")
    return allow(operation);
  if (
    method === "tools/call" &&
    params?.name !== undefined &&
    tools.includes(params.name)
  )
    return allow(operation);
  return reject(`MCP ${method} is not a named read-only tool`);
}

function named(
  operations: readonly (readonly [string, string])[],
  method: string,
  path: string,
): boolean {
  return operations.some(([m, p]) => m === method && p === path);
}

function allow(operation: PassOperation): PassRequestDecision {
  return { allowed: true, operation };
}

function reject(reason: string): PassRequestDecision {
  return { allowed: false, reason };
}

export class PassRequestRejected extends Error {
  constructor(method: string, url: string, reason: string) {
    super(
      `Production access pass rejected ${method} ${new URL(url).pathname}: ${reason}`,
    );
    this.name = "PassRequestRejected";
  }
}

/** Чтения, которые проход повторяет при обрыве сети: повтор ничего не меняет в production. */
const retriedOperations: readonly PassOperation[] = [
  "read",
  "learner-mcp-read",
  "owner-mcp-read",
];
/** Сеть до production иногда обрывается: чтение повторяется два раза с паузой. */
const transportRetries = 2;
const transportRetryPauseMs = 3_000;

function permit(method: string, url: string, body?: string | null) {
  const decision = checkPassRequest({ method, url, body });
  if (!decision.allowed)
    throw new PassRequestRejected(method, url, decision.reason);
  return decision.operation;
}

/**
 * Повторяет только обрыв транспорта, когда ответа нет. Полученный ответ, в том числе ошибка HTTP,
 * возвращается как есть.
 */
async function withTransportRetries<T>(
  operation: PassOperation,
  send: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      if (
        !retriedOperations.includes(operation) ||
        attempt >= transportRetries ||
        error instanceof PassRequestRejected
      )
        throw error;
      await new Promise((resolve) =>
        // deterministic-test-allow duration-wait: Transport backoff schedules the next request; the request response is the observed fact.
        setTimeout(resolve, transportRetryPauseMs),
      );
    }
  }
}

/** Граница одной попытки запроса прохода; повтор получает новую. */
const requestTimeoutMs = 30_000;

/**
 * `fetch` прохода: запрос вне allowlist отклоняется до отправки. Redirect не исполняется: иначе
 * запрос ушёл бы по адресу, который allowlist не видел. Ответ 3xx возвращается как есть.
 */
export function createPassFetch(send: typeof fetch = fetch) {
  return async (
    url: string,
    init: Omit<RequestInit, "signal" | "redirect"> & {
      readonly body?: string;
    } = {},
  ): Promise<Response> => {
    const operation = permit(init.method ?? "GET", url, init.body);
    return withTransportRetries(operation, () =>
      send(url, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(requestTimeoutMs),
      }),
    );
  };
}

export const passFetch = createPassFetch();

/**
 * GET под cookies browser context без перехода по redirect: проход видит сам ответ Platform,
 * например redirect закрытого файла на хранилище.
 */
export async function passContextGet(
  context: BrowserContext,
  path: string,
): Promise<APIResponse> {
  const url = new URL(path, productionTarget.web).href;
  const operation = permit("GET", url);
  return withTransportRetries(operation, () =>
    context.request.get(url, { maxRedirects: 0 }),
  );
}

/**
 * Browser context прохода: каждый запрос страницы проходит allowlist, отклонённый прерывается и не
 * уходит. Страница может сама слать записи, например прогресс чтения; их перечень `blocked`
 * попадает в отчёт. Шаг redirect route не видит: он проверяется после отправки и при отказе
 * попадает в `blocked` с `sent: true`, а отчёт тогда красный. Identity принадлежит context;
 * клетка закрепляется за страницей при её создании, поэтому поздний запрос не меняет клетку.
 */
export async function guardPassContext(
  context: BrowserContext,
  blocked: BlockedPassRequest[],
  scope: {
    readonly identity: PassIdentity | "anonymous";
    readonly currentCellId?: () => string | undefined;
  },
): Promise<void> {
  const pageCells = new WeakMap<Page, string>();
  context.on("page", (page) => {
    const cellId = scope.currentCellId?.();
    if (cellId !== undefined) pageCells.set(page, cellId);
  });
  function attribution(request: BrowserRequest) {
    let cellId: string | undefined;
    try {
      cellId = pageCells.get(request.frame().page());
    } catch {
      // Service workers and requests without a frame still belong to this identity.
    }
    return {
      identity: scope.identity,
      ...(cellId === undefined ? {} : { cellId }),
    };
  }

  context.on("request", (request) => {
    if (request.redirectedFrom() === null) return;
    const decision = checkPassRequest(browserPassRequest(request));
    if (decision.allowed) return;
    const url = new URL(request.url());
    blocked.push({
      ...attribution(request),
      method: request.method(),
      target: `${url.origin}${url.pathname}`,
      reason: `redirect step: ${decision.reason}`,
      sent: true,
    });
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const decision = checkPassRequest(browserPassRequest(request));
    if (decision.allowed) return route.continue();
    const url = new URL(request.url());
    blocked.push({
      ...attribution(request),
      method: request.method(),
      target: `${url.origin}${url.pathname}`,
      reason: decision.reason,
    });
    return route.abort("blockedbyclient");
  });
}

/** Redirect provenance comes from Playwright, never from page-controlled headers. */
function browserPassRequest(request: BrowserRequest): PassRequest {
  const from = request.redirectedFrom();
  return {
    method: request.method(),
    url: request.url(),
    body: request.postData(),
    ...(from === null
      ? {}
      : {
          redirectedFrom: {
            method: from.method(),
            url: from.url(),
            body: from.postData(),
          },
        }),
  };
}

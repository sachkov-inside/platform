import { PersistKey, wrapSession } from "@logto/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseLogtoBffConfig } from "@/shared/auth/logto-bff-config.server";
import { getPlatformAccessTokenRsc } from "@/shared/auth/platform-access-token.server";

/**
 * Настоящий SDK Logto обновляет токен по refresh grant (#1005). Подменены только граница cookie
 * Next.js и сеть: синтетическая ошибка SDK скрыла, что настоящий отказ провайдера приходит не тем
 * кодом. Discovery SDK кеширует в памяти модуля по адресу провайдера, поэтому все случаи делят
 * один `endpoint` и один ответ discovery.
 */
const cookieJar = vi.hoisted(() => new Map<string, string>());
const cookieWrites = vi.hoisted(
  () => [] as { name: string; value: string; maxAge: number | undefined }[],
);
const refreshGrants = vi.hoisted(() => ({ count: 0 }));
const backend = vi.hoisted(() => ({
  requestMaterialAuthoringReferences: vi.fn(),
  resolveAccount: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = cookieJar.get(name);
        return value === undefined ? undefined : { name, value };
      },
      getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
      set: (name: string, value: string, options?: { maxAge?: number }) => {
        cookieWrites.push({ name, value, maxAge: options?.maxAge });
        cookieJar.set(name, value);
      },
    }),
}));

vi.mock("@/shared/api/backend/index.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...backend,
}));

const endpoint = "https://identity.example.test";
const config = parseLogtoBffConfig(
  {
    PLATFORM_RELEASE_VERSION: "v7",
    PLATFORM_SOURCE_SHA: "7".repeat(40),
    NODE_ENV: "production",
    BACKEND_BASE_URL: "https://api-internal.example.test",
    LOGTO_ENDPOINT: endpoint,
    LOGTO_AUDIENCE: "https://api.example.test",
    LOGTO_APP_ID: "inside-web",
    LOGTO_APP_SECRET: "inside-web-confidential-secret",
    LOGTO_COOKIE_SECRET: "logto-refresh-grant-test-cookie-secret",
    WEB_BASE_URL: "https://inside.example.test",
  },
  { release: "v7", sourceSha: "7".repeat(40) },
);

vi.mock("@/shared/auth/logto-bff-config.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readLogtoBffConfig: () => config,
}));

import { GET as accountPresentation } from "../../app/api/account/route";
import { GET as authStatus } from "../../app/auth/status/route";

const sessionCookie = `logto_${config.appId}`;
const providerCanary = "provider-payload-canary-1005";
const discovery = {
  issuer: `${endpoint}/oidc`,
  authorization_endpoint: `${endpoint}/oidc/auth`,
  token_endpoint: `${endpoint}/oidc/token`,
  userinfo_endpoint: `${endpoint}/oidc/me`,
  end_session_endpoint: `${endpoint}/oidc/session/end`,
  revocation_endpoint: `${endpoint}/oidc/token/revocation`,
  jwks_uri: `${endpoint}/oidc/jwks`,
};

/** Сессия с истёкшим access token: следующий запрос идёт к провайдеру по refresh grant. */
async function storeSessionNeedingRefresh(): Promise<string> {
  const session = await wrapSession(
    {
      [PersistKey.IdToken]: "id-token-without-cached-access-token",
      [PersistKey.RefreshToken]: `refresh-token-${providerCanary}`,
    },
    config.cookieSecret,
  );
  cookieJar.set(sessionCookie, session);
  return session;
}

function answerRefreshGrantWith(answer: () => Promise<Response>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === "/oidc/.well-known/openid-configuration")
        return Response.json(discovery);
      if (url.pathname === "/oidc/token") {
        const form = new URLSearchParams(await request.text());
        expect(form.get("grant_type")).toBe("refresh_token");
        refreshGrants.count += 1;
        return answer();
      }
      return new Response(null, { status: 404 });
    }),
  );
}

const rejectedGrants = [
  [
    // Ответ fork Logto, записанный изолированной proof на настоящем token endpoint (#992).
    "Logto fork",
    {
      code: "oidc.invalid_grant",
      message: `grant request is invalid ${providerCanary}`,
      error: "invalid_grant",
      error_description: `grant request is invalid ${providerCanary}`,
    },
  ],
  [
    "plain OAuth 2.0",
    {
      error: "invalid_grant",
      error_description: `grant request is invalid ${providerCanary}`,
    },
  ],
] as const;

const providerFailures = [
  ["network failure", () => Promise.reject(new TypeError("fetch failed"))],
  [
    "provider 503 without a body",
    () => Promise.resolve(new Response(null, { status: 503 })),
  ],
  [
    "Logto fork server error",
    () =>
      Promise.resolve(
        Response.json(
          { code: "oidc.server_error", message: providerCanary },
          { status: 500 },
        ),
      ),
  ],
  [
    "OAuth temporarily_unavailable",
    () =>
      Promise.resolve(
        Response.json(
          {
            error: "temporarily_unavailable",
            error_description: providerCanary,
          },
          { status: 503 },
        ),
      ),
  ],
  [
    "OAuth invalid_client",
    () =>
      Promise.resolve(
        Response.json(
          { error: "invalid_client", error_description: providerCanary },
          { status: 401 },
        ),
      ),
  ],
] as const;

beforeEach(() => {
  // SDK пишет тело отказа в свой журнал; проверка смотрит на ответы BFF, а не на журнал SDK.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cookieJar.clear();
  cookieWrites.length = 0;
  refreshGrants.count = 0;
});

describe.each(rejectedGrants)(
  "a refresh grant rejected by the provider (%s)",
  (_name, body) => {
    beforeEach(() => {
      answerRefreshGrantWith(() =>
        Promise.resolve(Response.json(body, { status: 400 })),
      );
    });

    it("reports a guest and removes the BFF session cookie", async () => {
      await storeSessionNeedingRefresh();

      const response = await authStatus();

      const text = await response.text();
      expect(JSON.parse(text)).toEqual({
        accountId: null,
        canManageMaterials: false,
        state: "guest",
      });
      expect(text).not.toContain(providerCanary);
      expect(cookieWrites).toEqual([
        { name: sessionCookie, value: "", maxAge: 0 },
      ]);
      expect(backend.resolveAccount).not.toHaveBeenCalled();
    });

    it("closes the Account with 401 and removes the BFF session cookie", async () => {
      await storeSessionNeedingRefresh();

      const response = await accountPresentation();

      expect(response.status).toBe(401);
      expect(await response.text()).toBe("");
      expect(response.headers.get("cache-control")).toBe("no-store, private");
      expect(cookieWrites).toEqual([
        { name: sessionCookie, value: "", maxAge: 0 },
      ]);
    });

    it("removes the cookie in every request that shared one refresh", async () => {
      await storeSessionNeedingRefresh();

      const [status, account] = await Promise.all([
        authStatus(),
        accountPresentation(),
      ]);

      await expect(status.json()).resolves.toMatchObject({ state: "guest" });
      expect(account.status).toBe(401);
      expect(refreshGrants.count).toBe(1);
      expect(cookieWrites).toEqual([
        { name: sessionCookie, value: "", maxAge: 0 },
        { name: sessionCookie, value: "", maxAge: 0 },
      ]);
    });

    it("treats a server render as a guest without writing cookies", async () => {
      await storeSessionNeedingRefresh();

      await expect(getPlatformAccessTokenRsc(config)).rejects.toMatchObject({
        name: "LogtoSessionUnavailableError",
      });
      expect(cookieWrites).toEqual([]);
    });
  },
);

describe.each(providerFailures)(
  "a refresh grant that meets a %s",
  (_name, answer) => {
    beforeEach(() => {
      answerRefreshGrantWith(answer);
    });

    it("keeps the status unavailable and the BFF session cookie", async () => {
      const session = await storeSessionNeedingRefresh();

      const response = await authStatus();

      const text = await response.text();
      expect(JSON.parse(text)).toEqual({
        accountId: null,
        canManageMaterials: false,
        state: "unavailable",
      });
      expect(text).not.toContain(providerCanary);
      expect(cookieWrites).toEqual([]);
      expect(cookieJar.get(sessionCookie)).toBe(session);
    });

    it("keeps the Account closed with 503", async () => {
      await storeSessionNeedingRefresh();

      const response = await accountPresentation();

      expect(response.status).toBe(503);
      expect(await response.text()).toBe("");
      expect(cookieWrites).toEqual([]);
    });
  },
);

import { cookies } from "next/headers";
import { realBffSession } from "../support/real-bff-session";
import { useProductionRuntimeImage } from "../support/web-runtime";
import { PersistKey, wrapSession } from "@logto/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseLogtoBffConfig } from "@/shared/auth/logto-bff-config.server";
import { getPlatformAccessTokenRsc } from "@/shared/auth/platform-access-token.server";

const unexpectedCookieWrites: unknown[][] = [];
const cookieWrites: {
  name: string;
  value: string;
  maxAge: number | undefined;
}[] = [];
let refreshGrants: { count: number };
const unexpectedRequests: Request[] = [];
const identityRequests: Request[] = [];
const tokenForms: URLSearchParams[] = [];
const observedSessions: (string | undefined)[] = [];
let sessionValue: string;
let scope: Awaited<ReturnType<typeof realBffSession>>;
let releaseImage: () => void;
async function withSession<T>(run: () => Promise<T>): Promise<T> {
  return scope(async () => {
    const jar = await cookies();
    jar.set(sessionCookie, sessionValue);
    const writes = vi.spyOn(jar, "set");
    try {
      return await run();
    } finally {
      for (const args of writes.mock.calls) {
        const [name, value, options] = args;
        if (typeof name === "string" && typeof value === "string")
          cookieWrites.push({ name, value, maxAge: options?.maxAge });
        else if (typeof name === "object")
          cookieWrites.push({
            name: name.name,
            value: name.value,
            maxAge: name.maxAge,
          });
        else unexpectedCookieWrites.push(args);
      }
      observedSessions.push(jar.get(sessionCookie)?.value);
      writes.mockRestore();
    }
  });
}

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
  sessionValue = session;
  return session;
}

function answerRefreshGrantWith(answer: () => Promise<Response>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      identityRequests.push(request);
      if (
        request.url ===
        "https://identity.example.test/oidc/.well-known/openid-configuration"
      )
        return Response.json(discovery);
      if (request.url === "https://identity.example.test/oidc/token") {
        const form = new URLSearchParams(await request.text());
        tokenForms.push(form);
        refreshGrants.count += 1;
        return answer();
      }
      unexpectedRequests.push(request);
      throw new Error(
        `Unexpected external request ${request.method} ${request.url}`,
      );
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

beforeEach(async () => {
  refreshGrants = { count: 0 };
  vi.setSystemTime(new Date("2030-03-01T12:00:00.000Z"));
  scope = await realBffSession(null);
  releaseImage = useProductionRuntimeImage();
  vi.stubEnv("NODE_ENV", "production");
  for (const [name, value] of Object.entries({
    BACKEND_BASE_URL: "https://api-internal.example.test",
    LOGTO_ENDPOINT: endpoint,
    LOGTO_AUDIENCE: "https://api.example.test",
    LOGTO_APP_ID: "inside-web",
    LOGTO_APP_SECRET: "inside-web-confidential-secret",
    LOGTO_COOKIE_SECRET: "logto-refresh-grant-test-cookie-secret",
    WEB_BASE_URL: "https://inside.example.test",
  }))
    vi.stubEnv(name, value);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  try {
    expect(unexpectedRequests).toEqual([]);
    expect(unexpectedCookieWrites).toEqual([]);
    for (const request of identityRequests) {
      expect([
        "https://identity.example.test/oidc/.well-known/openid-configuration",
        "https://identity.example.test/oidc/token",
      ]).toContain(request.url);
      expect(request.method).toBe(
        request.url.endsWith("/token") ? "POST" : "GET",
      );
    }
    for (const form of tokenForms) {
      expect(form.get("grant_type")).toBe("refresh_token");
      expect(form.get("refresh_token")).toBe(
        "refresh-token-provider-payload-canary-1005",
      );
      expect(form.get("resource")).toBe("https://api.example.test");
    }
  } finally {
    cookieWrites.length = 0;
    unexpectedCookieWrites.length = 0;
    unexpectedRequests.length = 0;
    identityRequests.length = 0;
    tokenForms.length = 0;
    observedSessions.length = 0;
    releaseImage();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
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

      const response = await withSession(authStatus);

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
      expect(unexpectedRequests).toEqual([]);
    });

    it("closes the Account with 401 and removes the BFF session cookie", async () => {
      await storeSessionNeedingRefresh();

      const response = await withSession(accountPresentation);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        kind: "authentication_required",
      });
      expect(response.headers.get("cache-control")).toBe("no-store, private");
      expect(cookieWrites).toEqual([
        { name: sessionCookie, value: "", maxAge: 0 },
      ]);
    });

    it("removes the cookie in every request that shared one refresh", async () => {
      await storeSessionNeedingRefresh();

      const [status, account] = await Promise.all([
        withSession(authStatus),
        withSession(accountPresentation),
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

      await expect(
        withSession(() => getPlatformAccessTokenRsc(config)),
      ).rejects.toMatchObject({
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

      const response = await withSession(authStatus);

      const text = await response.text();
      expect(JSON.parse(text)).toEqual({
        accountId: null,
        canManageMaterials: false,
        state: "unavailable",
      });
      expect(text).not.toContain(providerCanary);
      expect(cookieWrites).toEqual([]);
      expect(observedSessions).toEqual([session]);
    });

    it("keeps the Account closed with 503", async () => {
      await storeSessionNeedingRefresh();

      const response = await withSession(accountPresentation);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ kind: "identity_unavailable" });
      expect(cookieWrites).toEqual([]);
    });
  },
);

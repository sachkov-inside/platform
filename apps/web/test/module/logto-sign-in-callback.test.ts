import { afterEach, expect, it, vi } from "vitest";

import { AudienceBoundLogtoClient } from "@/shared/auth/audience-bound-logto-client.server";
import { parseLogtoBffConfig } from "@/shared/auth/index.server";

/**
 * Настоящий SDK Logto без подмены: регрессию #766 пропустила проверка, которая подменяла SDK и
 * видела только наш `createNodeClient`, а `@logto/next` 4.2.11 создаёт клиент обратного вызова в
 * обход него. Здесь подменены только граница cookie Next.js и сеть.
 */
const cookieJar = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = cookieJar.get(name);
        return value === undefined ? undefined : { name, value };
      },
      set: (name: string, value: string) => {
        cookieJar.set(name, value);
      },
    }),
}));

const endpoint = "https://identity.example.test";
const audience = "https://api.example.test";
const webBaseUrl = "https://inside.example.test";

const config = parseLogtoBffConfig(
  {
    PLATFORM_RELEASE_VERSION: "v7",
    PLATFORM_SOURCE_SHA: "7".repeat(40),
    NODE_ENV: "production",
    BACKEND_BASE_URL: "https://api-internal.example.test",
    LOGTO_ENDPOINT: endpoint,
    LOGTO_AUDIENCE: audience,
    LOGTO_APP_ID: "inside-web",
    LOGTO_APP_SECRET: "inside-web-confidential-secret",
    LOGTO_COOKIE_SECRET: "logto-callback-test-cookie-secret-32chars",
    WEB_BASE_URL: webBaseUrl,
  },
  { release: "v7", sourceSha: "7".repeat(40) },
);

const discovery = {
  issuer: `${endpoint}/oidc`,
  authorization_endpoint: `${endpoint}/oidc/auth`,
  token_endpoint: `${endpoint}/oidc/token`,
  userinfo_endpoint: `${endpoint}/oidc/me`,
  end_session_endpoint: `${endpoint}/oidc/session/end`,
  revocation_endpoint: `${endpoint}/oidc/token/revocation`,
  jwks_uri: `${endpoint}/oidc/jwks`,
};

afterEach(() => {
  cookieJar.clear();
  vi.unstubAllGlobals();
});

it("обмен кода на обратном вызове просит токен для API Platform", async () => {
  const tokenRequests: URLSearchParams[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/oidc/.well-known/openid-configuration")
        return Promise.resolve(Response.json(discovery));
      if (url.pathname === "/oidc/token") {
        tokenRequests.push(
          new URLSearchParams(typeof init?.body === "string" ? init.body : ""),
        );
        // Тело запроса уже записано; дальше обмен не нужен, и SDK получает отказ провайдера.
        return Promise.resolve(
          Response.json({ error: "invalid_grant" }, { status: 400 }),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }),
  );
  const client = new AudienceBoundLogtoClient(config);
  const redirectUri = `${webBaseUrl}/callback`;
  const { url } = await client.handleSignIn({ redirectUri });
  const state = new URL(url).searchParams.get("state");
  if (state === null) throw new Error("Вход не записал сессию со state");
  const callback = new URL(redirectUri);
  callback.searchParams.set("code", "opaque");
  callback.searchParams.set("state", state);

  await expect(client.handleSignInCallback(callback.href)).rejects.toThrow();

  expect(tokenRequests).toHaveLength(1);
  expect(tokenRequests[0]?.get("grant_type")).toBe("authorization_code");
  expect(tokenRequests[0]?.get("resource")).toBe(audience);
});

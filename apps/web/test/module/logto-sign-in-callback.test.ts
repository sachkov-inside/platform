import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { realBffSession } from "../support/real-bff-session";

import { AudienceBoundLogtoClient } from "@/shared/auth/audience-bound-logto-client.server";
import { parseLogtoBffConfig } from "@/shared/auth/index.server";

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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

it("обмен кода на обратном вызове просит токен для API Platform", async () => {
  const tokenRequests: { request: Request; body: URLSearchParams }[] = [];
  const unexpectedRequests: string[] = [];
  const discoveryRequests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (
        url.href === `${endpoint}/oidc/.well-known/openid-configuration` &&
        request.method === "GET"
      ) {
        discoveryRequests.push(request);
        return Response.json(discovery);
      }
      if (url.href === `${endpoint}/oidc/token` && request.method === "POST") {
        tokenRequests.push({
          request,
          body: new URLSearchParams(await request.text()),
        });
        return Promise.resolve(
          Response.json({ error: "invalid_grant" }, { status: 400 }),
        );
      }
      unexpectedRequests.push(`${request.method} ${request.url}`);
      throw new Error("Unexpected external identity request");
    }),
  );
  const scope = await realBffSession(null);
  await scope(async () => {
    const client = new AudienceBoundLogtoClient(config);
    const redirectUri = `${webBaseUrl}/callback`;
    const { url } = await client.handleSignIn({ redirectUri });
    const state = new URL(url).searchParams.get("state");
    if (state === null) throw new Error("Вход не записал сессию со state");
    const callback = new URL(redirectUri);
    callback.searchParams.set("code", "opaque");
    callback.searchParams.set("state", state);

    await expect(client.handleSignInCallback(callback.href)).rejects.toThrow();
  });

  expect(unexpectedRequests).toEqual([]);
  expect(discoveryRequests).toHaveLength(1);

  expect(tokenRequests).toHaveLength(1);
  expect(tokenRequests[0]?.request.url).toBe(
    "https://identity.example.test/oidc/token",
  );
  expect(tokenRequests[0]?.request.method).toBe("POST");
  expect(tokenRequests[0]?.body.get("grant_type")).toBe("authorization_code");
  expect(tokenRequests[0]?.body.get("resource")).toBe(audience);
});

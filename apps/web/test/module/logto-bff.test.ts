import { describe, expect, it, vi } from "vitest";

import { AudienceBoundLogtoClient } from "@/shared/auth/audience-bound-logto-client.server";

import {
  bindAuthorizationCodeResource,
  clearLogtoSessionCookie,
  hasLogtoSessionCookie,
  isSameOriginMutation,
  logtoSessionCookieName,
  parseLogtoBffConfig,
} from "@/shared/auth/index.server";

const secret = "logto-bff-test-cookie-secret-32characters";
const sdkFake = vi.hoisted<{ nodeClient: unknown }>(() => ({
  nodeClient: undefined,
}));
const cookieSet = vi.hoisted(() => vi.fn());

vi.mock("@logto/next/server-actions", () => ({
  default: class LogtoClient {
    createNodeClient() {
      return Promise.resolve(sdkFake.nodeClient);
    }
  },
  getAccessToken: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve({ set: cookieSet })),
}));

describe("Logto BFF configuration", () => {
  it("pins one issuer, callback, audience and secure cookie boundary", () => {
    const config = parseLogtoBffConfig({
      NODE_ENV: "production",
      BACKEND_BASE_URL: "https://api-internal.example.test",
      LOGTO_ENDPOINT: "https://identity.example.test",
      LOGTO_AUDIENCE: "https://api.example.test",
      LOGTO_APP_ID: "inside-web",
      LOGTO_APP_SECRET: "inside-web-confidential-secret",
      LOGTO_COOKIE_SECRET: secret,
      WEB_BASE_URL: "https://inside.example.test",
    });

    expect(config).toEqual({
      endpoint: "https://identity.example.test",
      appId: "inside-web",
      appSecret: "inside-web-confidential-secret",
      cookieSecret: secret,
      cookieSecure: true,
      baseUrl: "https://inside.example.test",
      audience: "https://api.example.test",
      resources: ["https://api.example.test"],
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.resources)).toBe(true);
  });

  it("fails production closed when confidential configuration is absent", () => {
    expect(() =>
      parseLogtoBffConfig({
        NODE_ENV: "production",
        BACKEND_BASE_URL: "https://api-internal.example.test",
      }),
    ).toThrow("LOGTO_ENDPOINT is required in production mode");
  });

  it("binds the exact API audience only to the authorization-code exchange", () => {
    const authorizationCode = bindAuthorizationCodeResource(
      {
        method: "POST",
        body: "grant_type=authorization_code&code=opaque",
      },
      "https://api.example.test",
    );
    if (typeof authorizationCode?.body !== "string") {
      throw new TypeError("Authorization-code body must remain form encoded");
    }
    expect(new URLSearchParams(authorizationCode.body)).toEqual(
      new URLSearchParams(
        "grant_type=authorization_code&code=opaque&resource=https%3A%2F%2Fapi.example.test",
      ),
    );

    const refresh = { method: "POST", body: "grant_type=refresh_token" };
    expect(
      bindAuthorizationCodeResource(refresh, "https://api.example.test"),
    ).toBe(refresh);

    const searchParams = bindAuthorizationCodeResource(
      {
        method: "POST",
        body: new URLSearchParams("grant_type=authorization_code&code=opaque"),
      },
      "https://api.example.test",
    );
    expect(new URLSearchParams(searchParams?.body as string).get("resource")).toBe(
      "https://api.example.test",
    );
  });

  it("wires the audience binding into the pinned SDK requester", async () => {
    const requester = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    sdkFake.nodeClient = { adapter: { requester } };
    const config = parseLogtoBffConfig({
      NODE_ENV: "production",
      BACKEND_BASE_URL: "https://api-internal.example.test",
      LOGTO_ENDPOINT: "https://identity.example.test",
      LOGTO_AUDIENCE: "https://api.example.test",
      LOGTO_APP_ID: "inside-web",
      LOGTO_APP_SECRET: "inside-web-confidential-secret",
      LOGTO_COOKIE_SECRET: secret,
      WEB_BASE_URL: "https://inside.example.test",
    });
    const client = new AudienceBoundLogtoClient(config);
    const created = await client.createNodeClient();

    await created.adapter.requester("https://identity.example.test/oidc/token", {
      method: "POST",
      body: "grant_type=authorization_code&code=opaque",
    });

    expect(requester).toHaveBeenCalledOnce();
    const init = requester.mock.calls[0]?.[1];
    expect(typeof init?.body).toBe("string");
    expect(new URLSearchParams(init?.body as string).get("resource")).toBe(
      "https://api.example.test",
    );
  });

  it("derives the SDK cookie key and accepts only same-origin mutations", () => {
    expect(logtoSessionCookieName("inside-web")).toBe("logto_inside-web");
    expect(hasLogtoSessionCookie(["theme", "logto_inside-web"], "inside-web")).toBe(true);
    expect(hasLogtoSessionCookie(["theme", "logto_previous-app"], "inside-web")).toBe(false);
    expect(hasLogtoSessionCookie(["theme", "logto_"], "inside-web")).toBe(false);
    expect(
      isSameOriginMutation(
        new Request("https://inside.example.test/auth/sign-in", {
          method: "POST",
          headers: { origin: "https://inside.example.test" },
        }),
        "https://inside.example.test",
      ),
    ).toBe(true);
    expect(
      isSameOriginMutation(
        new Request("https://inside.example.test/auth/sign-in", {
          method: "POST",
          headers: { origin: "https://attacker.example.test" },
        }),
        "https://inside.example.test",
      ),
    ).toBe(false);
    expect(
      isSameOriginMutation(
        new Request("https://inside.example.test/auth/sign-in", { method: "POST" }),
        "https://inside.example.test",
      ),
    ).toBe(false);
  });

  it("clears the provider cookie through one security definition", async () => {
    await clearLogtoSessionCookie({ appId: "inside-web", cookieSecure: true });

    expect(cookieSet).toHaveBeenCalledWith("logto_inside-web", "", {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: true,
      expires: new Date(0),
      maxAge: 0,
    });
  });
});

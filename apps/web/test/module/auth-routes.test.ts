import "next/dist/server/node-environment";
// deterministic-test-allow unit-io: #2292, audit2 worker 7e1496b5 owns this real SDK JWKS adapter contract; the server binds only owned loopback, uses the test budget and closes in afterAll.
import { createServer } from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";
import { PersistKey, wrapSession } from "@logto/node";
import { cookies } from "next/headers";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { StaticGenBailoutError } from "next/dist/client/components/static-generation-bailout";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { realBffSession } from "../support/real-bff-session";
import { useProductionRuntimeImage } from "../support/web-runtime";
import { AudienceBoundLogtoClient } from "@/shared/auth/audience-bound-logto-client.server";
import * as auth from "@/shared/auth/index.server";
import * as platformSession from "@/shared/auth/platform-access-token.server";
import {
  signWaitlistIntent,
  verifyWaitlistIntent,
  WAITLIST_INTENT_COOKIE,
} from "@/features/product-waitlist/model/product-waitlist-intent";
import { GET as readAccountEmail } from "../../app/api/account/email/route";
import { POST as signIn } from "../../app/auth/sign-in/route";
import { POST as signOut } from "../../app/auth/sign-out/route";
import { GET as authStatus } from "../../app/auth/status/route";
import { GET as callback } from "../../app/callback/route";

vi.unmock("next/server");

const authInstant = "2030-03-01T12:00:00Z";
const cookieSecret = "inside-web-cookie-secret-with-32-chars";
const sessionCookie = "logto_inside-web";
let cookieClear: MockInstance;
const expectedCookieConfig = {
  endpoint: "https://identity.example.test",
  appId: "inside-web",
  appSecret: "inside-web-confidential-secret",
  audience: "https://api.example.test",
  cookieSecret: "inside-web-cookie-secret-with-32-chars",
  cookieSecure: true,
  baseUrl: "https://inside.example.test",
  resources: ["https://api.example.test"],
  scopes: ["email"],
};
const accountId = "72000000-0000-4000-8000-000000000001";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "auth-routes-test",
  alg: "RS256",
  use: "sig",
};
let scope: Awaited<ReturnType<typeof realBffSession>>;
let releaseImage: () => void;
let identityOrigin: string;
let providerFailure: Error | undefined;
let grantGate: Promise<void> | undefined;
let grantStarted: () => void;
const codeNonces = new Map<string, string>();
let jwksUri: string;
const jwksRequests: { method: string | undefined; path: string | undefined }[] =
  [];
const keyServer = createServer((request, response) => {
  jwksRequests.push({ method: request.method, path: request.url });
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ keys: [jwk] }));
});
beforeAll(async () => {
  await new Promise<void>((resolve) =>
    keyServer.listen(0, "127.0.0.1", resolve),
  );
  const address = keyServer.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected owned JWKS port");
  jwksUri = `http://127.0.0.1:${String(address.port)}/oidc/jwks`;
});
afterAll(async () => {
  keyServer.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    keyServer.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    }),
  );
});
let accountMode: "ready" | "establish" | "offline" | "conflict";
let authoringAllowed: boolean;
const identityRequests: Request[] = [];
const backendRequests: Request[] = [];
const tokenForms: URLSearchParams[] = [];
const unexpectedRequests: string[] = [];

function signedIdentityToken(nonce: string): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "RS256", kid: "auth-routes-test" })}.${encode({ iss: `${identityOrigin}/oidc`, aud: "inside-web", sub: "synthetic-logto-user", nonce, iat: 1_898_596_800, exp: 1_898_600_400 })}`;
  return `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`;
}
function accountProblem(code: "account_not_found" | "identity_conflict") {
  return Response.json(
    {
      code,
      detail: "Account request could not be completed.",
      status: code === "account_not_found" ? 401 : 409,
      title:
        code === "account_not_found"
          ? "Account verification failed"
          : "Account identity conflict",
      type: `urn:inside:problem:${code}`,
    },
    { status: code === "account_not_found" ? 401 : 409 },
  );
}
async function externalFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === identityOrigin) {
    identityRequests.push(request);
    if (providerFailure !== undefined) throw providerFailure;
    if (
      request.url === `${identityOrigin}/oidc/.well-known/openid-configuration`
    )
      return Response.json({
        issuer: `${identityOrigin}/oidc`,
        authorization_endpoint: `${identityOrigin}/oidc/auth`,
        token_endpoint: `${identityOrigin}/oidc/token`,
        jwks_uri: jwksUri,
        userinfo_endpoint: `${identityOrigin}/oidc/me`,
        end_session_endpoint: `${identityOrigin}/oidc/session/end`,
        revocation_endpoint: `${identityOrigin}/oidc/token/revocation`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    if (request.url === `${identityOrigin}/oidc/jwks`)
      return Response.json({ keys: [jwk] });
    if (request.url === `${identityOrigin}/oidc/token`) {
      const form = new URLSearchParams(await request.text());
      tokenForms.push(form);
      grantStarted();
      await grantGate;
      if (form.get("grant_type") === "refresh_token" && !form.has("resource")) {
        return Response.json({
          access_token: "identity-account-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid email",
        });
      }
      return Response.json({
        access_token: "platform-access-token",
        refresh_token: "synthetic-refresh-token",
        id_token: signedIdentityToken(
          codeNonces.get(form.get("code") ?? "") ?? "",
        ),
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid offline_access email",
      });
    }
    if (url.pathname === "/api/my-account/first-email") {
      return request.headers.get("authorization") ===
        "Bearer identity-account-token"
        ? Response.json({ email: null })
        : Response.json({ code: "auth.unauthorized" }, { status: 401 });
    }
  } else if (url.origin === "https://api.example.test") {
    backendRequests.push(request);
    if (
      request.method === "GET" &&
      request.url === "https://api.example.test/accounts/current"
    ) {
      if (accountMode === "offline")
        throw new Error("External backend unavailable");
      return accountMode === "ready"
        ? Response.json({ account: { accountId } })
        : accountProblem("account_not_found");
    }
    if (
      request.method === "POST" &&
      request.url === "https://api.example.test/accounts"
    ) {
      if (accountMode === "conflict")
        return accountProblem("identity_conflict");
      accountMode = "ready";
      return Response.json({ account: { accountId } }, { status: 201 });
    }
    if (
      request.method === "GET" &&
      request.url === "https://api.example.test/authoring/materials/references"
    )
      return Response.json(
        { formats: [], products: [], tags: [], topics: [] },
        { status: authoringAllowed ? 200 : 403 },
      );
    if (
      request.method === "GET" &&
      request.url ===
        "https://api.example.test/accounts/current/legal-acceptances/terms"
    )
      return Response.json({
        ok: true,
        accepted: true,
        previouslyAccepted: true,
        document: {
          documentId: "terms",
          version: "1",
          digest: "a".repeat(64),
          url: "https://inside.example.test/legal/terms",
        },
      });
  }
  unexpectedRequests.push(`${request.method} ${request.url}`);
  throw new Error(
    `Unexpected external request ${request.method} ${request.url}`,
  );
}

function browserSession(initial?: ReadonlyMap<string, string>) {
  const jar = new Map(initial);
  const changed: { name: string; value: string; maxAge?: number }[] = [];
  return {
    jar,
    changed,
    run<T>(action: () => Promise<T>): Promise<T> {
      return scope(async () => {
        const store = await cookies();
        for (const [name, value] of jar) store.set(name, value);
        try {
          return await action();
        } finally {
          for (const cookie of store.getAll()) {
            const maxAge =
              "maxAge" in cookie && typeof cookie.maxAge === "number"
                ? cookie.maxAge
                : undefined;
            const original = jar.get(cookie.name);
            if (original !== cookie.value)
              changed.push({
                name: cookie.name,
                value: cookie.value,
                ...(maxAge === undefined ? {} : { maxAge }),
              });
            if (maxAge === 0 || cookie.value === "") jar.delete(cookie.name);
            else jar.set(cookie.name, cookie.value);
          }
        }
      });
    },
  };
}
type Browser = ReturnType<typeof browserSession>;
function formRequest(path: string, values?: Readonly<Record<string, string>>) {
  return new Request(`https://inside.example.test${path}`, {
    method: "POST",
    headers: {
      origin: "https://inside.example.test",
      ...(values === undefined
        ? {}
        : { "content-type": "application/x-www-form-urlencoded" }),
    },
    ...(values === undefined ? {} : { body: new URLSearchParams(values) }),
  });
}
async function begin(
  browser: Browser,
  values?: Readonly<Record<string, string>>,
) {
  const response = await browser.run(() =>
    signIn(formRequest("/auth/sign-in", values)),
  );
  const text = await response.text();
  const href = /<a href="([^"]+)"/u.exec(text)?.[1];
  if (href === undefined)
    throw new Error("Expected authentication navigation link");
  const authorization = new URL(href.replaceAll("&amp;", "&"));
  return { response, text, authorization };
}
function callbackRequest(authorization: URL, code = "opaque") {
  codeNonces.set(code, authorization.searchParams.get("nonce") ?? "");
  const target = new URL("http://localhost:3000/callback");
  target.searchParams.set("code", code);
  target.searchParams.set(
    "state",
    authorization.searchParams.get("state") ?? "",
  );
  return new Request(target);
}
async function cachedBrowser() {
  const value = await wrapSession(
    {
      [PersistKey.IdToken]: "synthetic-cached-id-token",
      [PersistKey.AccessToken]: JSON.stringify({
        "@https://api.example.test": {
          token: "platform-access-token",
          scope: "",
          expiresAt: 1_898_600_400,
        },
      }),
    },
    cookieSecret,
  );
  return browserSession(new Map([[sessionCookie, value]]));
}

beforeEach(async () => {
  vi.setSystemTime(new Date(authInstant));
  scope = await realBffSession(null);
  releaseImage = useProductionRuntimeImage();
  identityOrigin = "https://identity.example.test";
  for (const [name, value] of Object.entries({
    NODE_ENV: "production",
    BACKEND_BASE_URL: "https://api.example.test",
    LOGTO_ENDPOINT: identityOrigin,
    LOGTO_AUDIENCE: "https://api.example.test",
    LOGTO_APP_ID: "inside-web",
    LOGTO_APP_SECRET: "inside-web-confidential-secret",
    LOGTO_COOKIE_SECRET: cookieSecret,
    WEB_BASE_URL: "https://inside.example.test",
  }))
    vi.stubEnv(name, value);
  providerFailure = undefined;
  grantGate = undefined;
  grantStarted = () => undefined;
  codeNonces.clear();
  accountMode = "ready";
  authoringAllowed = true;
  jwksRequests.length = 0;
  identityRequests.length = 0;
  backendRequests.length = 0;
  tokenForms.length = 0;
  unexpectedRequests.length = 0;
  vi.stubGlobal("fetch", externalFetch);
  cookieClear = vi.spyOn(auth, "clearLogtoSessionCookie");
});
afterEach(() => {
  try {
    expect(unexpectedRequests).toEqual([]);
    for (const request of jwksRequests) {
      expect(request.method).toBe("GET");
      expect(request.path).toBe("/oidc/jwks");
    }
    for (const request of backendRequests) {
      expect(new URL(request.url).origin).toBe("https://api.example.test");
      expect(request.headers.get("authorization")).toBe(
        "Bearer platform-access-token",
      );
    }
    for (const request of identityRequests) {
      const pathname = new URL(request.url).pathname;
      expect(new URL(request.url).origin).toBe(identityOrigin);
      expect(request.method).toBe(pathname === "/oidc/token" ? "POST" : "GET");
    }
    for (const form of tokenForms.filter((form) => form.has("code"))) {
      expect(form.get("grant_type")).toBe("authorization_code");
      expect(form.get("redirect_uri")).toBe(
        "https://inside.example.test/callback",
      );
      expect(form.get("resource")).toBe("https://api.example.test");
      expect(form.get("code_verifier")).toBeTruthy();
    }
  } finally {
    releaseImage();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

describe("Logto BFF route orchestration", () => {
  it("starts a same-origin official Logto flow without a custom attempt cookie", async () => {
    const browser = browserSession();
    const flow = await begin(browser);
    expect(flow.response.status).toBe(200);
    expect(flow.text).toContain("https://identity.example.test/oidc/auth");
    expect(flow.authorization.searchParams.get("redirect_uri")).toBe(
      "https://inside.example.test/callback",
    );
    expect(flow.authorization.searchParams.get("direct_sign_in")).toBe(
      "social:inside-telegram",
    );
    expect(
      new Set(flow.authorization.searchParams.get("prompt")?.split(" ")),
    ).toEqual(new Set(["login", "consent"]));
    expect([...browser.jar.keys()]).toEqual(["logto_inside-web"]);
  });
  it("keeps fresh verification and offline access in the real SDK authorization URL", async () => {
    const { response, authorization } = await begin(browserSession());
    const parameters = authorization.searchParams;
    expect(response.status).toBe(200);
    expect(new Set(parameters.get("prompt")?.split(" "))).toEqual(
      new Set(["login", "consent"]),
    );
    expect(parameters.get("scope")?.split(" ")).toContain("offline_access");
    expect(parameters.get("resource")).toBe("https://api.example.test");
    expect(parameters.get("direct_sign_in")).toBe("social:inside-telegram");
    expect(parameters.get("code_challenge_method")).toBe("S256");
    expect(parameters.get("state")).toBeTruthy();
  });
  it("round-trips a same-origin authoring destination through the official Logto flow", async () => {
    const browser = browserSession();
    const { response, authorization } = await begin(browser, {
      returnTo: "/authoring/playlists/playlist-id",
    });
    expect(response.status).toBe(200);
    const result = await browser.run(() =>
      callback(callbackRequest(authorization)),
    );
    expect(result.headers.get("location")).toBe(
      "https://inside.example.test/authoring/playlists/playlist-id",
    );
    expect(tokenForms).toHaveLength(1);
  });
  it("preserves explicit existing-account method selection and the Telegram continuation", async () => {
    const browser = browserSession();
    const { response, authorization } = await begin(browser, {
      entry: "account-choice",
      returnTo: "/telegram/continue?attempt=fixture",
    });
    expect(response.status).toBe(200);
    expect(authorization.searchParams.has("direct_sign_in")).toBe(false);
    expect(
      new Set(authorization.searchParams.get("prompt")?.split(" ")),
    ).toEqual(new Set(["login", "consent"]));
    const result = await browser.run(() =>
      callback(callbackRequest(authorization)),
    );
    expect(result.headers.get("location")).toBe(
      "https://inside.example.test/telegram/continue?attempt=fixture",
    );
  });
  it("uses a provider-scoped token for the cabinet immediately after a resource-bound sign-in", async () => {
    const browser = browserSession();
    const { authorization } = await begin(browser, { returnTo: "/account" });
    await browser.run(() => callback(callbackRequest(authorization)));

    for (const read of [1, 2]) {
      const response = await browser.run(() => readAccountEmail());
      expect(await response.json(), `cabinet read ${String(read)}`).toEqual({
        ok: true,
        email: null,
      });
    }
    expect(
      tokenForms.map((form) => [form.get("grant_type"), form.get("resource")]),
    ).toEqual([
      ["authorization_code", "https://api.example.test"],
      ["refresh_token", "https://api.example.test"],
      ["refresh_token", null],
    ]);
  });

  it("establishes the Account after the SDK callback", async () => {
    accountMode = "establish";
    const browser = browserSession();
    const { authorization } = await begin(browser);
    const response = await browser.run(() =>
      callback(callbackRequest(authorization)),
    );
    expect(response.headers.get("location")).toBe(
      "https://inside.example.test/",
    );
    expect(
      backendRequests.map((r) => [r.method, new URL(r.url).pathname]),
    ).toEqual([
      ["GET", "/accounts/current"],
      ["POST", "/accounts"],
      ["GET", "/accounts/current/legal-acceptances/terms"],
    ]);
    expect(tokenForms).toHaveLength(1);
  });
  it("answers a repeated callback from the same browser without a second code exchange", async () => {
    const browser = browserSession();
    const { authorization } = await begin(browser, { returnTo: "/courses" });
    const duplicate = browserSession(browser.jar);
    const transaction = browser.jar.get(sessionCookie);
    let finishExchange: () => void = () => undefined;
    grantGate = new Promise((resolve) => {
      finishExchange = resolve;
    });
    let start: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    grantStarted = start;
    const first = browser.run(() =>
      callback(callbackRequest(authorization, "once")),
    );
    await Promise.race([
      started,
      first.then(() => {
        expect(tokenForms).toHaveLength(1);
      }),
    ]);
    const second = duplicate.run(() =>
      callback(callbackRequest(authorization, "once")),
    );
    finishExchange();
    const responses = await Promise.all([first, second]);
    expect(tokenForms).toHaveLength(1);
    expect(responses.map((r) => r.headers.get("location"))).toEqual([
      "https://inside.example.test/courses",
      "https://inside.example.test/courses",
    ]);
    expect(responses.map((r) => r.status)).toEqual([303, 303]);
    expect(browser.jar.get(sessionCookie)).not.toBe(transaction);
    expect(browser.jar.get(sessionCookie)).toBeTruthy();
    expect(duplicate.jar.get(sessionCookie)).toBe(
      browser.jar.get(sessionCookie),
    );
  });
  it("does not hand a callback result to a request from another browser", async () => {
    const first = browserSession();
    const { authorization } = await begin(first);
    const other = browserSession();
    await begin(other);
    const observe = vi.spyOn(
      AudienceBoundLogtoClient.prototype,
      "handleSignInCallback",
    );
    const accepted = await first.run(() =>
      callback(callbackRequest(authorization, "shared")),
    );
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const denied = await other.run(() =>
      callback(callbackRequest(authorization, "shared")),
    );
    expect(observe).toHaveBeenCalledTimes(2);
    expect(tokenForms).toHaveLength(1);
    expect(denied.headers.get("location")).not.toBe(
      accepted.headers.get("location"),
    );
    errorLog.mockRestore();
  });
  it("keeps a retryable Account establishment recoverable", async () => {
    accountMode = "offline";
    const browser = browserSession();
    const { authorization } = await begin(browser);
    const response = await browser.run(() =>
      callback(callbackRequest(authorization)),
    );
    expect(response.headers.get("location")).toBe(
      "https://inside.example.test/?authentication=retryable",
    );
    expect(browser.jar.has(sessionCookie)).toBe(true);
    expect(backendRequests).toHaveLength(1);
    expect(cookieClear).not.toHaveBeenCalled();
  });
  it("clears the Logto cookie when Account establishment fails", async () => {
    accountMode = "conflict";
    const browser = browserSession();
    const { authorization } = await begin(browser);
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const response = await browser.run(() =>
      callback(callbackRequest(authorization, "invalid")),
    );
    expect(response.headers.get("location")).toBe(
      "https://inside.example.test/?authentication=failed",
    );
    expect(browser.jar.has(sessionCookie)).toBe(false);
    expect(errorLog).toHaveBeenCalledOnce();
    const line = String(errorLog.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({
      event: "authentication_failed",
      level: "error",
    });
    expect(
      backendRequests.some(
        (r) => r.method === "POST" && new URL(r.url).pathname === "/accounts",
      ),
    ).toBe(true);
    expect(line).not.toContain("identity conflict");
    expect(cookieClear).toHaveBeenCalledWith(expectedCookieConfig);
  });
  it("keeps the provider Error label while hiding external error details", async () => {
    const browser = browserSession();
    const { authorization } = await begin(browser);
    providerFailure = new Error("identity conflict");
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await browser.run(() => callback(callbackRequest(authorization)));
    expect(errorLog).toHaveBeenCalledOnce();
    const line = String(errorLog.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({
      event: "authentication_failed",
      errorName: "Error",
      level: "error",
    });
    expect(line).not.toContain("identity conflict");
    expect(browser.jar.has(sessionCookie)).toBe(false);
    expect(
      identityRequests.some(
        (request) =>
          request.method === "POST" &&
          request.url === "https://identity.example.test/oidc/token",
      ),
    ).toBe(true);
  });
  it("resolves status from Logto token plus existing Account", async () => {
    const response = await (await cachedBrowser()).run(authStatus);
    await expect(response.json()).resolves.toEqual({
      accountId: "72000000-0000-4000-8000-000000000001",
      canManageMaterials: true,
      state: "authenticated",
    });
    expect(
      backendRequests.map((request) => [request.method, request.url]).sort(),
    ).toEqual([
      ["GET", "https://api.example.test/accounts/current"],
      ["GET", "https://api.example.test/authoring/materials/references"],
    ]);
  });
  it("keeps editor navigation hidden without materials:manage", async () => {
    authoringAllowed = false;
    const response = await (await cachedBrowser()).run(authStatus);
    await expect(response.json()).resolves.toEqual({
      accountId: "72000000-0000-4000-8000-000000000001",
      canManageMaterials: false,
      state: "authenticated",
    });
  });
  it("holds the status answer out of the build before it can be mistaken for a failure", async () => {
    const browser = await cachedBrowser();
    const read = vi.spyOn(platformSession, "getPlatformAccessToken");
    await expect(
      browser.run(async () => {
        const store = workAsyncStorage.getStore();
        if (store === undefined) throw new Error("Expected Next work store");
        store.dynamicShouldError = true;
        return authStatus();
      }),
    ).rejects.toBeInstanceOf(StaticGenBailoutError);
    expect(read).not.toHaveBeenCalled();
    expect(identityRequests).toEqual([]);
    expect(backendRequests).toEqual([]);
  });
  it("reports a missing Logto session as a guest", async () => {
    const browser = browserSession();
    const response = await browser.run(authStatus);
    await expect(response.json()).resolves.toEqual({
      accountId: null,
      canManageMaterials: false,
      state: "guest",
    });
    expect(browser.changed).toEqual([]);
    expect(cookieClear).not.toHaveBeenCalled();
  });
  it("delegates logout to Logto and has no backend session call", async () => {
    const browser = await cachedBrowser();
    const response = await browser.run(() =>
      signOut(formRequest("/auth/sign-out")),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("clear-site-data")).toBe('"cache", "storage"');
    const text = await response.text();
    expect(text).toContain("https://identity.example.test/oidc/session/end");
    expect(text).toContain(
      "post_logout_redirect_uri=https%3A%2F%2Finside.example.test",
    );
    expect(browser.jar.has(sessionCookie)).toBe(false);
    expect(backendRequests).toEqual([]);
    expect(cookieClear).toHaveBeenCalledWith(expectedCookieConfig);
  });
  it("keeps a selected Product continuation through conflict logout", async () => {
    const returnTo =
      "/telegram/continue?attempt=62000000-0000-4000-8000-000000000001";
    const browser = await cachedBrowser();
    const response = await browser.run(() =>
      signOut(formRequest("/auth/sign-out", { returnTo })),
    );
    expect(response.headers.get("set-cookie")).toContain(
      encodeURIComponent(returnTo),
    );
    expect(await response.text()).toContain(
      "post_logout_redirect_uri=https%3A%2F%2Finside.example.test",
    );
  });
  it("clears the local Logto cookie and reports incomplete provider logout", async () => {
    identityOrigin = "https://identity-logout-failure.example.test";
    vi.stubEnv("LOGTO_ENDPOINT", identityOrigin);
    providerFailure = new Error("provider unavailable");
    const browser = await cachedBrowser();
    const response = await browser.run(() =>
      signOut(formRequest("/auth/sign-out")),
    );
    expect(await response.text()).toContain(
      "https://inside.example.test/?authentication=logout-incomplete",
    );
    expect(browser.jar.has(sessionCookie)).toBe(false);
    expect(cookieClear).toHaveBeenCalledWith({
      ...expectedCookieConfig,
      endpoint: identityOrigin,
    });
  });
  it("only the matching successful SDK callback enables the explicit guest waitlist continuation", async () => {
    const token = signWaitlistIntent(
      {
        productSlug: "ai-engineering",
        productId: "10000000-0000-4000-8000-000000000001",
        intakeId: "10000000-0000-4000-8000-000000000002",
        source: "youtube",
        accountId: null,
      },
      cookieSecret,
      new Date(authInstant),
    );
    const pending = verifyWaitlistIntent(
      token,
      cookieSecret,
      new Date(authInstant),
    );
    if (pending === null) throw new Error("Synthetic intent required");
    const browser = browserSession(new Map([[WAITLIST_INTENT_COOKIE, token]]));
    const returnTo = `/products/ai-engineering?waitlist=${pending.operationId}`;
    const { authorization } = await begin(browser, { returnTo });
    expect(
      verifyWaitlistIntent(
        browser.jar.get(WAITLIST_INTENT_COOKIE),
        cookieSecret,
        new Date(authInstant),
      ),
    ).toMatchObject({
      phase: "signing-in",
      accountId: null,
      source: "youtube",
    });
    await browser.run(() =>
      callback(callbackRequest(authorization, "synthetic")),
    );
    expect(
      verifyWaitlistIntent(
        browser.jar.get(WAITLIST_INTENT_COOKIE),
        cookieSecret,
        new Date(authInstant),
      ),
    ).toMatchObject({
      phase: "ready",
      accountId: "72000000-0000-4000-8000-000000000001",
      source: "youtube",
      operationId: pending.operationId,
    });
  });
  it("failed SDK callback discards waitlist intent, so ordinary later sign-in cannot use it", async () => {
    const token = signWaitlistIntent(
      {
        productSlug: "ai-engineering",
        productId: "10000000-0000-4000-8000-000000000001",
        intakeId: "10000000-0000-4000-8000-000000000002",
        source: "youtube",
        accountId: null,
      },
      cookieSecret,
      new Date(authInstant),
    );
    const browser = browserSession(new Map([[WAITLIST_INTENT_COOKIE, token]]));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await browser.run(() =>
      callback(
        new Request("https://inside.example.test/callback?error=access_denied"),
      ),
    );
    expect(browser.jar.has(WAITLIST_INTENT_COOKIE)).toBe(false);
    log.mockRestore();
  });
});

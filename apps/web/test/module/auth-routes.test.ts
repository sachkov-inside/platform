import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  BackendConnectionError: class BackendConnectionError extends Error {
    readonly code: "configuration" | "invalid-response" | "rejected" | "unavailable";

    constructor(
      code: "configuration" | "invalid-response" | "rejected" | "unavailable",
      message: string,
    ) {
      super(message);
      this.code = code;
    }
  },
  sequence: [] as string[],
  config: {
    endpoint: "https://identity.example.test",
    appId: "inside-web",
    appSecret: "inside-web-confidential-secret",
    audience: "https://api.example.test",
    cookieSecret: "inside-web-cookie-secret-with-32-chars",
    cookieSecure: true,
    baseUrl: "https://inside.example.test",
    resources: ["https://api.example.test"],
  },
  cookieSet: vi.fn(),
  cookieGet: vi.fn(() => ({ value: "encrypted-logto-session" })),
  writeSignInAttempt: vi.fn(),
  clearSignInAttempt: vi.fn(() => {
    fakes.sequence.push("clear-attempt");
    return Promise.resolve();
  }),
  readSignInAttempt: vi.fn(),
  writePlatformSession: vi.fn(() => {
    fakes.sequence.push("write-platform-session");
    return Promise.resolve();
  }),
  clearPlatformSession: vi.fn(() => {
    fakes.sequence.push("clear-platform-session");
    return Promise.resolve();
  }),
  readPlatformSession: vi.fn(),
  resolveIdentitySubject: vi.fn(() =>
    Promise.resolve({
      principalId: "72000000-0000-4000-8000-000000000001",
      principalKind: "human" as const,
      sessionRef: "72000000-0000-4000-8000-000000000002",
      authenticatedAt: "2026-08-25T06:00:00.000Z",
      expiresAt: "2026-09-01T06:00:00.000Z",
      permissions: [],
    }),
  ),
  establishIdentitySession: vi.fn(() => {
    fakes.sequence.push("establish-identity-session");
    return Promise.resolve({
      principalId: "72000000-0000-4000-8000-000000000001",
      principalKind: "human" as const,
      sessionRef: "72000000-0000-4000-8000-000000000002",
      authenticatedAt: "2026-08-25T06:00:00.000Z",
      expiresAt: "2026-09-01T06:00:00.000Z",
      permissions: [],
    });
  }),
  beginIdentityReauthentication: vi.fn(() => {
    fakes.sequence.push("begin-identity-reauthentication");
    return Promise.resolve({
      attemptId: "72000000-0000-4000-8000-000000000011",
      expiresAt: "2026-08-25T06:05:00.000Z",
    });
  }),
  completeIdentityReauthentication: vi.fn(() => {
    fakes.sequence.push("complete-identity-reauthentication");
    return fakes.establishIdentitySession();
  }),
  endIdentitySession: vi.fn(() => {
    fakes.sequence.push("end-identity-session");
    return Promise.resolve();
  }),
  getAccessToken: vi.fn(() => {
    fakes.sequence.push("get-access-token");
    return Promise.resolve("platform-access-token");
  }),
  handleSignIn: vi.fn(() =>
    Promise.resolve({ url: "https://identity.example.test/oidc/auth" }),
  ),
  handleSignInCallback: vi.fn(() => {
    fakes.sequence.push("handle-sign-in-callback");
    return Promise.resolve();
  }),
  handleSignOut: vi.fn(() => {
    fakes.sequence.push("handle-sign-out");
    return Promise.resolve("https://identity.example.test/oidc/session/end");
  }),
}));

vi.mock("@logto/next/server-actions", () => ({
  default: class LogtoClient {
    handleSignIn = fakes.handleSignIn;
    handleSignInCallback = fakes.handleSignInCallback;
    handleSignOut = fakes.handleSignOut;
  },
  getAccessToken: fakes.getAccessToken,
}));

vi.mock("@/shared/auth/audience-bound-logto-client.server", () => ({
  AudienceBoundLogtoClient: class {
    handleSignInCallback = fakes.handleSignInCallback;
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({ get: fakes.cookieGet, set: fakes.cookieSet }),
  ),
}));

vi.mock("@/shared/auth/index.server", () => ({
  readLogtoBffConfig: () => fakes.config,
  isSameOriginMutation: (request: Request, baseUrl: string) =>
    request.headers.get("origin") === new URL(baseUrl).origin,
  logtoSessionCookieName: (appId: string) => `logto_${appId}`,
  providerCallbackUrl: (requestUrl: string, baseUrl: string, pathname: string) => {
    const incoming = new URL(requestUrl);
    const callbackUrl = new URL(pathname, baseUrl);
    callbackUrl.search = incoming.search;
    return callbackUrl.toString();
  },
  writeSignInAttempt: fakes.writeSignInAttempt,
  clearSignInAttempt: fakes.clearSignInAttempt,
  readSignInAttempt: fakes.readSignInAttempt,
  writePlatformSession: fakes.writePlatformSession,
  clearPlatformSession: fakes.clearPlatformSession,
  readPlatformSession: fakes.readPlatformSession,
}));

vi.mock("@/shared/api/backend/index.server", () => ({
  BackendConnectionError: fakes.BackendConnectionError,
  beginIdentityReauthentication: fakes.beginIdentityReauthentication,
  completeIdentityReauthentication: fakes.completeIdentityReauthentication,
  establishIdentitySession: fakes.establishIdentitySession,
  endIdentitySession: fakes.endIdentitySession,
  resolveIdentitySubject: fakes.resolveIdentitySubject,
}));

import { POST as signIn } from "../../app/auth/sign-in/route";
import { POST as signOut } from "../../app/auth/sign-out/route";
import { GET as authStatus } from "../../app/auth/status/route";
import { POST as reauthenticate } from "../../app/auth/reauthenticate/route";
import { GET as callback } from "../../app/callback/route";
import { GET as reauthenticationCallback } from "../../app/reauthentication-callback/route";

describe("Logto BFF route orchestration", () => {
  beforeEach(() => {
    fakes.sequence.length = 0;
    vi.clearAllMocks();
    fakes.readSignInAttempt.mockResolvedValue({
      id: "72000000-0000-4000-8000-000000000010",
      expiresAt: "2026-08-25T06:10:00.000Z",
      kind: "sign_in",
      phase: "provider_pending",
    });
    fakes.readPlatformSession.mockResolvedValue({
      sessionRef: "72000000-0000-4000-8000-000000000002",
      expiresAt: "2026-09-01T06:00:00.000Z",
    });
  });

  it("starts only a same-origin callback-bound authorization request", async () => {
    fakes.readSignInAttempt.mockResolvedValueOnce(undefined);
    const response = await signIn(
      new Request("https://inside.example.test/auth/sign-in", {
        method: "POST",
        headers: { origin: "https://inside.example.test" },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://identity.example.test/oidc/auth",
    );
    expect(fakes.writeSignInAttempt).toHaveBeenCalledOnce();
    expect(fakes.writeSignInAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "sign_in", phase: "provider_pending" }),
    );
    expect(fakes.handleSignIn).toHaveBeenCalledWith({
      redirectUri: "https://inside.example.test/callback",
    });

    const rejected = await signIn(
      new Request("https://inside.example.test/auth/sign-in", {
        method: "POST",
        headers: { origin: "https://attacker.example.test" },
      }),
    );
    expect(rejected.status).toBe(403);
  });

  it("does not clobber an active provider state and PKCE transaction", async () => {
    const response = await signIn(
      new Request("https://inside.example.test/auth/sign-in", {
        method: "POST",
        headers: { origin: "https://inside.example.test" },
      }),
    );

    expect(response.headers.get("location")).toBe(
      "https://inside.example.test/?authentication=in-progress",
    );
    expect(fakes.writeSignInAttempt).not.toHaveBeenCalled();
    expect(fakes.handleSignIn).not.toHaveBeenCalled();
  });

  it("binds re-authentication to the current session and a prompt=login callback", async () => {
    const started = await reauthenticate(
      new Request("https://inside.example.test/auth/reauthenticate", {
        method: "POST",
        headers: { origin: "https://inside.example.test" },
      }),
    );

    expect(started.status).toBe(303);
    expect(fakes.beginIdentityReauthentication).toHaveBeenCalledWith({
      accessToken: "platform-access-token",
      // Vitest's asymmetric matcher is intentionally dynamic here.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      idempotencyKey: expect.any(String),
      sessionRef: "72000000-0000-4000-8000-000000000002",
    });
    expect(fakes.writeSignInAttempt).toHaveBeenCalledWith({
      id: "72000000-0000-4000-8000-000000000011",
      expiresAt: "2026-08-25T06:05:00.000Z",
      kind: "reauthentication",
      sessionRef: "72000000-0000-4000-8000-000000000002",
    });
    expect(fakes.handleSignIn).toHaveBeenCalledWith({
      clearTokens: false,
      prompt: "login",
      redirectUri: "https://inside.example.test/reauthentication-callback",
    });

    fakes.sequence.length = 0;
    fakes.readSignInAttempt.mockResolvedValue({
      id: "72000000-0000-4000-8000-000000000011",
      expiresAt: "2026-08-25T06:05:00.000Z",
      kind: "reauthentication",
      sessionRef: "72000000-0000-4000-8000-000000000002",
    });
    const completed = await reauthenticationCallback(
      new Request(
        "http://localhost:3000/reauthentication-callback?code=opaque&state=opaque",
      ),
    );

    expect(completed.status).toBe(303);
    expect(fakes.handleSignInCallback).toHaveBeenCalledWith(
      "https://inside.example.test/reauthentication-callback?code=opaque&state=opaque",
    );
    expect(fakes.completeIdentityReauthentication).toHaveBeenCalledWith({
      accessToken: "platform-access-token",
      attemptId: "72000000-0000-4000-8000-000000000011",
      idempotencyKey: "72000000-0000-4000-8000-000000000011",
      sessionRef: "72000000-0000-4000-8000-000000000002",
    });
    expect(fakes.sequence).toEqual([
      "handle-sign-in-callback",
      "get-access-token",
      "complete-identity-reauthentication",
      "establish-identity-session",
      "write-platform-session",
      "clear-attempt",
    ]);
  });

  it("establishes the Principal before persisting the opaque Platform Session", async () => {
    const response = await callback(
      new Request("http://localhost:3000/callback?code=opaque&state=opaque"),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://inside.example.test/");
    expect(fakes.handleSignInCallback).toHaveBeenCalledWith(
      "https://inside.example.test/callback?code=opaque&state=opaque",
    );
    expect(fakes.getAccessToken).toHaveBeenCalledWith(fakes.config);
    expect(fakes.writeSignInAttempt).toHaveBeenCalledWith({
      id: "72000000-0000-4000-8000-000000000010",
      expiresAt: "2026-08-25T06:10:00.000Z",
      kind: "sign_in",
      phase: "backend_pending",
    });
    expect(fakes.establishIdentitySession).toHaveBeenCalledWith({
      accessToken: "platform-access-token",
      idempotencyKey: "72000000-0000-4000-8000-000000000010",
    });
    expect(fakes.writePlatformSession).toHaveBeenCalledWith({
      sessionRef: "72000000-0000-4000-8000-000000000002",
      expiresAt: "2026-09-01T06:00:00.000Z",
    });
    expect(fakes.sequence).toEqual([
      "handle-sign-in-callback",
      "get-access-token",
      "establish-identity-session",
      "write-platform-session",
      "clear-attempt",
    ]);
  });

  it("retries an uncertain backend response with the original callback key", async () => {
    fakes.establishIdentitySession.mockRejectedValueOnce(
      new fakes.BackendConnectionError("unavailable", "response lost"),
    );
    const first = await callback(
      new Request("https://inside.example.test/callback?code=opaque&state=opaque"),
    );

    expect(first.headers.get("location")).toBe(
      "https://inside.example.test/?authentication=retryable",
    );
    expect(fakes.clearSignInAttempt).not.toHaveBeenCalled();
    expect(fakes.writeSignInAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "72000000-0000-4000-8000-000000000010",
        phase: "backend_pending",
      }),
    );

    fakes.readSignInAttempt.mockResolvedValue({
      id: "72000000-0000-4000-8000-000000000010",
      expiresAt: "2026-08-25T06:10:00.000Z",
      kind: "sign_in",
      phase: "backend_pending",
    });
    const retried = await signIn(
      new Request("https://inside.example.test/auth/sign-in", {
        method: "POST",
        headers: { origin: "https://inside.example.test" },
      }),
    );

    expect(retried.headers.get("location")).toBe("https://inside.example.test/");
    expect(fakes.establishIdentitySession).toHaveBeenLastCalledWith({
      accessToken: "platform-access-token",
      idempotencyKey: "72000000-0000-4000-8000-000000000010",
    });
    expect(fakes.getAccessToken).toHaveBeenLastCalledWith(
      fakes.config,
      "https://api.example.test",
    );
    expect(fakes.handleSignIn).not.toHaveBeenCalled();
  });

  it("refreshes status through one mutation-capable single flight", async () => {
    let releaseToken: ((token: string) => void) | undefined;
    fakes.getAccessToken.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseToken = resolve;
        }),
    );

    const responses = Promise.all([authStatus(), authStatus()]);
    await vi.waitFor(() => {
      expect(fakes.getAccessToken).toHaveBeenCalledOnce();
    });
    releaseToken?.("platform-access-token");
    const [first, second] = await responses;

    await expect(first.json()).resolves.toEqual({ state: "authenticated" });
    await expect(second.json()).resolves.toEqual({ state: "authenticated" });
    expect(fakes.resolveIdentitySubject).toHaveBeenCalledTimes(2);
  });

  it("clears local authority when Logto rejects the refresh grant", async () => {
    const invalidGrant = new Error("refresh rejected") as Error & { code: string };
    invalidGrant.name = "LogtoRequestError";
    invalidGrant.code = "invalid_grant";
    fakes.getAccessToken.mockRejectedValueOnce(invalidGrant);

    const response = await authStatus();

    await expect(response.json()).resolves.toEqual({ state: "guest" });
    expect(fakes.clearPlatformSession).toHaveBeenCalledOnce();
    expect(fakes.cookieSet).toHaveBeenCalledWith(
      "logto_inside-web",
      "",
      expect.objectContaining({ maxAge: 0 }),
    );
  });

  it("clears local authority before best-effort backend and provider logout", async () => {
    const response = await signOut(
      new Request("https://inside.example.test/auth/sign-out", {
        method: "POST",
        headers: { origin: "https://inside.example.test" },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("clear-site-data")).toBe('"storage"');
    expect(fakes.sequence).toEqual([
      "clear-platform-session",
      "get-access-token",
      "end-identity-session",
      "handle-sign-out",
    ]);
  });

  it("does not let provider cleanup keep the logout response open", async () => {
    vi.useFakeTimers();
    try {
      fakes.getAccessToken.mockImplementationOnce(
        () => new Promise<string>(() => undefined),
      );
      const responsePromise = signOut(
        new Request("https://inside.example.test/auth/sign-out", {
          method: "POST",
          headers: { origin: "https://inside.example.test" },
        }),
      );

      await vi.advanceTimersByTimeAsync(1_000);
      const response = await responsePromise;

      expect(response.status).toBe(303);
      expect(fakes.endIdentitySession).not.toHaveBeenCalled();
      expect(fakes.handleSignOut).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports an incomplete global logout when the provider does not respond", async () => {
    vi.useFakeTimers();
    try {
      fakes.handleSignOut.mockImplementationOnce(
        () => new Promise<string>(() => undefined),
      );
      const responsePromise = signOut(
        new Request("https://inside.example.test/auth/sign-out", {
          method: "POST",
          headers: { origin: "https://inside.example.test" },
        }),
      );

      await vi.advanceTimersByTimeAsync(1_000);
      const response = await responsePromise;

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "https://inside.example.test/?authentication=logout-incomplete",
      );
      expect(fakes.cookieSet).toHaveBeenCalledWith(
        "logto_inside-web",
        "",
        expect.objectContaining({ maxAge: 0 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

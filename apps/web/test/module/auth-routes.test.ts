import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
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
  clearLogtoSessionCookie: vi.fn(() => Promise.resolve()),
  completePlatformSignIn: vi.fn<() => Promise<"complete" | "retryable">>(() =>
    Promise.resolve("complete"),
  ),
  getAccessToken: vi.fn(() => Promise.resolve("platform-access-token")),
  handleSignIn: vi.fn(() =>
    Promise.resolve({ url: "https://identity.example.test/oidc/auth" }),
  ),
  handleSignInCallback: vi.fn<() => Promise<string | undefined>>(() =>
    Promise.resolve(undefined),
  ),
  handleSignOut: vi.fn(() =>
    Promise.resolve("https://identity.example.test/oidc/session/end"),
  ),
  resolveAccount: vi.fn(() =>
    Promise.resolve({ accountId: "72000000-0000-4000-8000-000000000001" }),
  ),
  requestMaterialAuthoringReferences: vi.fn(() =>
    Promise.resolve({ ok: true }),
  ),
}));

vi.mock("@logto/next/server-actions", () => ({
  default: class LogtoClient {
    handleSignIn = fakes.handleSignIn;
    handleSignOut = fakes.handleSignOut;
  },
  getAccessToken: fakes.getAccessToken,
}));

vi.mock("@/shared/auth/audience-bound-logto-client.server", () => ({
  AudienceBoundLogtoClient: class {
    handleSignInCallback = fakes.handleSignInCallback;
  },
}));

vi.mock("@/shared/auth/complete-platform-sign-in.server", () => ({
  completePlatformSignIn: fakes.completePlatformSignIn,
}));

vi.mock("@/shared/auth/index.server", () => ({
  readLogtoBffConfig: () => fakes.config,
  clearLogtoSessionCookie: fakes.clearLogtoSessionCookie,
  isSameOriginMutation: (request: Request, baseUrl: string) =>
    request.headers.get("origin") === new URL(baseUrl).origin,
  providerCallbackUrl: (requestUrl: string, baseUrl: string) => {
    const incoming = new URL(requestUrl);
    const callbackUrl = new URL("/callback", baseUrl);
    callbackUrl.search = incoming.search;
    return callbackUrl.toString();
  },
  safePostSignInReturnUri: (value: unknown, baseUrl: string) => {
    if (typeof value !== "string" || value.startsWith("//")) {
      return undefined;
    }
    try {
      const base = new URL(baseUrl);
      const target = value.startsWith("/") ? new URL(value, base) : new URL(value);
      return target.origin === base.origin ? target.toString() : undefined;
    } catch {
      return undefined;
    }
  },
}));

vi.mock("@/shared/auth/platform-access-token.server", () => ({
  getPlatformAccessToken: fakes.getAccessToken,
  LogtoSessionUnavailableError: class extends Error {},
}));

vi.mock("@/shared/api/backend/index.server", () => ({
  requestMaterialAuthoringReferences: fakes.requestMaterialAuthoringReferences,
  resolveAccount: fakes.resolveAccount,
}));

import { POST as signIn } from "../../app/auth/sign-in/route";
import { POST as signOut } from "../../app/auth/sign-out/route";
import { GET as authStatus } from "../../app/auth/status/route";
import { GET as callback } from "../../app/callback/route";

describe("Logto BFF route orchestration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts a same-origin official Logto flow without a custom attempt cookie", async () => {
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
    expect(fakes.handleSignIn).toHaveBeenCalledWith({
      redirectUri: "https://inside.example.test/callback",
    });
  });

  it("round-trips a same-origin authoring destination through the official Logto flow", async () => {
    const response = await signIn(
      new Request("https://inside.example.test/auth/sign-in", {
        method: "POST",
        headers: {
          origin: "https://inside.example.test",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ returnTo: "/authoring/playlists/playlist-id" }),
      }),
    );

    expect(response.status).toBe(303);
    expect(fakes.handleSignIn).toHaveBeenCalledWith({
      redirectUri: "https://inside.example.test/callback",
      postRedirectUri: "https://inside.example.test/authoring/playlists/playlist-id",
    });

    fakes.handleSignInCallback.mockResolvedValueOnce(
      "https://inside.example.test/authoring/playlists/playlist-id",
    );
    const callbackResponse = await callback(
      new Request("http://localhost:3000/callback?code=opaque&state=opaque"),
    );
    expect(callbackResponse.headers.get("location")).toBe(
      "https://inside.example.test/authoring/playlists/playlist-id",
    );
  });

  it("establishes the Account after the SDK callback", async () => {
    const response = await callback(
      new Request("http://localhost:3000/callback?code=opaque&state=opaque"),
    );
    expect(response.headers.get("location")).toBe("https://inside.example.test/");
    expect(fakes.handleSignInCallback).toHaveBeenCalledWith(
      "https://inside.example.test/callback?code=opaque&state=opaque",
    );
    expect(fakes.getAccessToken).toHaveBeenCalledWith(fakes.config);
    expect(fakes.completePlatformSignIn).toHaveBeenCalledWith(
      "platform-access-token",
    );
  });

  it("keeps a retryable Account establishment recoverable", async () => {
    fakes.completePlatformSignIn.mockResolvedValueOnce("retryable");

    const response = await callback(
      new Request("http://localhost:3000/callback?code=opaque&state=opaque"),
    );

    expect(response.headers.get("location")).toBe(
      "https://inside.example.test/?authentication=retryable",
    );
    expect(fakes.clearLogtoSessionCookie).not.toHaveBeenCalled();
  });

  it("clears the Logto cookie when Account establishment fails", async () => {
    fakes.completePlatformSignIn.mockRejectedValueOnce(
      new Error("identity conflict"),
    );

    const response = await callback(
      new Request("http://localhost:3000/callback?code=invalid&state=invalid"),
    );

    expect(response.headers.get("location")).toBe(
      "https://inside.example.test/?authentication=failed",
    );
    expect(fakes.clearLogtoSessionCookie).toHaveBeenCalledWith(fakes.config);
  });

  it("resolves status from Logto token plus existing Account", async () => {
    const response = await authStatus();
    await expect(response.json()).resolves.toEqual({
      canManageMaterials: true,
      state: "authenticated",
    });
    expect(fakes.resolveAccount).toHaveBeenCalledWith("platform-access-token");
    expect(fakes.requestMaterialAuthoringReferences).toHaveBeenCalledWith(
      "platform-access-token",
    );
  });

  it("keeps editor navigation hidden without materials:manage", async () => {
    fakes.requestMaterialAuthoringReferences.mockResolvedValueOnce({
      ok: false,
    });

    const response = await authStatus();

    await expect(response.json()).resolves.toEqual({
      canManageMaterials: false,
      state: "authenticated",
    });
  });

  it("clears the Logto cookie when its refresh grant is invalid", async () => {
    const invalidGrant = Object.assign(new Error("refresh rejected"), {
      name: "LogtoRequestError",
      code: "invalid_grant",
    });
    fakes.getAccessToken.mockRejectedValueOnce(invalidGrant);

    const response = await authStatus();

    await expect(response.json()).resolves.toEqual({
      canManageMaterials: false,
      state: "guest",
    });
    expect(fakes.clearLogtoSessionCookie).toHaveBeenCalledWith(fakes.config);
  });

  it("reports a missing Logto session as a guest", async () => {
    const { LogtoSessionUnavailableError } = await import(
      "@/shared/auth/platform-access-token.server"
    );
    fakes.getAccessToken.mockRejectedValueOnce(new LogtoSessionUnavailableError());

    const response = await authStatus();

    await expect(response.json()).resolves.toEqual({
      canManageMaterials: false,
      state: "guest",
    });
    expect(fakes.clearLogtoSessionCookie).not.toHaveBeenCalled();
  });

  it("delegates logout to Logto and has no backend session call", async () => {
    const response = await signOut(
      new Request("https://inside.example.test/auth/sign-out", {
        method: "POST",
        headers: { origin: "https://inside.example.test" },
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("clear-site-data")).toBe('"storage"');
    expect(fakes.handleSignOut).toHaveBeenCalledWith(fakes.config.baseUrl);
    expect(fakes.clearLogtoSessionCookie).toHaveBeenCalledWith(fakes.config);
  });

  it("clears the local Logto cookie and reports incomplete provider logout", async () => {
    fakes.handleSignOut.mockRejectedValueOnce(new Error("provider unavailable"));

    const response = await signOut(
      new Request("https://inside.example.test/auth/sign-out", {
        method: "POST",
        headers: { origin: "https://inside.example.test" },
      }),
    );

    expect(response.headers.get("location")).toBe(
      "https://inside.example.test/?authentication=logout-incomplete",
    );
    expect(fakes.clearLogtoSessionCookie).toHaveBeenCalledWith(fakes.config);
  });
});

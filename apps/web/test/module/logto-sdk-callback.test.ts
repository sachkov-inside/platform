import LogtoClient, { PersistKey } from "@logto/node/edge";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { providerCallbackUrl } from "@/shared/auth/provider-callback-url.server";
import { isTelegramSignInToken } from "@/shared/auth/telegram-sign-in-token.server";
import { executeAcceptTerms } from "@/features/terms-acceptance/api/accept-terms.server";

vi.mock("server-only", () => ({}));

const endpoint = "https://identity.example.test";
const redirectUri = "https://inside.example.test/callback";
const validCode = "valid-authorization-code";
const providerCanary = "provider-payload-canary-116";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pinned Logto SDK callback corpus", () => {
  it.each([
    ["missing state", () => `${redirectUri}?code=${validCode}`],
    [
      "replaced state",
      (state: string) =>
        `${redirectUri}?code=${validCode}&state=${state}-replaced`,
    ],
    ["missing code", (state: string) => `${redirectUri}?state=${state}`],
    [
      "provider error",
      (state: string) =>
        `${redirectUri}?error=access_denied&error_description=${providerCanary}&state=${state}`,
    ],
  ])("rejects %s before token persistence", async (_name, callback) => {
    const proof = await createProofClient();

    await expect(
      proof.client.handleSignInCallback(callback(proof.state)),
    ).rejects.toBeInstanceOf(Error);

    expect(proof.tokenRequests).toHaveLength(0);
    expect(proof.storage.has(PersistKey.IdToken)).toBe(false);
    expect(proof.storage.has(PersistKey.RefreshToken)).toBe(false);
  });

  it("fails closed for a replaced code and wrong PKCE verifier", async () => {
    for (const mutation of ["code", "verifier"] as const) {
      const proof = await createProofClient();
      if (mutation === "verifier") {
        const session = z
          .record(z.string(), z.unknown())
          .parse(
            JSON.parse(proof.storage.get(PersistKey.SignInSession) ?? "null"),
          );
        proof.storage.set(
          PersistKey.SignInSession,
          JSON.stringify({ ...session, codeVerifier: "wrong-verifier" }),
        );
      }

      await expect(
        proof.client.handleSignInCallback(
          `${redirectUri}?code=${mutation === "code" ? "stolen-code" : validCode}&state=${proof.state}`,
        ),
      ).rejects.toBeInstanceOf(Error);
      expect(proof.tokenRequests).toHaveLength(1);
      expect(proof.storage.has(PersistKey.IdToken)).toBe(false);
      expect(proof.storage.has(PersistKey.RefreshToken)).toBe(false);
    }
  });

  it("canonicalizes callbacks onto the only registered route", () => {
    expect(
      providerCallbackUrl(
        "https://inside.example.test/callback/wrong?code=opaque&state=opaque",
        "https://inside.example.test",
      ),
    ).toBe("https://inside.example.test/callback?code=opaque&state=opaque");
  });

  it("exchanges one raced callback once and rejects a later replay", async () => {
    const proof = await createProofClient();
    const callback = `${redirectUri}?code=${validCode}&state=${proof.state}`;

    await Promise.all(
      Array.from({ length: 20 }, () =>
        proof.client.handleSignInCallback(callback),
      ),
    );
    expect(proof.tokenRequests).toHaveLength(1);
    expect(proof.storage.has(PersistKey.IdToken)).toBe(true);

    await expect(
      createClient(proof.storage).handleSignInCallback(callback),
    ).rejects.toThrow("Sign-in session not found.");
    expect(proof.tokenRequests).toHaveLength(1);
  });

  it("resumes the durable receipt after audience refresh drops the sign-in claim", async () => {
    const proof = await createProofClient();
    await proof.client.handleSignInCallback(
      `${redirectUri}?code=${validCode}&state=${proof.state}`,
    );
    expect(isTelegramSignInToken(await proof.client.getAccessToken())).toBe(
      true,
    );
    const refreshed = await proof.client.getAccessToken(
      "https://inside.example.test/api",
    );
    expect(isTelegramSignInToken(refreshed)).toBe(false);
    expect(
      proof.tokenRequests.map((request) => request.get("grant_type")),
    ).toEqual(["authorization_code", "refresh_token"]);
    const form = new FormData();
    form.set(
      "input",
      JSON.stringify({
        operationId: "7a0c2c1e-2d4b-4a57-8a1e-0d9d6f3b8a11",
        version: "1",
        digest: "a".repeat(64),
      }),
    );
    const resumeTelegramSignIn = vi
      .fn()
      .mockResolvedValue({ accountId: "7a0c2c1e-2d4b-4a57-8a1e-0d9d6f3b8a11" });
    await expect(
      executeAcceptTerms(form, refreshed, {
        accept: () =>
          Promise.resolve({ ok: true, body: {}, response: Response.json({}) }),
        resumeTelegramSignIn,
      }),
    ).resolves.toEqual({ kind: "accepted" });
    expect(resumeTelegramSignIn).toHaveBeenCalledWith(refreshed);
  });
});

async function createProofClient() {
  const storage = new Map<string, string>();
  const tokenRequests: URLSearchParams[] = [];
  const accepted = { verifier: undefined as string | undefined };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.endsWith("/.well-known/openid-configuration")) {
        return Promise.resolve(
          jsonResponse({
            authorization_endpoint: `${endpoint}/oidc/auth`,
            token_endpoint: `${endpoint}/oidc/token`,
          }),
        );
      }
      if (url === `${endpoint}/oidc/token`) {
        const body = new URLSearchParams(
          typeof init?.body === "string" ? init.body : "",
        );
        tokenRequests.push(body);
        if (body.get("grant_type") === "refresh_token") {
          return Promise.resolve(
            jsonResponse({
              access_token: accessToken({}),
              expires_in: 300,
              refresh_token: "refresh-token",
              scope: "openid",
              token_type: "Bearer",
            }),
          );
        }
        if (
          body.get("code") !== validCode ||
          body.get("code_verifier") !== accepted.verifier
        ) {
          return Promise.resolve(jsonResponse({ code: "invalid_grant" }, 400));
        }
        return Promise.resolve(
          jsonResponse({
            access_token: accessToken({
              inside_telegram_sign_in: {
                subjectRef: "7a0c2c1e-2d4b-4a57-8a1e-0d9d6f3b8a11",
                requestRef: "7a0c2c1e-2d4b-4a57-8a1e-0d9d6f3b8a11",
              },
            }),
            expires_in: 300,
            id_token: "header.payload.signature",
            refresh_token: "refresh-token",
            scope: "openid",
            token_type: "Bearer",
          }),
        );
      }
      return Promise.resolve(jsonResponse({ code: "not_found" }, 404));
    }),
  );
  const client = createClient(storage);
  let authorizationUrl = "";
  client.adapter.navigate = (url) => {
    authorizationUrl = url;
  };
  await client.signIn({ redirectUri });
  const session = z
    .object({ codeVerifier: z.string().optional() })
    .nullable()
    .parse(JSON.parse(storage.get(PersistKey.SignInSession) ?? "null"));
  accepted.verifier = session?.codeVerifier;
  const state = new URL(authorizationUrl).searchParams.get("state");
  if (state === null)
    throw new Error("Pinned Logto SDK did not create callback state");
  return { client, state, storage, tokenRequests };
}

function createClient(storage: Map<string, string>): LogtoClient {
  const client = new LogtoClient(
    { appId: "inside-web", appSecret: "inside-web-secret", endpoint },
    {
      navigate: () => undefined,
      storage: {
        getItem: (key) => Promise.resolve(storage.get(key) ?? null),
        removeItem: (key) => {
          storage.delete(key);
          return Promise.resolve();
        },
        setItem: (key, value) => {
          storage.set(key, value);
          return Promise.resolve();
        },
      },
    },
  );
  client.setJwtVerifier({ verifyIdToken: () => Promise.resolve() });
  return client;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function accessToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "ES384" })}.${part({ sub: "member", ...claims })}.signature`;
}

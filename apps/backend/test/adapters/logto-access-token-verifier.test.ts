import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
} from "jose";
import { createServer } from "node:http";
import { beforeAll, describe, expect, test } from "vitest";

import { createLogtoAccessTokenVerifier } from "../../src/modules/identity-principals/infrastructure/idp/logto/logto-access-token-verifier.js";

const issuer = "https://identity.example.test/oidc";
const audience = "https://api.inside.example.test";
const now = Math.floor(Date.now() / 1_000);

describe("Logto access token verifier", () => {
  let privateKey: CryptoKey;
  let publicJwk: JWK;

  beforeAll(async () => {
    const pair = await generateKeyPair("ES384");
    privateKey = pair.privateKey;
    publicJwk = { ...(await exportJWK(pair.publicKey)), alg: "ES384", kid: "proof-key-1" };
  });

  test("normalizes one valid human sign-in proof and discards provider authorization claims", async () => {
    const verifier = createLogtoAccessTokenVerifier({
      issuer,
      audience,
      jwks: { keys: [publicJwk] },
    });
    const interactiveAt = new Date(now * 1_000).toISOString();
    const token = await signToken({
      inside_verified_email: "Member@Example.Test",
      inside_interactive_at: interactiveAt,
      roles: ["admin", "member"],
      permissions: ["identity:admin"],
    });

    const result = await verifier.verifyHumanSignIn(token);

    expect(result).toMatchObject({
      ok: true,
      identity: {
        type: "human_sign_in",
        issuer,
        subject: "human-001",
        authenticatedAt: interactiveAt,
        verifiedEmail: "Member@Example.Test",
      },
      sessionIdentity: {
        type: "human_session",
        issuer,
        subject: "human-001",
      },
    });
    expect(JSON.stringify(result)).not.toContain("admin");
    expect(JSON.stringify(result)).not.toContain("member");
  });

  test.each([
    ["issuer", { issuer: "https://attacker.example.test" }],
    ["audience", { audience: "https://another-api.example.test" }],
    ["expired", { issuedAt: now - 601, expiresAt: now - 301 }],
    ["lifetime", { issuedAt: now, expiresAt: now + 301 }],
    ["subject", { subject: "" }],
    ["verified email", { insideVerifiedEmail: undefined }],
    ["interactive fact", { insideInteractiveAt: undefined }],
  ])("fails closed for an invalid %s", async (_name, overrides) => {
    const verifier = createLogtoAccessTokenVerifier({
      issuer,
      audience,
      jwks: { keys: [publicJwk] },
    });
    const token = await signToken({}, overrides);

    await expect(verifier.verifyHumanSignIn(token)).resolves.toEqual({
      ok: false,
      error: { code: "invalid_proof" },
    });
  });

  test("rejects a token signed by an unknown key", async () => {
    const verifier = createLogtoAccessTokenVerifier({
      issuer,
      audience,
      jwks: { keys: [publicJwk] },
    });
    const attacker = await generateKeyPair("ES384");
    const token = await signToken({}, {}, attacker.privateKey, "attacker-key");

    await expect(verifier.verifyHumanSession(token)).resolves.toEqual({
      ok: false,
      error: { code: "invalid_proof" },
    });
  });

  test("rejects RS256 outside the pinned Logto algorithm allowlist", async () => {
    const pair = await generateKeyPair("RS256");
    const rsaJwk = {
      ...(await exportJWK(pair.publicKey)),
      alg: "RS256",
      kid: "proof-rsa-key",
    };
    const verifier = createLogtoAccessTokenVerifier({
      issuer,
      audience,
      jwks: { keys: [rsaJwk] },
    });
    const token = await signToken({}, {}, pair.privateKey, "proof-rsa-key", "RS256");

    await expect(verifier.verifyHumanSignIn(token)).resolves.toEqual({
      ok: false,
      error: { code: "invalid_proof" },
    });
  });

  test("maps only a machine-to-machine client token through the service proof path", async () => {
    const verifier = createLogtoAccessTokenVerifier({
      issuer,
      audience,
      jwks: { keys: [publicJwk] },
    });
    const token = await signToken({ client_id: "service-001" }, { subject: "service-001" });

    await expect(verifier.verifyServiceSession(token)).resolves.toMatchObject({
      ok: true,
      identity: { type: "service_session", issuer, subject: "service-001" },
    });
    await expect(verifier.verifyHumanSession(token)).resolves.toEqual({
      ok: false,
      error: { code: "invalid_proof" },
    });
  });

  test("distinguishes a remote JWKS outage from an invalid proof", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(503).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("JWKS outage server did not bind a TCP port");
    }
    try {
      const verifier = createLogtoAccessTokenVerifier({
        issuer,
        audience,
        jwksUrl: `http://127.0.0.1:${String(address.port)}/jwks`,
      });
      const token = await signToken();

      await expect(verifier.verifyHumanSession(token)).resolves.toEqual({
        ok: false,
        error: { code: "dependency_unavailable" },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  });

  async function signToken(
    claims: Record<string, unknown> = {},
    overrides: {
      readonly issuer?: string;
      readonly audience?: string;
      readonly issuedAt?: number;
      readonly expiresAt?: number;
      readonly subject?: string;
      readonly insideVerifiedEmail?: string | undefined;
      readonly insideInteractiveAt?: string | undefined;
    } = {},
    signingKey = privateKey,
    kid = "proof-key-1",
    algorithm: "RS256" | "ES384" = "ES384",
  ): Promise<string> {
    const issuedAt = overrides.issuedAt ?? now;
    const tokenClaims = {
      inside_verified_email:
        "insideVerifiedEmail" in overrides
          ? overrides.insideVerifiedEmail
          : "member@example.test",
      inside_interactive_at:
        "insideInteractiveAt" in overrides
          ? overrides.insideInteractiveAt
          : new Date(issuedAt * 1_000).toISOString(),
      ...claims,
    };

    return new SignJWT(tokenClaims)
      .setProtectedHeader({ alg: algorithm, kid })
      .setIssuer(overrides.issuer ?? issuer)
      .setAudience(overrides.audience ?? audience)
      .setSubject(overrides.subject ?? "human-001")
      .setJti("jwt-001")
      .setIssuedAt(issuedAt)
      .setExpirationTime(overrides.expiresAt ?? issuedAt + 300)
      .sign(signingKey);
  }
});

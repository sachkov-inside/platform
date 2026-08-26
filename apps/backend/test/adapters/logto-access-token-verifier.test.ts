import { createServer } from "node:http";

import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
} from "jose";
import { beforeAll, describe, expect, test } from "vitest";

import { createLogtoAccessTokenVerifier } from "../../src/modules/accounts/infrastructure/idp/logto/logto-access-token-verifier.js";

const issuer = "https://identity.example.test/oidc";
const audience = "https://api.inside.example.test";
const now = Math.floor(Date.now() / 1_000);

describe("Logto access token verifier", () => {
  let privateKey: CryptoKey;
  let publicJwk: JWK;

  beforeAll(async () => {
    const pair = await generateKeyPair("ES384");
    privateKey = pair.privateKey;
    publicJwk = {
      ...(await exportJWK(pair.publicKey)),
      alg: "ES384",
      kid: "proof-key-1",
    };
  });

  test("normalizes a verified human sign-in and discards provider authorization", async () => {
    const token = await signToken({
      inside_verified_email: "Member@Example.Test",
      roles: ["admin", "member"],
      permissions: ["identity:admin"],
    });
    const result = await localVerifier(publicJwk).verifyAccountSignIn(token);

    expect(result).toMatchObject({
      ok: true,
      identity: {
        type: "account_sign_in",
        issuer,
        subject: "human-001",
        verifiedEmail: "Member@Example.Test",
      },
      accountIdentity: {
        type: "account_identity",
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
    ["multiple audiences", { audience: [audience, "https://other.example.test"] }],
    ["expired", { issuedAt: now - 601, expiresAt: now - 301 }],
    ["future issued-at", { issuedAt: now + 60 }],
    ["future not-before", { notBefore: now + 60 }],
    ["lifetime", { issuedAt: now, expiresAt: now + 301 }],
    ["subject", { subject: "" }],
    ["verified email", { insideVerifiedEmail: undefined }],
  ])("fails closed for an invalid %s", async (_name, overrides) => {
    const token = await signToken({}, overrides);
    await expect(localVerifier(publicJwk).verifyAccountSignIn(token)).resolves.toEqual({
      ok: false,
      error: { code: "invalid_proof" },
    });
  });

  test("rejects machine tokens on both Account paths", async () => {
    const token = await signToken(
      { client_id: "service-001" },
      { subject: "service-001" },
    );
    const verifier = localVerifier(publicJwk);
    await expect(verifier.verifyAccountSignIn(token)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_proof" },
    });
    await expect(verifier.verifyAccount(token)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_proof" },
    });
  });

  test("rejects another algorithm, an invalid signature and an unknown key", async () => {
    const rsa = await generateKeyPair("RS256");
    const rsaJwk = {
      ...(await exportJWK(rsa.publicKey)),
      alg: "RS256",
      kid: "rsa-key",
    };
    const rsaToken = await signToken({}, {}, rsa.privateKey, "rsa-key", "RS256");
    await expect(localVerifier(rsaJwk).verifyAccount(rsaToken)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_proof" },
    });

    const attacker = await generateKeyPair("ES384");
    const invalidSignature = await signToken(
      {},
      {},
      attacker.privateKey,
      "proof-key-1",
    );
    await expect(
      localVerifier(publicJwk).verifyAccount(invalidSignature),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_proof" },
    });

    const attackerToken = await signToken({}, {}, attacker.privateKey, "attacker");
    await expect(localVerifier(publicJwk).verifyAccount(attackerToken)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_proof" },
    });
  });

  test("distinguishes a remote JWKS outage", async () => {
    const server = createServer((_request, response) => response.writeHead(503).end());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing port");
    try {
      const verifier = createLogtoAccessTokenVerifier({
        issuer,
        audience,
        jwksUrl: `http://127.0.0.1:${String(address.port)}/jwks`,
      });
      await expect(verifier.verifyAccount(await signToken())).resolves.toEqual({
        ok: false,
        error: { code: "dependency_unavailable" },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    }
  });

  function localVerifier(jwk: JWK) {
    return createLogtoAccessTokenVerifier({ issuer, audience, jwks: { keys: [jwk] } });
  }

  async function signToken(
    claims: Record<string, unknown> = {},
    overrides: {
      readonly issuer?: string;
      readonly audience?: string | string[];
      readonly subject?: string;
      readonly issuedAt?: number;
      readonly expiresAt?: number;
      readonly notBefore?: number;
      readonly insideVerifiedEmail?: string | undefined;
    } = {},
    key: CryptoKey = privateKey,
    kid = "proof-key-1",
    algorithm: "ES384" | "RS256" = "ES384",
  ): Promise<string> {
    const issuedAt = overrides.issuedAt ?? now;
    const token = new SignJWT({
      inside_verified_email:
        overrides.insideVerifiedEmail === undefined &&
        "insideVerifiedEmail" in overrides
          ? undefined
          : (overrides.insideVerifiedEmail ?? "member@example.test"),
      ...claims,
    })
      .setProtectedHeader({ alg: algorithm, kid })
      .setIssuer(overrides.issuer ?? issuer)
      .setAudience(overrides.audience ?? audience)
      .setSubject(overrides.subject ?? "human-001")
      .setIssuedAt(issuedAt)
      .setExpirationTime(overrides.expiresAt ?? issuedAt + 300);
    if (overrides.notBefore !== undefined) {
      token.setNotBefore(overrides.notBefore);
    }
    return token.sign(key);
  }
});

import {
  registerFixedClock,
  fixedTestInstant,
} from "../support/fixed-clock.js";

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

registerFixedClock();

const issuer = "https://identity.example.test/oidc";
const audience = "https://api.inside.example.test";
const now = Math.floor(fixedTestInstant() / 1_000);

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

  test("keeps both same-subject proofs after first email attachment", async () => {
    const telegram = {
      subjectRef: "46100000-0000-4000-8000-000000000001",
      requestRef: "46100000-0000-4000-8000-000000000002",
    };
    const verifier = createLogtoAccessTokenVerifier({
      issuer,
      audience,
      jwks: { keys: [publicJwk] },
      telegramSignInEnabled: true,
    });
    const token = await signToken({ inside_telegram_sign_in: telegram });
    await expect(verifier.verifyAccountSignIn(token)).resolves.toMatchObject({
      ok: true,
      identity: {
        issuer,
        subject: "human-001",
        telegram,
        verifiedEmail: "member@example.test",
      },
    });
    const malformedEmail = await signToken(
      { inside_telegram_sign_in: telegram },
      {
        insideVerifiedEmail: "not-an-email",
      },
    );
    await expect(
      verifier.verifyAccountSignIn(malformedEmail),
    ).resolves.toMatchObject({ ok: false });
  });

  test("Telegram proof is explicit, feature-gated, and does not disable already-issued access tokens", async () => {
    const telegram = {
      subjectRef: "29900000-0000-4000-8000-000000000001",
      requestRef: "29900000-0000-4000-8000-000000000002",
    };
    const token = await signToken(
      { inside_telegram_sign_in: telegram },
      { insideVerifiedEmail: undefined },
    );
    await expect(
      localVerifier(publicJwk).verifyAccountSignIn(token),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      localVerifier(publicJwk).verifyAccount(token),
    ).resolves.toMatchObject({ ok: true });
    const enabled = createLogtoAccessTokenVerifier({
      issuer,
      audience,
      jwks: { keys: [publicJwk] },
      telegramSignInEnabled: true,
    });
    await expect(enabled.verifyAccountSignIn(token)).resolves.toMatchObject({
      ok: true,
      identity: { telegram },
    });
    for (const malformed of [
      null,
      {},
      { ...telegram, subjectRef: "username" },
      { ...telegram, admin: true },
    ]) {
      await expect(
        enabled.verifyAccountSignIn(
          await signToken({ inside_telegram_sign_in: malformed }),
        ),
      ).resolves.toMatchObject({ ok: false });
    }
  });

  test("normalizes a verified human sign-in and discards provider authorization", async () => {
    const token = await signToken({
      inside_verified_email: "Member@Example.Test",
      roles: ["admin", "member"],
      permissions: ["identity:admin"],
    });
    const result = await localVerifier(publicJwk).verifyAccountSignIn(token);
    const accountResult = await localVerifier(publicJwk).verifyAccount(token);

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
    expect(accountResult).toMatchObject({
      ok: true,
      identity: {
        type: "account_identity",
        issuer,
        subject: "human-001",
      },
      expiresAt: now + 300,
    });
    expect(JSON.stringify(accountResult)).not.toContain("admin");
    expect(JSON.stringify(accountResult)).not.toContain("member");
  });

  test.each([
    ["issuer", { issuer: "https://attacker.example.test" }],
    ["audience", { audience: "https://another-api.example.test" }],
    [
      "multiple audiences",
      { audience: [audience, "https://other.example.test"] },
    ],
    ["expired", { issuedAt: now - 601, expiresAt: now - 301 }],
    ["future issued-at", { issuedAt: now + 60 }],
    ["future not-before", { notBefore: now + 60 }],
    ["lifetime", { issuedAt: now, expiresAt: now + 301 }],
    ["subject", { subject: "" }],
    ["verified email", { insideVerifiedEmail: undefined }],
  ])("fails closed for an invalid %s", async (_name, overrides) => {
    const token = await signToken({}, overrides);
    await expect(
      localVerifier(publicJwk).verifyAccountSignIn(token),
    ).resolves.toEqual({
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
    const rsaToken = await signToken(
      {},
      {},
      rsa.privateKey,
      "rsa-key",
      "RS256",
    );
    await expect(
      localVerifier(rsaJwk).verifyAccount(rsaToken),
    ).resolves.toMatchObject({
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

    const attackerToken = await signToken(
      {},
      {},
      attacker.privateKey,
      "attacker",
    );
    await expect(
      localVerifier(publicJwk).verifyAccount(attackerToken),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_proof" },
    });
  });

  test("fails closed during a remote JWKS outage and verifies again after recovery", async () => {
    let available = false;
    const server = createServer((_request, response) => {
      if (!available) return void response.writeHead(503).end();
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ keys: [publicJwk] }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("missing port");
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

      available = true;
      const recoveredVerifier = createLogtoAccessTokenVerifier({
        issuer,
        audience,
        jwksUrl: `http://127.0.0.1:${String(address.port)}/jwks`,
      });
      await expect(
        recoveredVerifier.verifyAccount(await signToken()),
      ).resolves.toMatchObject({
        ok: true,
        identity: { issuer, subject: "human-001" },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
    }
  });

  test("learner resource tokens do not become API sign-in or accept arbitrary audiences", async () => {
    const learner = "https://api.inside.example.test/mcp/learning";
    const token = await signToken(
      { scope: "openid offline_access learning:read" },
      { audience: learner },
    );
    const verifier = localVerifier(publicJwk);
    await expect(verifier.verifyAccount(token, learner)).resolves.toMatchObject(
      { ok: true, scopes: ["openid", "offline_access", "learning:read"] },
    );
    // A resource verifies only its own audience: an API token is not a learner token.
    await expect(
      verifier.verifyAccount(await signToken(), learner),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_proof" } });
    await expect(verifier.verifyAccount(token)).resolves.toMatchObject({
      ok: false,
    });
    await expect(verifier.verifyAccountSignIn(token)).resolves.toMatchObject({
      ok: false,
    });
    const unrelated = await signToken(
      {},
      { audience: "https://other.example.test" },
    );
    await expect(
      verifier.verifyAccount(unrelated, learner),
    ).resolves.toMatchObject({ ok: false });
    const multiple = await signToken({}, { audience: [audience, learner] });
    await expect(
      verifier.verifyAccount(multiple, learner),
    ).resolves.toMatchObject({ ok: false });
  });

  test("a dynamic app token (CIMD) never reaches the Platform API or authoring", async () => {
    // Любой URL может стать клиентом CIMD; ему открыт только учебный ресурс.
    const dynamicClient = "https://phishing.example.test/oauth/client.json";
    const verifier = localVerifier(publicJwk);
    const apiToken = await signToken({ client_id: dynamicClient });
    await expect(verifier.verifyAccount(apiToken)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_proof" },
    });
    await expect(verifier.verifyAccountSignIn(apiToken)).resolves.toMatchObject(
      { ok: false },
    );
    const learner = "https://api.inside.example.test/mcp/learning";
    const learnerToken = await signToken(
      { client_id: dynamicClient, scope: "learning:read" },
      { audience: learner },
    );
    await expect(
      verifier.verifyAccount(learnerToken, learner),
    ).resolves.toMatchObject({ ok: true, scopes: ["learning:read"] });
    // Зарегистрированный клиент Platform по-прежнему входит в API.
    await expect(
      verifier.verifyAccount(
        await signToken({ client_id: "gzs7ska0yc0m0lbjr28l7" }),
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  function localVerifier(jwk: JWK) {
    return createLogtoAccessTokenVerifier({
      issuer,
      audience,
      jwks: { keys: [jwk] },
    });
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

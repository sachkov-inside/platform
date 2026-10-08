// @ts-check
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { unwrapSession } from "@logto/node";
import { z } from "zod";

import { startFullStackIdentity } from "./full-stack-identity.mjs";

// The response fields the assertions below read; the rest passes through.
const discoverySchema = z
  .object({
    issuer: z.unknown().optional(),
    jwks_uri: z.unknown().optional(),
    token_endpoint: z.string(),
  })
  .passthrough();
const grantSchema = z
  .object({ expires_in: z.unknown().optional(), access_token: z.string() })
  .passthrough();
const grantFailureSchema = z
  .object({
    error: z.unknown().optional(),
    code: z.unknown().optional(),
    message: z.string(),
  })
  .passthrough();

/**
 * Срок сессии сквозного набора. Доступ живёт пять минут и проверяется приложением, а набор идёт
 * дольше получаса, поэтому фикстура обязана уметь его продлевать. Проверяется её собственный
 * контракт: адрес продления находится по discovery, известный refresh-токен даёт новый доступ,
 * неизвестный — отказ, по которому истечение видно как истечение.
 */
describe("full-stack identity", () => {
  const apiBaseUrl = "http://127.0.0.1:65001";
  const learningResource = "http://127.0.0.1:65003/mcp/learning";
  /** @type {Awaited<ReturnType<typeof startFullStackIdentity>>} */
  let identity;
  /** @type {string} */
  let tokenEndpoint;
  /**
   * Всё, чем описана сессия, объявляет сама фикстура: тест не заводит второй копии этих фактов.
   *
   * @type {string}
   */
  let clientId;
  /** @type {string} */
  let cookieSecret;
  /** @type {string} */
  let ownerSubject;

  before(async () => {
    identity = await startFullStackIdentity({
      apiBaseUrl,
      webBaseUrl: "http://127.0.0.1:65002",
      learningResource,
    });
    const discovery = await fetch(
      `${identity.environment.LOGTO_ENDPOINT}/oidc/.well-known/openid-configuration`,
    );
    assert.equal(discovery.status, 200);
    const document = discoverySchema.parse(await discovery.json());
    assert.equal(document.issuer, identity.environment.LOGTO_ISSUER);
    assert.equal(document.jwks_uri, identity.environment.LOGTO_JWKS_URL);
    tokenEndpoint = document.token_endpoint;
    clientId = identity.environment.LOGTO_APP_ID;
    cookieSecret = identity.environment.LOGTO_COOKIE_SECRET;
    ownerSubject = identity.environment.OWNER_LOGTO_SUBJECT;
  });

  after(async () => {
    await identity.close();
  });

  it("renews an access token for a session it issued", async () => {
    const cookie = await identity.createSession(
      await identity.createAccessToken(),
    );
    const renewed = await grant({
      grant_type: "refresh_token",
      refresh_token: await refreshTokenOf(cookie),
      resource: apiBaseUrl,
      client_id: clientId,
    });

    assert.equal(renewed.status, 200);
    const body = grantSchema.parse(await renewed.json());
    assert.equal(body.expires_in, identity.accessTokenTtlSeconds);
    assert.equal(typeof body.access_token, "string");
    const claims = claimsOf(body.access_token);
    assert.equal(claims.sub, ownerSubject);
    assert.equal(claims.aud, apiBaseUrl);
    // Продлённый доступ живёт ровно тот же короткий срок: продление не удлиняет его.
    assert.equal(claims.exp - claims.iat, identity.accessTokenTtlSeconds);
  });

  it("renews a session whose access has already run out", async () => {
    const cookie = await identity.createSessionPastExpiry();
    const stale = claimsOf(accessTokenOf(await sessionOf(cookie), apiBaseUrl));

    // deterministic-test-allow wall-clock: Legacy clock read; fixed domain or monotonic clock migration is tracked in #1177.
    assert.ok(stale.exp < Math.floor(Date.now() / 1_000));
    const renewed = await grant({
      grant_type: "refresh_token",
      refresh_token: await refreshTokenOf(cookie),
      resource: apiBaseUrl,
      client_id: clientId,
    });
    assert.equal(renewed.status, 200);
  });

  it("refuses a session it cannot renew instead of inventing one", async () => {
    const cookie = await identity.createSessionWithoutRenewal();

    const refused = await grant({
      grant_type: "refresh_token",
      refresh_token: await refreshTokenOf(cookie),
      resource: apiBaseUrl,
      client_id: clientId,
    });

    assert.equal(refused.status, 400);
    // Форма отказа fork Logto (#1005): web узнаёт отвергнутый grant по коду `oidc.invalid_grant`.
    // С другим кодом непродлеваемая сессия покажется приложению недоступностью.
    const body = grantFailureSchema.parse(await refused.json());
    assert.equal(body.error, "invalid_grant");
    assert.equal(body.code, "oidc.invalid_grant");
    assert.equal(typeof body.message, "string");
    assert.ok(body.message.length > 0);
  });

  it("refuses a renewal aimed at another audience", async () => {
    const cookie = await identity.createSession(
      await identity.createAccessToken(),
    );

    const refused = await grant({
      grant_type: "refresh_token",
      refresh_token: await refreshTokenOf(cookie),
      resource: "http://127.0.0.1:65999",
      client_id: clientId,
    });

    assert.equal(refused.status, 400);
    assert.deepEqual(await refused.json(), {
      error: "invalid_target",
      code: "oidc.invalid_target",
      message: "Requested resource is not this audience",
    });
  });

  it("issues a learner agent a learning:read token for the learner MCP resource (#948)", async () => {
    const renewed = await grant({
      grant_type: "refresh_token",
      refresh_token: identity.createRefreshToken("fullstack-learner"),
      resource: learningResource,
      client_id: clientId,
    });

    assert.equal(renewed.status, 200);
    const body = grantSchema.parse(await renewed.json());
    assert.equal(body["scope"], "learning:read");
    const claims = claimsOf(body.access_token);
    assert.equal(claims.sub, "fullstack-learner");
    assert.equal(claims.aud, learningResource);
    assert.equal(
      z.object({ scope: z.string() }).passthrough().parse(claims).scope,
      "learning:read",
    );
  });

  /** @param {Record<string, string>} parameters */
  function grant(parameters) {
    return fetch(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(parameters).toString(),
    });
  }

  /**
   * Cookie зашифрован секретом, который объявила фикстура; тест читает его тем же способом.
   *
   * @param {string} cookie
   */
  function sessionOf(cookie) {
    return unwrapSession(cookie, cookieSecret);
  }

  /** @param {string} cookie */
  async function refreshTokenOf(cookie) {
    const { refreshToken } = await sessionOf(cookie);
    assert.ok(
      refreshToken !== undefined,
      "the session carries a refresh token",
    );
    return refreshToken;
  }
});

/**
 * Доступ, сохранённый в сессии для своей аудитории.
 *
 * @param {import("@logto/node").SessionData} session
 * @param {string} audience
 */
function accessTokenOf(session, audience) {
  assert.ok(session.accessToken !== undefined, "the session carries access");
  const stored = z
    .record(z.string(), z.object({ token: z.string() }).passthrough())
    .parse(JSON.parse(session.accessToken))[`@${audience}`];
  assert.ok(stored, `the session holds access for ${audience}`);
  return stored.token;
}

/** @param {string} accessToken */
function claimsOf(accessToken) {
  const [, payload = ""] = accessToken.split(".");
  return z
    .object({
      sub: z.unknown().optional(),
      aud: z.unknown().optional(),
      iat: z.number(),
      exp: z.number(),
    })
    .passthrough()
    .parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
}

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { unwrapSession } from "@logto/node";

import { startFullStackIdentity } from "./full-stack-identity.mjs";

/**
 * Срок сессии сквозного набора. Доступ живёт пять минут и проверяется приложением, а набор идёт
 * дольше получаса, поэтому фикстура обязана уметь его продлевать. Проверяется её собственный
 * контракт: адрес продления находится по discovery, известный refresh-токен даёт новый доступ,
 * неизвестный — отказ, по которому истечение видно как истечение.
 */
describe("full-stack identity", () => {
  const apiBaseUrl = "http://127.0.0.1:65001";
  let identity;
  let tokenEndpoint;
  /** Всё, чем описана сессия, объявляет сама фикстура: тест не заводит второй копии этих фактов. */
  let clientId;
  let cookieSecret;
  let ownerSubject;

  before(async () => {
    identity = await startFullStackIdentity({
      apiBaseUrl,
      webBaseUrl: "http://127.0.0.1:65002",
    });
    const discovery = await fetch(
      `${identity.environment.LOGTO_ENDPOINT}/oidc/.well-known/openid-configuration`,
    );
    assert.equal(discovery.status, 200);
    const document = await discovery.json();
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
    const body = await renewed.json();
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
    // Клиент Logto считает ошибкой сервера только тело с code и message. Без них отказ станет
    // «неожиданным ответом», и непродлеваемая сессия покажется приложению недоступностью.
    const body = await refused.json();
    assert.equal(body.error, "invalid_grant");
    assert.equal(body.code, "invalid_grant");
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
      code: "invalid_target",
      message: "Requested resource is not this audience",
    });
  });

  function grant(parameters) {
    return fetch(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(parameters).toString(),
    });
  }

  /** Cookie зашифрован секретом, который объявила фикстура; тест читает его тем же способом. */
  function sessionOf(cookie) {
    return unwrapSession(cookie, cookieSecret);
  }

  async function refreshTokenOf(cookie) {
    return (await sessionOf(cookie)).refreshToken;
  }
});

/** Доступ, сохранённый в сессии для своей аудитории. */
function accessTokenOf(session, audience) {
  return JSON.parse(session.accessToken)[`@${audience}`].token;
}

function claimsOf(accessToken) {
  const payload = accessToken.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

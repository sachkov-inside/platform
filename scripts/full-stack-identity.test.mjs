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
      client_id: "inside-web-fullstack",
    });

    assert.equal(renewed.status, 200);
    const body = await renewed.json();
    assert.equal(body.expires_in, 300);
    assert.equal(typeof body.access_token, "string");
    assert.equal(claimsOf(body.access_token).sub, "fullstack-owner");
    // Новый доступ живёт свои пять минут от выдачи: короткий срок остаётся коротким.
    assert.ok(
      claimsOf(body.access_token).exp - Math.floor(Date.now() / 1_000) > 240,
    );
  });

  it("keeps the five-minute access token short in a session past its expiry", async () => {
    const cookie = await identity.createSessionPastExpiry();
    const stale = JSON.parse((await sessionOf(cookie)).accessToken)[`@${apiBaseUrl}`];

    assert.ok(stale.expiresAt < Math.floor(Date.now() / 1_000));
    const renewed = await grant({
      grant_type: "refresh_token",
      refresh_token: await refreshTokenOf(cookie),
      resource: apiBaseUrl,
      client_id: "inside-web-fullstack",
    });
    assert.equal(renewed.status, 200);
  });

  it("refuses a session it cannot renew instead of inventing one", async () => {
    const cookie = await identity.createSessionWithoutRenewal();

    const refused = await grant({
      grant_type: "refresh_token",
      refresh_token: await refreshTokenOf(cookie),
      resource: apiBaseUrl,
      client_id: "inside-web-fullstack",
    });

    assert.equal(refused.status, 400);
    assert.deepEqual(await refused.json(), { error: "invalid_grant" });
  });

  it("refuses a renewal aimed at another audience", async () => {
    const cookie = await identity.createSession(
      await identity.createAccessToken(),
    );

    const refused = await grant({
      grant_type: "refresh_token",
      refresh_token: await refreshTokenOf(cookie),
      resource: "http://127.0.0.1:65999",
      client_id: "inside-web-fullstack",
    });

    assert.equal(refused.status, 400);
    assert.deepEqual(await refused.json(), { error: "invalid_target" });
  });

  function grant(parameters) {
    return fetch(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(parameters).toString(),
    });
  }

});

/** Cookie сессии зашифрован тем же секретом, что и в приложении; тест читает его тем же способом. */
function sessionOf(cookie) {
  return unwrapSession(cookie, "inside-fullstack-cookie-secret-key");
}

async function refreshTokenOf(cookie) {
  return (await sessionOf(cookie)).refreshToken;
}

function claimsOf(accessToken) {
  const payload = accessToken.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

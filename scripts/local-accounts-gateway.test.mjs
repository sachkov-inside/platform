// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { createServer, request as httpRequest } from "node:http";
import {
  startLocalAccountsGateway,
  validateLocalAccountsSettings,
} from "./local-accounts-gateway.mjs";

test("local accounts reject production and non-local identity before opening a listener", () => {
  const settings = {
    mode: "development",
    endpoint: "https://identity.inside.localhost:3301",
    audience: "http://127.0.0.1:3001",
    webBaseUrl: "http://127.0.0.1:3000",
  };
  assert.doesNotThrow(() => validateLocalAccountsSettings(settings));
  for (const override of [
    { mode: "production" },
    { endpoint: "https://identity.inside.ru" },
    { audience: "https://platform.inside.ru/api" },
    { webBaseUrl: "https://platform.inside.ru" },
  ]) {
    assert.throws(() =>
      validateLocalAccountsSettings({ ...settings, ...override }),
    );
  }
});

test("owned loopback gateway defaults to owner and retains explicit guest and learner across requests", async (t) => {
  let receivedRequests = 0;
  const upstream = createServer((request, response) => {
    receivedRequests++;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        cookie: request.headers.cookie ?? "",
        host: request.headers["x-forwarded-host"],
      }),
    );
  });
  t.after(() => new Promise((done) => upstream.close(done)));
  await new Promise((done) =>
    upstream.listen(0, "127.0.0.1", () => done(undefined)),
  );
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const gateway = await startLocalAccountsGateway({
    port: 0,
    upstream: `http://127.0.0.1:${address.port}`,
    cookieName: "logto_local-test",
    secret: "local-test-secret-with-32-characters",
    createSession: (choice) => Promise.resolve(`session-${choice}`),
  });
  t.after(gateway.close);
  const first = await fetch(gateway.origin);
  assert.match(await first.text(), /session-owner/u);
  /** Node fetch owns Host itself; raw HTTP exercises the untrusted Host boundary.
   * @param {string} host
   * @returns {Promise<{ status: number | undefined; location: string | undefined }>} */
  const hostRequest = (host) =>
    new Promise((done, reject) => {
      const request = httpRequest(
        gateway.origin,
        { headers: { host } },
        (response) => {
          response.resume();
          done({
            status: response.statusCode,
            location: response.headers.location,
          });
        },
      );
      request.once("error", reject);
      request.end();
    });
  const alias = await hostRequest(
    new URL(gateway.origin).host.replace("127.0.0.1", "localhost"),
  );
  assert.equal(alias.status, 307);
  assert.equal(alias.location, `${gateway.origin}/`);
  assert.equal((await hostRequest("attacker.test")).status, 403);
  const beforeInvalid = receivedRequests;
  /** @type {number | undefined} */
  const invalidTarget = await new Promise((done, reject) => {
    const request = httpRequest(
      gateway.origin,
      { path: `/\\127.0.0.1:${address.port}/stolen` },
      (response) => {
        response.resume();
        done(response.statusCode);
      },
    );
    request.once("error", reject);
    request.end();
  });
  assert.equal(invalidTarget, 403);
  assert.equal(receivedRequests, beforeInvalid);
  for (const headers of [
    { origin: "https://attacker.test" },
    { "sec-fetch-site": "cross-site" },
  ]) {
    assert.equal((await fetch(gateway.origin, { headers })).status, 403);
  }
  for (const headers of [{}, { origin: "https://attacker.test" }]) {
    assert.equal(
      (
        await fetch(`${gateway.origin}/__local/accounts`, {
          method: "POST",
          headers,
          body: "choice=owner",
        })
      ).status,
      403,
    );
  }
  const forged = await fetch(gateway.origin, {
    headers: {
      cookie: "inside.local-account=owner.forged; logto_local-test=owner",
    },
  });
  assert.equal((await forged.text()).includes("session-owner"), false);
  for (const choice of ["guest", "learner", "learner-with-access", "owner"]) {
    const switched = await fetch(`${gateway.origin}/__local/accounts`, {
      method: "POST",
      headers: {
        origin: gateway.origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ choice, returnTo: "/authoring/materials" }),
      redirect: "manual",
    });
    assert.equal(switched.status, 303);
    assert.equal(switched.headers.get("location"), "/authoring/materials");
    const cookie = switched.headers.getSetCookie()[0]?.split(";")[0];
    assert.ok(cookie);
    const next = await fetch(gateway.origin, {
      headers: { cookie: `${cookie}; logto_local-test=old-owner` },
    });
    const body = await next.text();
    assert.equal(body.includes("session-owner"), choice === "owner");
    assert.equal(body.includes("old-owner"), false);
    if (choice !== "guest") assert.ok(body.includes(`session-${choice}`));
    else assert.equal(body.includes("logto_"), false);
  }
});

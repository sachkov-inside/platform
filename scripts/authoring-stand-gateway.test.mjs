import assert from "node:assert/strict";
import { test } from "node:test";

import { forwardedPath, tokenCache } from "./authoring-stand-gateway.mjs";

test("forwards only authoring API paths from a non-browser loopback client", () => {
  const host = "127.0.0.1:4398";
  assert.equal(forwardedPath(host, "/__local-api/authoring/import/materials/apply", undefined), "/authoring/import/materials/apply");
  assert.equal(forwardedPath(host, "/__local-api/authoring/collections?kind=topic", undefined), "/authoring/collections?kind=topic");
  for (const [candidateHost, url, origin] of [
    ["localhost:4398", "/__local-api/authoring/materials", undefined],
    ["evil.example", "/__local-api/authoring/materials", undefined],
    [host, "/__local-api/authoring/materials", "http://127.0.0.1:3000"],
    [host, "/__local-api/accounts/me", undefined],
    [host, "/authoring/materials", undefined],
    [host, "/__local-api/authoring/../accounts/me", undefined],
    [host, "/__local-api/authoring/%2e%2e/accounts", undefined],
    [host, "/__local-api/authoring//materials", undefined],
  ]) assert.equal(forwardedPath(candidateHost, url, origin), null, `${candidateHost} ${url}`);
  assert.equal(forwardedPath(host, "/__local-api/authoring/materials", undefined, "cross-site"), null);
});

test("reuses an access token until shortly before it expires", async () => {
  let now = 0;
  let exchanges = 0;
  const token = tokenCache(() => Promise.resolve({ access_token: `token-${String(++exchanges)}`, expires_in: 300 }), () => now);
  assert.equal(await token(), "token-1");
  now = 250_000;
  assert.equal(await token(), "token-1");
  now = 271_000;
  assert.equal(await token(), "token-2");
});

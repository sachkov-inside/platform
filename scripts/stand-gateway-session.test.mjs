// @ts-check
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import {
  gatewayIdentity,
  gatewayIdentityPath,
} from "./authoring-stand-gateway.mjs";
import { probeGateway } from "./stand-gateway-session.mjs";

/** @param {import("node:http").RequestListener} handler */
async function listen(handler) {
  const server = createServer(handler);
  await new Promise((done) =>
    server.listen(0, "127.0.0.1", () => done(undefined)),
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: () => new Promise((done) => server.close(() => done(undefined))),
  };
}

test("only a gateway that reports its identity counts as the stand gateway", async (t) => {
  const identity = gatewayIdentity({
    owner: "owner@example.invalid",
    api: "http://127.0.0.1:3001",
  });
  const gateway = await listen((request, response) => {
    if (request.url === gatewayIdentityPath)
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(identity));
    else response.writeHead(404).end();
  });
  t.after(gateway.close);
  const found = await probeGateway(gateway.origin);
  assert.equal(found.kind, "gateway");
  assert.equal(
    found.kind === "gateway" && found.identity.owner,
    "owner@example.invalid",
  );

  // An older gateway or another local server answers HTTP, but not with an identity.
  for (const answer of [
    (/** @type {import("node:http").ServerResponse} */ response) =>
      response.writeHead(403).end(),
    (/** @type {import("node:http").ServerResponse} */ response) =>
      response
        .writeHead(200, { "content-type": "text/html" })
        .end("<html>Next.js</html>"),
    (/** @type {import("node:http").ServerResponse} */ response) =>
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ ...identity, service: "something-else" })),
  ]) {
    const foreign = await listen((_request, response) => answer(response));
    const probed = await probeGateway(foreign.origin);
    await foreign.close();
    assert.equal(probed.kind, "foreign");
  }

  const closed = await listen(() => {});
  await closed.close();
  assert.deepEqual(await probeGateway(closed.origin), { kind: "free" });
});

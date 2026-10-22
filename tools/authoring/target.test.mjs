// @ts-check
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { localTransport } from "./target.mjs";

test("a read without any HTTP answer is repeated; a write is left to its journal", async (t) => {
  let attempts = 0;
  const server = createServer((request, response) => {
    attempts += 1;
    // The first connection of each request drops before an answer, as a flaky network does.
    if (attempts % 2 === 1) {
      request.socket.destroy();
      return;
    }
    response
      .writeHead(200, { "content-type": "application/json" })
      .end('{"ok":true}');
  });
  await new Promise((done) =>
    server.listen(0, "127.0.0.1", () => done(undefined)),
  );
  t.after(() => new Promise((done) => server.close(() => done(undefined))));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const send = localTransport(`http://127.0.0.1:${String(address.port)}`);
  assert.deepEqual(await send("/authoring/home-pin"), { ok: true });
  assert.equal(attempts, 2);
  attempts = 0;
  await assert.rejects(
    send("/authoring/import/materials/apply", { x: 1 }, "key"),
    TypeError,
  );
  assert.equal(attempts, 1);
});

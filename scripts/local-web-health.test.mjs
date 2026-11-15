// @ts-check
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { z } from "zod";

import { spawnOwned, stopOwned } from "./owned-process.mjs";

/** @param {import('node:test').TestContext} t @param {number | null} readyStatus */
async function runProbe(t, readyStatus) {
  const compose = await readFile(
    new URL("../compose.yaml", import.meta.url),
    "utf8",
  );
  const web = compose.split(/^ {2}web:\n/mu)[1]?.split(/^ {2}\S/mu)[0];
  assert.ok(web);
  const instruction = /healthcheck:\s+test:\s+(\[[\s\S]*?\])/u.exec(web)?.[1];
  assert.ok(instruction);
  const command = z
    .array(z.string())
    .parse(JSON.parse(instruction.replace(/,\s*\]/u, "]")));
  assert.equal(command[0], "CMD");
  assert.equal(command[1], "node");
  const paths = /** @type {string[]} */ ([]);
  const server = createServer((request, response) => {
    paths.push(request.url ?? "");
    if (readyStatus === null) return;
    response.statusCode = request.url === "/_health/ready" ? readyStatus : 200;
    response.end();
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const directory = await mkdtemp(join(tmpdir(), "local-web-health-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = join(directory, "loopback.mjs");
  await writeFile(
    fixture,
    `const original = globalThis.fetch; globalThis.fetch = (input, init) => original(new URL(new URL(input).pathname, 'http://127.0.0.1:${address.port}'), init);`,
  );
  const child = spawnOwned(
    process.execPath,
    ["--import", fixture, ...command.slice(2)],
    { stdio: "ignore" },
  );
  const probeDeadlineMilliseconds = 5000;
  const deadline = setTimeout(
    () => void stopOwned(child, 0),
    probeDeadlineMilliseconds,
  );
  t.after(async () => {
    clearTimeout(deadline);
    await stopOwned(child, 0);
  });
  /** @type {Promise<[number | null, NodeJS.Signals | null]>} */
  const exited = new Promise((resolveExit) =>
    child.once("exit", (code, signal) => resolveExit([code, signal])),
  );
  const [code, signal] = await exited;
  assert.equal(signal, null);
  return { code, paths };
}

test("local Web is unhealthy when readiness fails although the public homepage returns 200", async (t) => {
  const result = await runProbe(t, 503);
  assert.equal(result.code, 1);
});

test("local Web readiness succeeds without rendering the public homepage", async (t) => {
  const result = await runProbe(t, 200);
  assert.equal(result.code, 0);
  assert.deepEqual(result.paths, ["/_health/ready"]);
});

test("local Web readiness exits with failure when the HTTP response never arrives", async (t) => {
  const result = await runProbe(t, null);
  assert.equal(result.code, 1);
  assert.deepEqual(result.paths, ["/_health/ready"]);
});

// @ts-check
// deterministic-test-allow unit-io: the root tooling caller externally owns this complete group; all native HTTP listeners and inherited CLI children close on success/failure/timeout/signals.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  startWebHttpMetrics,
  webHttpRoutes,
} from "../../apps/web/server/web-http-metrics.ts";

const client = fileURLToPath(new URL("./client.mjs", import.meta.url));
const profile = fileURLToPath(
  new URL("../../infra/observability/fullstack/profile.json", import.meta.url),
);
/** @param {import('node:http').Server} server */
async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}
/** @param {import('node:http').Server} server */
async function close(server) {
  server.closeAllConnections();
  if (server.listening)
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve(undefined))),
    );
}
/** @param {string} loader @param {string[]} args @returns {Promise<{code: number | null, stdout: string, stderr: string}>} */
async function cli(loader, args) {
  // deterministic-test-allow process-cleanup: no detached child group; root runOwnedProcess remains outside and owns this worker plus every CLI descendant, including worker SIGKILL.
  const child = spawn(process.execPath, ["--import", loader, client, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  /** @type {Promise<{code: number | null, stdout: string, stderr: string}>} */
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
    child.stdout.on("data", (value) => {
      stdout += value;
      if (Buffer.byteLength(stdout) > 65536) child.kill("SIGKILL");
    });
    child.stderr.on("data", (value) => {
      stderr += value;
      if (Buffer.byteLength(stderr) > 65536) child.kill("SIGKILL");
    });
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 8000);
  try {
    return await done;
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await done.catch(() => {});
  }
}

// The external caller owns temporary files even when this worker is killed.
const directory = process.argv[2];
assert.ok(directory);
let appRequests = 0,
  sourceRequests = 0,
  mode = "complete";
const app = createServer((request, response) => {
  appRequests++;
  response
    .writeHead(request.url?.startsWith("/_health/live?") ? 200 : 404)
    .end("synthetic");
});
/** @type {Awaited<ReturnType<typeof startWebHttpMetrics>> | undefined} */
let source;
const proxy = createServer(async (request, response) => {
  sourceRequests++;
  assert.equal(request.url, "/metrics");
  assert.ok(source);
  const result = await fetch(`http://127.0.0.1:${source.port}/metrics`);
  let body = await result.text();
  if (mode === "missing")
    body = body
      .split("\n")
      .filter((row) => !row.includes('route="_unmatched"'))
      .join("\n");
  if (mode === "private") body += "private-http-sentinel";
  response.writeHead(mode === "unavailable" ? 503 : result.status).end(body);
});
try {
  const appPort = await listen(app);
  source = await startWebHttpMetrics({
    applicationPort: appPort,
    host: "127.0.0.1",
    port: 0,
    routes: webHttpRoutes({
      staticRoutes: [{ page: "/_health/live", regex: "^/_health/live$" }],
      dynamicRoutes: [],
    }),
    sourceSha: "7".repeat(40),
    environment: "test",
  });
  const sourcePort = await listen(proxy);
  const loader = join(directory, "preload.mjs");
  await writeFile(
    loader,
    `import fs from 'node:fs';import http from 'node:http';import {syncBuiltinESMExports} from 'node:module';
const read=fs.readFileSync;fs.readFileSync=(p,...a)=>read(p==='/resource/full-profile.json'?${JSON.stringify(profile)}:p,...a);
const request=http.request;http.request=(o,cb)=>{if(!['web','inside-web-http'].includes(o.hostname))throw new Error('fixture target');return request({...o,hostname:'127.0.0.1',port:o.hostname==='web'?${appPort}:${sourcePort}},cb);};syncBuiltinESMExports();`,
  );
  for (const current of ["complete", "missing", "private", "unavailable"]) {
    mode = current;
    appRequests = 0;
    sourceRequests = 0;
    const result = await cli(loader, ["web-http-witness"]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { ok: current === "complete" });
    assert.equal(appRequests, 2);
    assert.equal(sourceRequests, 1);
  }
  for (const [host, port, path] of /** @type {const} */ ([
    ["inside-web-http", "9421", "/metrics"],
    ["inside-web-http", "9420", "/"],
    ["inside-web-http.example", "9420", "/metrics"],
    ["169.254.169.254", "9420", "/metrics"],
  ])) {
    appRequests = 0;
    sourceRequests = 0;
    const result = await cli(loader, [
      "ready",
      host,
      port,
      path,
      "7".repeat(40),
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /private target only/u);
    assert.equal(appRequests, 0);
    assert.equal(sourceRequests, 0);
  }
  console.log(
    JSON.stringify({
      cases: 8,
      complete: true,
      private: false,
      missing: false,
      unavailable: false,
      forbidden: 4,
    }),
  );
} finally {
  await close(proxy);
  await source?.stop();
  await close(app);
}

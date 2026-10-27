// @ts-check
// deterministic-test-allow unit-io: the root tooling caller externally owns this complete group; all native HTTP listeners and inherited CLI children close on success/failure/timeout/signals.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { webHttpExpected } from "./responses.mjs";
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
let previousBody = "";
let gatewayRequests = 0;
let storedMode = "complete";
const expected = {
  ok: true,
  positive_count: 42,
  not_found_count: 43,
  process_start_seconds: 100,
  observed_at_seconds: 200.125,
};
const gateway = createServer((request, response) => {
  gatewayRequests++;
  assert.equal(request.headers.authorization, "Bearer synthetic_query_key");
  const url = new URL(request.url ?? "", "http://fixed.invalid");
  assert.equal(url.pathname, "/metrics/api/v1/query");
  assert.equal(url.searchParams.get("nocache"), "1");
  const query = url.searchParams.get("query") ?? "";
  assert.ok(query.includes('source_sha="' + "7".repeat(40) + '"'));
  assert.ok(
    query.includes(
      'route="/_health/live",method="GET",code="200",outcome="completed"} and (timestamp(',
    ),
  );
  assert.ok(
    query.includes(
      'route="_unmatched",method="GET",code="404",outcome="completed"} and (timestamp(',
    ),
  );
  assert.ok(query.includes('up{job="platform-web-http",instance="web"} == 1'));
  assert.ok(query.includes("} >= 200.125)"));
  assert.ok(query.includes(") >= 200.125)) >= 42"));
  assert.ok(query.includes(") >= 200.125)) >= 43"));
  assert.ok(query.includes("}) >= 0"));
  assert.ok(query.includes("}) <= 10"));
  // The native VM proof executes these predicates. This loopback boundary owns
  // exact request construction and closed response admission only.
  const rows =
    storedMode === "complete" ? [{ metric: {}, value: [200.125, "42"] }] : [];
  response.writeHead(200, { "content-type": "application/json" }).end(
    JSON.stringify({
      status: "success",
      data: { resultType: "vector", result: rows },
    }),
  );
});
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
  if (mode === "unchanged") {
    if (sourceRequests === 1) previousBody = body;
    else body = previousBody;
  }
  if (mode === "wrong-source")
    body = body.replaceAll("7".repeat(40), "8".repeat(40));
  if (mode === "epoch-change" && sourceRequests === 2)
    body = body.replace(
      /(inside_web_http_process_start_time_seconds[^\n]* )[^\n]+/u,
      "$11",
    );
  if (mode === "duplicate")
    body +=
      body
        .split("\n")
        .find((row) => row.startsWith("inside_web_http_observed_at_seconds")) +
      "\n";
  if (mode === "nonfinite")
    body = body.replace(
      /(inside_web_http_observed_at_seconds[^\n]* )[^\n]+/u,
      "$1NaN",
    );
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
  const gatewayPort = await listen(gateway);
  const loader = join(directory, "preload.mjs");
  await writeFile(
    loader,
    `import fs from 'node:fs';import http from 'node:http';import {syncBuiltinESMExports} from 'node:module';
const read=fs.readFileSync;fs.readFileSync=(p,...a)=>p==='/query/key'?'synthetic_query_key':read(p==='/resource/full-profile.json'?${JSON.stringify(profile)}:p,...a);
const request=http.request;http.request=(o,cb)=>{if(!['web','inside-web-http','gateway'].includes(o.hostname))throw new Error('fixture target');return request({...o,hostname:'127.0.0.1',port:o.hostname==='web'?${appPort}:o.hostname==='gateway'?${gatewayPort}:${sourcePort}},cb);};syncBuiltinESMExports();`,
  );
  await fetch(`http://127.0.0.1:${appPort}/_health/live?warmup`);
  await fetch(`http://127.0.0.1:${appPort}/missing?warmup`);
  for (const current of [
    "complete",
    "missing",
    "private",
    "unavailable",
    "unchanged",
    "wrong-source",
    "epoch-change",
    "duplicate",
    "nonfinite",
  ]) {
    mode = current;
    appRequests = 0;
    sourceRequests = 0;
    const started = Date.now() / 1000;
    const result = await cli(loader, ["web-http-witness", "7".repeat(40)]);
    assert.equal(result.code, 0, result.stderr);
    /** @type {unknown} */
    const observed = JSON.parse(result.stdout);
    if (current === "complete") {
      assert.ok(webHttpExpected(observed));
      assert.deepEqual(
        Object.keys(observed).sort(),
        [
          "ok",
          "positive_count",
          "not_found_count",
          "process_start_seconds",
          "observed_at_seconds",
        ].sort(),
      );
      assert.equal(observed.positive_count, 2);
      assert.equal(observed.not_found_count, 2);
      assert.ok(observed.process_start_seconds > 0);
      assert.ok(observed.observed_at_seconds >= started);
      assert.ok(observed.observed_at_seconds <= Date.now() / 1000);
    } else assert.deepEqual(observed, { ok: false });
    assert.equal(appRequests, 2);
    assert.equal(sourceRequests, 2);
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
  for (const current of ["complete", "missing"]) {
    storedMode = current;
    const result = await cli(loader, [
      "web-http-ready",
      "7".repeat(40),
      JSON.stringify(expected),
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { ok: current === "complete" });
  }
  for (const invalid of [
    { ok: true },
    { ...expected, positive_count: true },
    { ...expected, not_found_count: 0 },
    { ...expected, positive_count: 1.5 },
    { ...expected, process_start_seconds: 201 },
    { ...expected, private: "sentinel" },
  ]) {
    gatewayRequests = 0;
    const result = await cli(loader, [
      "web-http-ready",
      "7".repeat(40),
      JSON.stringify(invalid),
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /closed Web witness required/u);
    assert.equal(gatewayRequests, 0);
  }
  for (const encoded of [
    "{private-http-sentinel",
    JSON.stringify("private-http-sentinel"),
    "x".repeat(513),
  ]) {
    gatewayRequests = 0;
    const result = await cli(loader, [
      "web-http-ready",
      "7".repeat(40),
      encoded,
    ]);
    assert.notEqual(result.code, 0);
    assert.doesNotMatch(result.stderr, /private-http-sentinel/u);
    assert.equal(gatewayRequests, 0);
  }
  console.log(
    JSON.stringify({
      cases: 24,
      complete: true,
      private: false,
      missing: false,
      unavailable: false,
      forbidden: 4,
    }),
  );
} finally {
  await close(gateway);
  await close(proxy);
  await source?.stop();
  await close(app);
}

// @ts-check
// deterministic-test-allow unit-io: the root tooling caller externally owns this worker, its HTTP listeners and inherited CLI child, including worker SIGKILL; temporary files belong to that caller.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
const directory = process.argv[2];
assert.ok(directory);
const client = fileURLToPath(new URL("./client.mjs", import.meta.url));
const profile = fileURLToPath(
  new URL("../../infra/observability/fullstack/profile.json", import.meta.url),
);
const enabled = process.argv[3] === "on";
const queryFailures = process.argv[4] === "query-failures";
const diagnosticOrdinal = process.argv[4]?.startsWith("stability-")
  ? Number(process.argv[4].slice("stability-".length))
  : null;
/** @type {number[]} */ const actorIndices = [];
/** @type {number[]} */ const updateIds = [];
const slotControl = process.argv[5];
assert.ok(
  slotControl === undefined || ["probe", "application"].includes(slotControl),
);
let queryCycle = 0;
let heldCount = 0;
/** @type {()=>void} */ let releaseHeld = () => {};
const held = new Promise((resolve) => {
  releaseHeld = () => resolve(undefined);
});
const account = "00000000-0000-4000-8000-000000001566";
/** @type {Record<string, number>} */ const counts = {};
/** @param {unknown} value @param {string} key @returns {unknown} */
function field(value, key) {
  assert.ok(value !== null && typeof value === "object" && key in value);
  return Reflect.get(value, key);
}
/** @param {unknown} value @returns {unknown} */
function first(value) {
  assert.ok(Array.isArray(value) && value.length > 0);
  return value[0];
}
/** @param {unknown} value @returns {value is [number, number, number, number]} */
function timingRow(value) {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}
/** @param {unknown} value @param {string} key */
function attribute(value, key) {
  assert.ok(Array.isArray(value));
  for (const item of value) {
    if (field(item, "key") === key) {
      const text = field(field(item, "value"), "stringValue");
      assert.equal(typeof text, "string");
      assert.ok(typeof text === "string");
      return text;
    }
  }
  throw new Error("fixed fixture attribute missing");
}
/** @type {Map<string, number>} */ const stored = new Map();
let monitoringQueries = 0;
/** @param {number} ready */
function sourceVector(ready = 2) {
  const cut = Math.floor(Date.now() / 1000);
  return {
    status: "success",
    data: {
      resultType: "vector",
      result: [
        {
          metric: { job: "source_cache_ready", source: "cohort" },
          value: [cut, String(ready)],
        },
        {
          metric: { job: "source_cache_evaluation", source: "cohort" },
          value: [cut, String(cut)],
        },
        ...["postgresql", "caddy"].flatMap((source) => [
          {
            metric: { job: "source_cache_available", source },
            value: [cut, "1"],
          },
          {
            metric: { job: "source_cache_observed", source },
            value: [cut, String(cut - 1)],
          },
          { metric: { job: "source_cache_age", source }, value: [cut, "1"] },
        ]),
      ],
    },
  };
}
const server = createServer(async (request, response) => {
  const host = String(request.headers["x-fixture-host"]);
  counts[host] = (counts[host] ?? 0) + 1;
  // deterministic-test-allow duration-wait: bounded loopback response delay isolates real slot occupancy; the external owner retains the original15s deadline.
  if (
    (slotControl === "probe" && host === "alloy") ||
    (slotControl === "application" &&
      [
        "site.resource.test",
        "api.resource.test",
        "mcp",
        "telegram",
        "logto",
        "umami-ingest",
      ].includes(host))
  )
    await delay(300);
  let body = "";
  for await (const chunk of request) body += String(chunk);
  let status = 200;
  /** @type {unknown} */ let value;
  if (host === "alloy") {
    // deterministic-test-allow duration-wait: model the actual probe prelude in the externally owned HTTP contract; it must remain outside application HTTP timing.
    await delay(15);
    /** @type {unknown} */ const input = JSON.parse(body);
    const resource = first(field(input, "resourceMetrics"));
    const version = attribute(
      field(field(resource, "resource"), "attributes"),
      "service.version",
    );
    const metric = first(
      field(first(field(resource, "scopeMetrics")), "metrics"),
    );
    const point = first(field(field(metric, "gauge"), "dataPoints"));
    // Replay the unchanged native privacy catalog: unknown routes are normalized.
    const route = attribute(field(point, "attributes"), "http.route");
    const identity = version + ":" + (route === "/pilot" ? route : "_OTHER");
    stored.set(identity, (stored.get(identity) ?? 0) + 1);
    value = {};
  } else if (host === "gateway") {
    if (request.url?.includes("query=1&")) queryCycle++;
    const query =
      new URL(request.url ?? "/", "http://fixture.invalid").searchParams.get(
        "query",
      ) ?? "";
    if (request.url?.startsWith("/logs/")) value = "";
    else if (request.url?.startsWith("/traces/")) value = { data: [] };
    else {
      let number = 1;
      if (query.startsWith("sum(count_over_time(pilot_requests")) {
        const version = /"service.version"="([a-f0-9]{40})"/u.exec(query)?.[1];
        const route = /"http.route"="([^"]+)"/u.exec(query)?.[1];
        number = stored.get(String(version) + ":" + String(route)) ?? 0;
      } else if (query.includes("inside_production_source_available"))
        number = 2;
      else if (query.startsWith("max(timestamp"))
        number = Date.now() / 1000 - 1;
      else monitoringQueries++;
      value = query.includes("inside_production_source_available")
        ? sourceVector()
        : {
            status: "success",
            data: {
              resultType: "vector",
              result: [
                { metric: {}, value: [Date.now() / 1000, String(number)] },
              ],
            },
          };
    }
  } else if (host === "umami-query") {
    // The pinned native HTTP endpoint returns stats directly. MCP adds `current`.
    value = { pageviews: 1, visitors: 1, visits: 1, bounces: 1, totaltime: 0 };
  } else if (host === "umami-ingest") {
    value = { cache: "synthetic", sessionId: account, visitId: account };
  } else if (host === "mcp") {
    /** @type {unknown} */ const input = JSON.parse(body);
    assert.ok(
      input &&
        typeof input === "object" &&
        "id" in input &&
        Number.isSafeInteger(input.id),
    );
    // Native production initialize uses precisely this one-message SSE framing.
    response.setHeader("content-type", "text/event-stream");
    value = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: input.id, result: { protocolVersion: "2025-03-26", serverInfo: { name: "inside-platform-material-authoring", version: "1.0.0" } } })}\n\n`;
  } else if (host === "site.resource.test") {
    value =
      request.url === "/"
        ? '<html><body class="home-page">Главная</body></html>'
        : `<html><h1>Synthetic ${request.url?.split("-").at(-1)}</h1></html>`;
  } else if (host === "api.resource.test") {
    if (request.url === "/accounts/current" && diagnosticOrdinal !== null)
      actorIndices.push(
        Number(String(request.headers.authorization).split("-").at(-1)),
      );
    value =
      request.url === "/accounts/current"
        ? { account: { accountId: account } }
        : {
            items: Array.from({ length: 200 }, (_, index) => ({
              slug: `resource-material-${index}`,
              publishedAt: "2026-01-01T00:00:00Z",
            })),
            nextCursor: "next",
            productSlugs: [],
            topicSlugs: [],
          };
  } else if (host === "telegram") {
    if (diagnosticOrdinal !== null)
      updateIds.push(Number(field(JSON.parse(body), "update_id")));
    status = 202;
    value = { accepted: true };
  } else {
    assert.equal(host, "logto");
    value = {
      issuer: "http://logto:3001/oidc",
      jwks_uri: "http://logto:3001/oidc/jwks",
      authorization_endpoint: "http://logto:3001/oidc/auth",
      token_endpoint: "http://logto:3001/oidc/token",
    };
  }
  if (queryFailures) {
    if (host === "gateway") {
      if (request.url?.includes("query=1&")) {
        if (queryCycle === 1) status = 503;
        if (queryCycle === 2) value = {};
        if (queryCycle === 10) status = 799;
        if (queryCycle === 11) {
          response.destroy();
          return;
        }
      } else if (request.url?.startsWith("/logs/") && queryCycle === 3)
        status = 503;
      else if (request.url?.startsWith("/traces/")) {
        if (queryCycle === 4) status = 503;
        if (queryCycle === 5) value = { data: null };
      } else if (request.url?.includes("inside_production_source_available")) {
        if (queryCycle === 8) status = 503;
        if (queryCycle === 9) value = {};
        if (queryCycle === 12) value = "private-sentinel".repeat(400);
        if (queryCycle >= 13 && queryCycle <= 17) value = sourceVector(1);
      }
    } else if (host === "umami-query") {
      if (queryCycle === 6) status = 503;
      if (queryCycle === 7) value = { pageviews: 0 };
    }
  }
  if (
    diagnosticOrdinal !== null &&
    [
      "site.resource.test",
      "api.resource.test",
      "mcp",
      "telegram",
      "logto",
      "umami-ingest",
    ].includes(host) &&
    heldCount < 8
  ) {
    heldCount++;
    if (heldCount === 8) releaseHeld();
    await held;
  }
  response
    .writeHead(status)
    .end(typeof value === "string" ? value : JSON.stringify(value));
});
/** @type {import('node:child_process').ChildProcess | undefined} */ let child;
/** @type {Promise<unknown[]> | undefined} */ let closed;
try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const loader = join(directory, "load-preload.mjs");
  const timerReceipt = join(directory, "load-timers.json");
  await rm(timerReceipt, { force: true });
  // Test-only early completion proves the requested delay independently of elapsed cadence.
  // In this fixed 400-operation spike, scheduling delays cover successive 25 ms slots;
  // the phase remainder is after the final 9975 ms slot. Only observer rounds request 500 ms.
  await writeFile(
    loader,
    `import fs from 'node:fs';import http from 'node:http';import https from 'node:https';import timers from 'node:timers/promises';import {syncBuiltinESMExports} from 'node:module';
const read=fs.readFileSync;fs.readFileSync=(p,...a)=>p==='/resource/full-profile.json'?read(${JSON.stringify(profile)},...a):p==='/private/token.json'?JSON.stringify({tokens:Array.from({length:256},(_,index)=>'synthetic-'+index)}):p==='/private/accounts.json'?JSON.stringify(Array(256).fill(${JSON.stringify(account)})):p==='/private/caddy-root.pem'?'unused':p==='/query/key'?'synthetic':p==='/private/umami.json'?JSON.stringify({site:'synthetic',key:'synthetic'}):read(p,...a);
const timer=timers.setTimeout;let requested=0,selected=false,completed=0,overflow=0;timers.setTimeout=(ms,...a)=>{if(ms===500){if(requested<128)requested++;else overflow=1;if(${enabled && !queryFailures}&&!selected){selected=true;return timer(0,...a).then(value=>{completed=1;return value;});}}return timer(ms,...a);};process.on('exit',()=>fs.writeFileSync(${JSON.stringify(timerReceipt)},JSON.stringify([requested,completed,overflow])));
const request=http.request;const mapped=(o,cb)=>{if(!['site.resource.test','api.resource.test','mcp','telegram','logto','alloy','gateway','umami-query','umami-ingest'].includes(o.hostname))throw new Error('fixture target');return request({...o,hostname:'127.0.0.1',port:${address.port},headers:{...o.headers,'x-fixture-host':o.hostname}},cb);};http.request=mapped;https.request=mapped;syncBuiltinESMExports();`,
  );
  // deterministic-test-allow process-cleanup: inherited group, externally owned by the root tooling runOwnedProcess; no detached CLI group can escape worker termination.
  child = spawn(
    process.execPath,
    [
      "--import",
      loader,
      client,
      ...(diagnosticOrdinal === null
        ? [
            "load",
            JSON.stringify(
              queryFailures
                ? { name: "idle", seconds: 10, requests_per_second: 0 }
                : { name: "spike", seconds: 10, requests_per_second: 40 },
            ),
            enabled ? "on" : "off",
            "0",
          ]
        : [
            "stability-load",
            enabled ? "on" : "off",
            String(diagnosticOrdinal),
          ]),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  closed = once(child, "close");
  let stdout = "",
    stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
    if (Buffer.byteLength(stdout) > 65536) child?.kill("SIGKILL");
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
    if (Buffer.byteLength(stderr) > 65536) child?.kill("SIGKILL");
  });
  const started = performance.now();
  const [code] = await closed;
  assert.equal(code, 0, stderr);
  assert.ok(
    performance.now() - started >= 10000,
    "full phase duration required",
  );
  /** @type {unknown} */ const result = JSON.parse(stdout);
  assert.ok(
    result &&
      typeof result === "object" &&
      "scheduled" in result &&
      "missed" in result &&
      "success" in result &&
      "unexpected_failures" in result &&
      "completed" in result,
  );
  const timing = field(result, "timing_diagnostics");
  assert.equal(field(timing, "state"), "complete");
  assert.equal(
    field(timing, "phase"),
    diagnosticOrdinal ?? (queryFailures ? 3 : enabled ? 5 : 2),
  );
  assert.equal(
    field(timing, "pair"),
    diagnosticOrdinal === null ? 0 : Math.floor(diagnosticOrdinal / 6),
  );
  const phaseStart = field(timing, "phase_start");
  const phaseEnd = field(timing, "phase_end");
  assert.ok(Array.isArray(phaseStart) && Array.isArray(phaseEnd));
  for (const anchor of [phaseStart, phaseEnd]) {
    assert.equal(anchor.length, 3);
    assert.ok(
      anchor.every(
        (value) => typeof value === "number" && Number.isFinite(value),
      ),
    );
    assert.ok(anchor[0] <= anchor[2]);
    assert.ok(Number.isSafeInteger(anchor[1]) && anchor[1] >= 0);
  }
  assert.ok(phaseEnd[0] - phaseStart[0] >= 10000);
  const requests = field(timing, "requests");
  const rounds = field(timing, "observer_rounds");
  assert.ok(Array.isArray(requests) && Array.isArray(rounds));
  assert.ok((await stat(timerReceipt)).size <= 256);
  /** @type {unknown} */ const timerCounts = JSON.parse(
    await readFile(timerReceipt, "utf8"),
  );
  assert.ok(
    Array.isArray(timerCounts) &&
      timerCounts.length === 3 &&
      timerCounts.every(
        (value) =>
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 0,
      ),
  );
  assert.ok(timerCounts[0] <= 128);
  assert.equal(timerCounts[1], enabled && !queryFailures ? 1 : 0);
  assert.equal(timerCounts[2], 0, "bounded timer receipt overflow");
  if (!queryFailures) assert.equal(timerCounts[0], rounds.length);
  const latencies = field(result, "latency");
  assert.ok(Array.isArray(latencies));
  assert.equal(requests.length, latencies.length);
  const labels = [
    "web_home",
    "web_material",
    "api_catalog",
    "api_account",
    "",
    "",
    "telegram_webhook",
    "logto_discovery",
  ];
  for (const [index, row] of requests.entries()) {
    assert.ok(timingRow(row));
    assert.equal(row[0] % 8, row[1]);
    assert.equal(field(latencies[index], "label"), labels[row[1]]);
    assert.ok(
      Math.abs(
        row[3] - row[2] - Number(field(latencies[index], "elapsed_ms")),
      ) < 1e-8,
    );
    assert.ok(row[2] >= 0 && row[3] >= row[2]);
  }
  for (const [index, row] of rounds.entries()) {
    assert.ok(timingRow(row));
    assert.equal(row[0], index);
    assert.ok(row[1] >= 0 && row[2] >= row[1]);
    if (index > 0) {
      /** @type {unknown} */ const previous = rounds[index - 1];
      assert.ok(timingRow(previous));
      assert.ok(row[1] >= previous[2]);
    }
    assert.ok(Number.isInteger(row[3]) && row[3] >= 0 && row[3] <= 9);
  }
  assert.equal(field(timing, "request_overflow"), 0);
  assert.equal(field(timing, "observer_overflow"), 0);
  assert.equal(field(timing, "invalid_rows"), 0);
  assert.equal(JSON.stringify(timing).includes("synthetic"), false);
  if (enabled) assert.ok(rounds.length > 0);
  else assert.deepEqual(rounds, []);
  if (slotControl !== undefined) {
    await writeFile(
      join(directory, "slot-refusal-result.json"),
      JSON.stringify(result),
    );
    assert.equal(result.scheduled, 400);
    assert.ok(typeof result.missed === "number" && result.missed > 0);
    assert.equal(result.completed, false);
    assert.equal(result.unexpected_failures, 0);
    assert.equal(field(field(result, "slot_refusal"), "state"), "captured");
    console.log(JSON.stringify({ ok: true, incomplete: true }));
  } else if (queryFailures) {
    assert.equal(result.completed, false);
    assert.deepEqual(
      rounds.slice(0, 17).map((row) => {
        assert.ok(timingRow(row));
        return row[3];
      }),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 1, 8, 9, 9, 9, 9, 9],
    );
    assert.deepEqual(field(result, "query_failure_counts"), {
      metrics_http: 3,
      metrics_response: 1,
      logs_http: 1,
      traces_http: 1,
      traces_response: 1,
      umami_http: 1,
      umami_response: 1,
      source_cache_http: 2,
      source_cache_response: 6,
    });
    assert.deepEqual(field(result, "query_failure_status_counts"), {
      metrics_http: { 0: 1, 503: 1, unknown: 1 },
      metrics_response: { 200: 1 },
      logs_http: { 503: 1 },
      traces_http: { 503: 1 },
      traces_response: { 200: 1 },
      umami_http: { 503: 1 },
      umami_response: { 200: 1 },
      source_cache_http: { 0: 1, 503: 1 },
      source_cache_response: { 200: 6 },
    });
    assert.deepEqual(field(result, "source_cache_failure_counts"), {
      http: 2,
      schema: 1,
      ready_count: 5,
    });
    const evidence = field(result, "source_cache_failures");
    assert.ok(Array.isArray(evidence));
    assert.equal(evidence.length, 4);
    assert.deepEqual(
      evidence.map((value) => field(value, "reason")),
      ["http", "schema", "http", "ready_count"],
    );
    assert.equal(field(result, "source_cache_failure_overflow"), 4);
    assert.equal(JSON.stringify(result).includes("private-sentinel"), false);
    const timings = field(result, "query_seconds");
    assert.ok(Array.isArray(timings) && timings.length > 0);
    assert.equal(result.scheduled, 0);
    assert.equal(result.success, 0);
    console.log(
      JSON.stringify({ ok: true, closed_query_failures: 17, scheduled: 0 }),
    );
  } else {
    assert.deepEqual(
      {
        scheduled: result.scheduled,
        missed: result.missed,
        success: result.success,
        unexpected: result.unexpected_failures,
        completed: result.completed,
      },
      {
        scheduled: 400,
        missed: 0,
        success: 400,
        unexpected: 0,
        completed: true,
      },
    );
    const applicationCounts = Object.fromEntries(
      Object.entries(counts).filter(([name]) =>
        [
          "site.resource.test",
          "api.resource.test",
          "mcp",
          "telegram",
          "logto",
        ].includes(name),
      ),
    );
    assert.deepEqual(applicationCounts, {
      "site.resource.test": 100,
      "api.resource.test": 100,
      mcp: 50,
      telegram: 50,
      logto: 50,
    });
    if (enabled) {
      assert.ok(
        "stored_probe_points" in result &&
          "unexplained_probe_loss" in result &&
          "query_seconds" in result,
      );
      assert.equal(result.stored_probe_points, 400);
      assert.equal(result.unexplained_probe_loss, 0);
      assert.ok(
        Array.isArray(result.query_seconds) && result.query_seconds.length > 0,
      );
      assert.ok(monitoringQueries > 0);
    }
    if (diagnosticOrdinal !== null) {
      assert.deepEqual(
        actorIndices,
        Array.from({ length: 50 }, (_, index) => index),
      );
      assert.deepEqual(
        [...updateIds].sort((a, b) => a - b),
        Array.from(
          { length: 50 },
          (_, index) => 2000000 + diagnosticOrdinal * 1000 + index * 8 + 6,
        ),
      );
      assert.equal(field(result, "diagnostic_only"), true);
      assert.equal(field(result, "actor_cohort"), 0);
      const max = field(result, "maximum_inflight");
      assert.ok(typeof max === "number" && max === 8);
    }
    console.log(
      JSON.stringify({
        ok: true,
        scheduled: 400,
        mcp_sse: 50,
        ...(diagnosticOrdinal === null ? {} : { diagnosticOrdinal }),
      }),
    );
  }
} finally {
  releaseHeld();
  if (child && child.exitCode === null && child.signalCode === null)
    child.kill("SIGKILL");
  await closed?.catch(() => {});
  server.closeAllConnections();
  if (server.listening)
    await new Promise((resolve) => server.close(() => resolve(undefined)));
}

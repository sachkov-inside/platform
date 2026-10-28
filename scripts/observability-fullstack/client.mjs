// @ts-check
/** Fixed synthetic full-stack client. No external hosts, raw response bodies or credentials in stdout. */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { phaseTiming, slotOccupancy } from "./phase-timing.mjs";
import { runStabilityPhase } from "./stability-protocol.mjs";
import {
  sourceCacheObservation,
  sourceCacheQuery,
  sourceCacheSampleQuery,
  sourceCacheSampleObservation,
  probeVersion,
  nativeStats,
  accountId,
  operationOk,
  mcpInitializeResponse,
  readinessObservation,
  telegramSeedRange,
  webHttpObservation,
  webHttpExpected,
} from "./responses.mjs";
/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** @param {string} text @returns {unknown} */
function parse(text) {
  return JSON.parse(text);
}
const rawProfile = parse(readFileSync("/resource/full-profile.json", "utf8"));
if (
  !record(rawProfile) ||
  rawProfile["accounts"] !== 256 ||
  rawProfile["materials"] !== 512 ||
  rawProfile["concurrency"] !== 8
)
  throw new Error("fixed profile required");
const profile = { accounts: 256, materials: 512, concurrency: 8 };
const privateTokens = () => {
  const raw = parse(readFileSync("/private/token.json", "utf8"));
  if (
    !record(raw) ||
    !Array.isArray(raw["tokens"]) ||
    raw["tokens"].length !== profile.accounts ||
    !raw["tokens"].every((value) => typeof value === "string")
  )
    throw new Error("256 private tokens required");
  return raw["tokens"];
};
const privateAccounts = () => {
  const raw = parse(readFileSync("/private/accounts.json", "utf8"));
  if (
    !Array.isArray(raw) ||
    raw.length !== profile.accounts ||
    !raw.every((value) => typeof value === "string")
  )
    throw new Error("256 private Account identities required");
  return raw;
};
const analytics = () => {
  const raw = parse(readFileSync("/private/umami.json", "utf8"));
  if (
    !record(raw) ||
    typeof raw["site"] !== "string" ||
    typeof raw["key"] !== "string"
  )
    throw new Error("private native analytics identity required");
  return { site: raw["site"], key: raw["key"] };
};
/** @param {unknown} raw */
function vector(raw) {
  if (
    !record(raw) ||
    raw["status"] !== "success" ||
    !record(raw["data"]) ||
    raw["data"]["resultType"] !== "vector" ||
    !Array.isArray(raw["data"]["result"])
  )
    return null;
  const rows = raw["data"]["result"];
  if (
    rows.length !== 1 ||
    !record(rows[0]) ||
    !Array.isArray(rows[0]["value"]) ||
    typeof rows[0]["value"][1] !== "string"
  )
    return null;
  const number = Number(rows[0]["value"][1]);
  return Number.isFinite(number) ? number : null;
}
/** @param {unknown} raw */
function queryOne(raw) {
  if (vector(raw) === 1) return true;
  if (
    !record(raw) ||
    raw["status"] !== "success" ||
    !record(raw["data"]) ||
    raw["data"]["resultType"] !== "scalar" ||
    !Array.isArray(raw["data"]["result"])
  )
    return false;
  const pair = raw["data"]["result"];
  return (
    pair.length === 2 &&
    typeof pair[0] === "number" &&
    Number.isFinite(pair[0]) &&
    pair[1] === "1"
  );
}
/** @param {string} host @param {number} port @param {string} path @param {string} [method] @param {unknown} [body] @param {Record<string,string>} [headers] @param {number} [maximumBytes] */
async function call(
  host,
  port,
  path,
  method = "GET",
  body = undefined,
  headers = {},
  maximumBytes = 1_048_576,
) {
  if (
    (host === "inside-web-http" &&
      (port !== 9420 ||
        path !== "/metrics" ||
        method !== "GET" ||
        body !== undefined ||
        Object.keys(headers).length !== 0)) ||
    ![
      "api",
      "web",
      "mcp",
      "umami",
      "umami-ingest",
      "umami-query",
      "gateway",
      "alloy",
      "site.resource.test",
      "api.resource.test",
      "telegram",
      "logto",
      "inside-web-http",
    ].includes(host)
  )
    throw new Error("private target only");
  const started = performance.now();
  return await new Promise(
    /** @param {(value: {status:number,value:unknown,seconds:number,started_ms:number,ended_ms:number}) => void} resolve */ (
      resolve,
    ) => {
      let done = false,
        bytes = 0;
      /** @type {Buffer[]} */
      const chunks = [];
      const payload = body === undefined ? undefined : JSON.stringify(body);
      /** @param {number} status @param {unknown} value */
      const finish = (status, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const ended = performance.now();
        resolve({
          status,
          value,
          seconds: (ended - started) / 1000,
          started_ms: started,
          ended_ms: ended,
        });
      };
      const tls = host === "site.resource.test" || host === "api.resource.test";
      const request = tls ? httpsRequest : httpRequest;
      const req = request(
        {
          ...(tls
            ? { ca: readFileSync("/private/caddy-root.pem"), servername: host }
            : {}),
          hostname: host,
          port,
          path,
          method,
          agent: false,
          headers: {
            ...headers,
            ...(payload
              ? {
                  "content-type": "application/json",
                  "content-length": String(Buffer.byteLength(payload)),
                }
              : {}),
          },
        },
        (response) => {
          response.on("data", (/** @type {unknown} */ chunk) => {
            if (!Buffer.isBuffer(chunk)) {
              finish(0, null);
              req.destroy();
              return;
            }
            bytes += chunk.length;
            if (bytes > maximumBytes) {
              finish(0, null);
              req.destroy();
            } else chunks.push(chunk);
          });
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let value;
            try {
              value =
                host === "mcp" &&
                port === 3002 &&
                path === "/mcp" &&
                method === "POST"
                  ? mcpInitializeResponse(
                      text,
                      response.headers["content-type"],
                    )
                  : parse(text);
            } catch {
              value = text;
            }
            finish(response.statusCode ?? 0, value);
          });
          response.on("error", () => finish(0, null));
        },
      );
      const timer = setTimeout(() => {
        finish(0, null);
        req.destroy();
      }, 2000);
      req.on("error", () => finish(0, null));
      req.end(payload);
    },
  );
}
const key = () => readFileSync("/query/key", "utf8").trim();
async function sourceCacheReady() {
  const expression =
    'count(count by(source) ((inside_production_source_available{job="platform-owner-cache",instance="production-host",source=~"postgresql|caddy"} == 1) and on(source,job,instance) ((time() - inside_production_source_observed_at_seconds{job="platform-owner-cache",instance="production-host"}) >= 0 and (time() - inside_production_source_observed_at_seconds{job="platform-owner-cache",instance="production-host"}) <= 10)))';
  const result = await call(
    "gateway",
    8080,
    "/metrics/api/v1/query?query=" +
      encodeURIComponent(sourceCacheQuery(expression)) +
      "&nocache=1",
    "GET",
    undefined,
    { authorization: "Bearer " + key() },
    4096,
  );
  const observation = sourceCacheObservation(result);
  return {
    ...observation,
    failure:
      result.status !== 200 ? "source_cache_http" : "source_cache_response",
    status: result.status,
    seconds: result.seconds,
  };
}
/** Already-invalid phase only; same transport ceiling and captured native cut, never a retry.
 * A later same-cut read can see late ingestion; it is not an atomic snapshot or causal proof.
 * @param {number|null} cut
 */
async function sourceCacheSampleAt(cut) {
  const unavailable = sourceCacheSampleObservation(
    { status: 0, value: null },
    cut,
  );
  if (unavailable.evaluation_seconds === null) return unavailable;
  try {
    const response = await call(
      "gateway",
      8080,
      "/metrics/api/v1/query?query=" +
        encodeURIComponent(sourceCacheSampleQuery()) +
        "&nocache=1&time=" +
        String(unavailable.evaluation_seconds),
      "GET",
      undefined,
      { authorization: "Bearer " + key() },
      4096,
    );
    const diagnostic = sourceCacheSampleObservation(response, cut);
    if (Buffer.byteLength(JSON.stringify(diagnostic)) > 1024) {
      unavailable.reason = "schema";
      unavailable.status = diagnostic.status;
      return unavailable;
    }
    return diagnostic;
  } catch {
    return unavailable;
  }
}
/** Actual before/after Web cohort; only closed numeric evidence leaves the raw source.
 * @param {string} source
 */
async function webHttpWitness(source) {
  if (!/^[a-f0-9]{40}$/u.test(source)) throw new Error("fixed source required");
  const prior = await call("inside-web-http", 9420, "/metrics");
  const positive = await call(
    "web",
    3000,
    "/_health/live?token=private-http-sentinel",
  );
  const absent = await call(
    "web",
    3000,
    "/missing-private-http-sentinel?email=private-http-sentinel",
  );
  const metrics = await call("inside-web-http", 9420, "/metrics");
  const before = webHttpObservation(prior.value, source);
  const after = webHttpObservation(metrics.value, source);
  if (
    prior.status !== 200 ||
    positive.status !== 200 ||
    absent.status !== 404 ||
    metrics.status !== 200 ||
    before === null ||
    after === null ||
    before.process_start_seconds !== after.process_start_seconds ||
    after.observed_at_seconds < before.observed_at_seconds ||
    after.positive_count < before.positive_count + 1 ||
    after.not_found_count < before.not_found_count + 1
  )
    return { ok: false };
  return after;
}
/** Initial fixed-series visibility only. No request witness cut or minimum is reused.
 * @param {string} source
 */
async function webHttpInitialReady(source) {
  if (!/^[a-f0-9]{40}$/u.test(source)) throw new Error("fixed source required");
  const common =
    'job="platform-web-http",instance="web",source_sha="' + source + '"';
  const info = "inside_web_http_source_info{" + common + "}";
  const epoch = "inside_web_http_process_start_time_seconds{" + common + "}";
  const observed = "inside_web_http_observed_at_seconds{" + common + "}";
  const positive =
    "inside_web_http_requests_total{" +
    common +
    ',route="/_health/live",method="GET",code="200",outcome="completed"}';
  const absent =
    "inside_web_http_requests_total{" +
    common +
    ',route="_unmatched",method="GET",code="404",outcome="completed"}';
  /** @param {string} selector */
  const bounded = (selector) =>
    "(count(" +
    selector +
    ") == 1) and on() (sum(" +
    selector +
    ") >= 1) and on() (sum(" +
    selector +
    ") <= 9007199254740991)";
  const expression =
    "((count(" +
    info +
    ") == 1) and on() (sum(" +
    info +
    ") == 1) and on() " +
    [epoch, observed, positive, absent].map(bounded).join(" and on() ") +
    ' and on() (count(up{job="platform-web-http",instance="web"}) == 1) and on() (up{job="platform-web-http",instance="web"} == 1)' +
    " and on() (sum(" +
    epoch +
    ") <= sum(" +
    observed +
    "))" +
    " and on() ((time() - sum(" +
    observed +
    ")) >= 0) and on() ((time() - sum(" +
    observed +
    ")) <= 10))";
  const result = await call(
    "gateway",
    8080,
    "/metrics/api/v1/query?query=" +
      encodeURIComponent(expression) +
      "&nocache=1",
    "GET",
    undefined,
    { authorization: "Bearer " + key() },
  );
  return { ok: result.status === 200 && vector(result.value) === 1 };
}
/** @param {string} source @param {string} encoded */
async function webHttpStored(source, encoded) {
  if (!/^[a-f0-9]{40}$/u.test(source) || encoded.length > 512)
    throw new Error("fixed source required");
  /** @type {unknown} */
  let expected;
  try {
    expected = parse(encoded);
  } catch {
    throw new Error("closed Web witness required");
  }
  if (!webHttpExpected(expected))
    throw new Error("closed Web witness required");
  const common =
    'job="platform-web-http",instance="web",source_sha="' + source + '"';
  const positive =
    "inside_web_http_requests_total{" +
    common +
    ',route="/_health/live",method="GET",code="200",outcome="completed"}';
  const absent =
    "inside_web_http_requests_total{" +
    common +
    ',route="_unmatched",method="GET",code="404",outcome="completed"}';
  /** Every admitted counter sample must itself follow this witness, even if
   * a current observed_at gauge and a prior process counter arrive separately.
   * @param {string} selector @param {number} minimum
   */
  const current = (selector, minimum) =>
    "(sum(" +
    selector +
    " and (timestamp(" +
    selector +
    ") >= " +
    expected.observed_at_seconds +
    ")) >= " +
    minimum +
    ")";
  const expression =
    "(" +
    current(positive, expected.positive_count) +
    " and on() " +
    current(absent, expected.not_found_count) +
    ' and on() (up{job="platform-web-http",instance="web"} == 1) and on() (inside_web_http_observed_at_seconds{' +
    common +
    "} >= " +
    expected.observed_at_seconds +
    ") and on() ((time() - inside_web_http_observed_at_seconds{" +
    common +
    "}) >= 0 and (time() - inside_web_http_observed_at_seconds{" +
    common +
    "}) <= 10))";
  const result = await call(
    "gateway",
    8080,
    "/metrics/api/v1/query?query=" +
      encodeURIComponent(expression) +
      "&nocache=1",
    "GET",
    undefined,
    { authorization: "Bearer " + key() },
  );
  const count = vector(result.value);
  return { ok: result.status === 200 && count !== null && count >= 1 };
}
async function readMonitoring() {
  const authorization = { authorization: "Bearer " + key() };
  const paths = [
    "/metrics/api/v1/query?query=1&nocache=1",
    "/logs/select/logsql/query?query=" +
      encodeURIComponent("_time:1m") +
      "&limit=1",
    "/traces/select/jaeger/api/services",
  ];
  let maximum = 0;
  for (const [index, path] of paths.entries()) {
    const result = await call(
      "gateway",
      8080,
      path,
      "GET",
      undefined,
      authorization,
    );
    const target = ["metrics", "logs", "traces"][index];
    if (result.status !== 200)
      return { failure: target + "_http", status: result.status };
    if (
      (index === 0 && !queryOne(result.value)) ||
      (index === 2 &&
        (!record(result.value) || !Array.isArray(result.value["data"])))
    )
      return { failure: target + "_response", status: result.status };
    maximum = Math.max(maximum, result.seconds);
  }
  const state = analytics();
  const stats = await call(
    "umami-query",
    3001,
    "/api/websites/" +
      state.site +
      "/stats?startAt=" +
      String(Date.now() - 3600000) +
      "&endAt=" +
      String(Date.now()),
    "GET",
    undefined,
    { authorization: "Bearer " + state.key },
  );
  if (stats.status !== 200)
    return { failure: "umami_http", status: stats.status };
  if (!nativeStats(stats.value))
    return { failure: "umami_response", status: stats.status };
  const sources = await sourceCacheReady();
  return sources.ok
    ? { seconds: Math.max(maximum, stats.seconds, sources.seconds) }
    : {
        failure: sources.failure,
        status: sources.status,
        sourceCache: sources.diagnostic,
      };
}
async function lag() {
  const result = await call(
    "gateway",
    8080,
    "/metrics/api/v1/query?query=" +
      encodeURIComponent('max(timestamp({"service.name"="platform-api"}))') +
      "&nocache=1",
    "GET",
    undefined,
    { authorization: "Bearer " + key() },
  );
  const value = vector(result.value);
  const age = value === null ? NaN : Date.now() / 1000 - value;
  return Number.isFinite(age) && age >= 0 ? age : null;
}
/** @param {number} actor @param {number} update */
async function telegramUpdate(actor, update) {
  const id = 1000001 + actor;
  return await call(
    "telegram",
    3002,
    "/webhooks/telegram",
    "POST",
    {
      update_id: update,
      message: {
        message_id: update,
        date: Math.floor(Date.now() / 1000),
        from: { id, is_bot: false, first_name: "Synthetic" },
        chat: { id, type: "private", first_name: "Synthetic" },
        text: "/start",
        entities: [{ offset: 0, length: 6, type: "bot_command" }],
      },
    },
    {
      "x-telegram-bot-api-secret-token":
        "synthetic_webhook_secret_for_runtime_smoke",
    },
  );
}
/** @param {number} index @param {boolean} enabled @param {number} phase @param {number} [cohort] */
async function operation(index, enabled, phase, cohort = phase) {
  const actor = (cohort * 50 + Math.floor(index / 8)) % profile.accounts;
  const bearer = privateTokens()[actor];
  const kind = index % 8;
  if (kind === 0)
    return {
      ...(await call("site.resource.test", 443, "/")),
      label: "web_home",
    };
  if (kind === 1)
    return {
      ...(await call(
        "site.resource.test",
        443,
        "/materials/resource-material-" +
          String((index % profile.materials) + 1),
      )),
      label: "web_material",
    };
  if (kind === 2)
    return {
      ...(await call("api.resource.test", 443, "/library/site-index")),
      label: "api_catalog",
    };
  if (kind === 3)
    return {
      ...(await call(
        "api.resource.test",
        443,
        "/accounts/current",
        "GET",
        undefined,
        {
          authorization: "Bearer " + bearer,
        },
      )),
      label: "api_account",
    };
  if (kind === 4)
    return {
      ...(await call(
        "mcp",
        3002,
        "/mcp",
        "POST",
        {
          jsonrpc: "2.0",
          id: index + 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "synthetic-resource", version: "1" },
          },
        },
        {
          authorization: "Bearer " + bearer,
          accept: "application/json, text/event-stream",
          host: "api.resource.test",
        },
      )),
      label: "mcp_discovery",
    };
  if (kind === 6)
    return {
      ...(await telegramUpdate(actor, 2000000 + phase * 1000 + index)),
      label: "telegram_webhook",
    };
  if (kind === 7)
    return {
      ...(await call("logto", 3001, "/oidc/.well-known/openid-configuration")),
      label: "logto_discovery",
    };
  if (!enabled)
    return {
      status: 204,
      value: null,
      seconds: 0,
      started_ms: 0,
      ended_ms: 0,
      label: "analytics_disabled",
    };
  const site = analytics().site;
  return {
    ...(await call("umami-ingest", 3000, "/api/send", "POST", {
      type: "event",
      payload: {
        website: site,
        hostname: "synthetic.invalid",
        url: "/materials/" + String(index % profile.materials),
        name: "material_view",
        id: "synthetic-account-" + String(index % profile.accounts),
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
        ip: "192.0.2.1",
      },
    })),
    label: "analytics_send",
  };
}
/** @param {number} phase @param {number} index @param {number} at */
async function probe(phase, index, at) {
  return await call("alloy", 4318, "/v1/metrics", "POST", {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "platform-pilot" } },
            {
              key: "deployment.environment.name",
              value: { stringValue: "isolated-pilot" },
            },
            {
              key: "service.version",
              value: { stringValue: probeVersion(phase) },
            },
          ],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: "pilot_requests",
                gauge: {
                  dataPoints: [
                    {
                      timeUnixNano: (
                        BigInt(Math.floor(at)) * 1000000n
                      ).toString(),
                      asInt: String(index + 1),
                      attributes: [
                        {
                          key: "http.route",
                          value: {
                            stringValue: "/pilot",
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  });
}
/** @param {number} phase */
async function retained(phase) {
  const expression =
    'sum(count_over_time(pilot_requests{"service.name"="platform-pilot","service.version"="' +
    probeVersion(phase) +
    '","http.route"="/pilot"}[10m])) or vector(0)';
  const value = await call(
    "gateway",
    8080,
    "/metrics/api/v1/query?query=" +
      encodeURIComponent(expression) +
      "&nocache=1&latency_offset=1ms",
    "GET",
    undefined,
    { authorization: "Bearer " + key() },
  );
  const count = vector(value.value);
  return value.status === 200 &&
    count !== null &&
    Number.isSafeInteger(count) &&
    count >= 0
    ? count
    : null;
}
/** @param {{name:string,seconds:number,requests_per_second:number}} definition @param {boolean} enabled @param {number} pair @param {number} [diagnosticOrdinal] */
async function load(definition, enabled, pair, diagnosticOrdinal) {
  const start = performance.now(),
    end = start + definition.seconds * 1000;
  let scheduled = 0,
    missed = 0,
    unexpected = 0,
    success = 0,
    acknowledged = 0,
    telegramAccepted = 0;
  const epoch = Date.now(),
    anchorAfter = performance.now(),
    phase =
      diagnosticOrdinal ??
      pair * 6 +
        (enabled ? 3 : 0) +
        ["idle", "steady", "spike"].indexOf(definition.name);
  const cohort = diagnosticOrdinal === undefined ? phase : 0;
  let maximumInflight = 0;
  const timing = phaseTiming(phase, pair, start, epoch, anchorAfter);
  const occupancy = slotOccupancy(phase, enabled, start);
  /** @type {{label:string,elapsed_ms:number}[]} */ const latency = [];
  /** @type {number[]} */ const querySeconds = [];
  /** Closed finite corpus keys only; no response, URL or credential is retained.
   * @type {Record<string, number>} */ const queryFailureCounts = {};
  /** @type {Record<string, Record<string, number>>} */ const queryFailureStatuses =
    {};
  /** @type {Record<string,number>} */ const sourceCacheFailureCounts = {};
  /** @type {import("./responses.mjs").SourceCacheDiagnostic[]} */ const sourceCacheFailures =
    [];
  let sourceCacheFailureOverflow = 0;
  let sourceCacheSampleAttempted = false;
  /** @type {import("./responses.mjs").SourceCacheSampleDiagnostic|undefined} */
  let sourceCacheSampleDiagnostic;
  /** @type {Set<Promise<void>>} */ const active = new Set();
  let querying = true,
    queryFailure = false,
    queryOrdinal = 0;
  const queries = enabled
    ? (async () => {
        while (querying) {
          const roundStart = performance.now();
          const value = await readMonitoring();
          timing.observer(
            queryOrdinal++,
            roundStart,
            performance.now(),
            "failure" in value ? value.failure : undefined,
          );
          if ("failure" in value) {
            queryFailure = true;
            if (
              !sourceCacheSampleAttempted &&
              value.failure === "source_cache_response" &&
              "sourceCache" in value &&
              value.sourceCache?.reason === "stale"
            ) {
              sourceCacheSampleAttempted = true;
              try {
                sourceCacheSampleDiagnostic = await sourceCacheSampleAt(
                  value.sourceCache.evaluation_seconds,
                );
              } catch {
                // Optional evidence cannot replace the already sticky source failure.
              }
            }
            if ("sourceCache" in value && value.sourceCache) {
              const diagnostic = value.sourceCache;
              sourceCacheFailureCounts[diagnostic.reason] =
                (sourceCacheFailureCounts[diagnostic.reason] ?? 0) + 1;
              if (sourceCacheFailures.length < 4)
                sourceCacheFailures.push(diagnostic);
              else sourceCacheFailureOverflow++;
            }
            queryFailureCounts[value.failure] =
              (queryFailureCounts[value.failure] ?? 0) + 1;
            const statuses = (queryFailureStatuses[value.failure] ??= {});
            const status =
              typeof value.status === "number" &&
              Number.isSafeInteger(value.status) &&
              (value.status === 0 ||
                (value.status >= 100 && value.status <= 599))
                ? String(value.status)
                : "unknown";
            statuses[status] = (statuses[status] ?? 0) + 1;
          } else querySeconds.push(value.seconds);
          await delay(500);
        }
      })()
    : Promise.resolve();
  try {
    while (
      performance.now() < end &&
      scheduled < definition.seconds * definition.requests_per_second
    ) {
      if (definition.requests_per_second === 0) {
        await delay(Math.max(0, end - performance.now()));
        break;
      }
      const at = start + (scheduled * 1000) / definition.requests_per_second;
      await delay(Math.max(0, at - performance.now()));
      if (performance.now() >= end) break;
      const index = scheduled++;
      if (active.size >= profile.concurrency) {
        occupancy.refuse();
        missed++;
        continue;
      }
      const slot = occupancy.acquire(index % 8);
      const work = (async () => {
        if (enabled) {
          const response = await probe(
            phase,
            index,
            epoch + (index * 1000) / definition.requests_per_second,
          );
          if (response.status === 200) acknowledged++;
          else unexpected++;
        }
        if (enabled) occupancy.stage(slot, 1);
        return await operation(index, enabled, phase, cohort);
      })()
        .then((value) => {
          occupancy.stage(slot, 2);
          const expected =
            value.label === "api_account"
              ? (privateAccounts()[
                  (cohort * 50 + Math.floor(index / 8)) % profile.accounts
                ] ?? "")
              : value.label === "web_material"
                ? "Synthetic " + String((index % profile.materials) + 1)
                : value.label === "mcp_discovery"
                  ? String(index + 1)
                  : "";
          if (!operationOk(value, value.label, expected)) unexpected++;
          else {
            success++;
            if (value.label === "telegram_webhook") telegramAccepted++;
          }
          if (
            [
              "web_home",
              "web_material",
              "api_catalog",
              "api_account",
              "telegram_webhook",
              "logto_discovery",
            ].includes(value.label)
          ) {
            latency.push({
              label: value.label,
              elapsed_ms: value.seconds * 1000,
            });
            timing.request(index, index % 8, value.started_ms, value.ended_ms);
          }
        })
        .finally(() => {
          occupancy.release(work);
          active.delete(work);
        });
      active.add(work);
      occupancy.attach(work, slot);
      if (diagnosticOrdinal !== undefined)
        maximumInflight = Math.max(maximumInflight, active.size);
    }
    while (performance.now() < end)
      await delay(Math.max(0, end - performance.now()));
    await Promise.all(active);
  } finally {
    querying = false;
    await queries;
  }
  timing.finish(performance.now(), Date.now(), performance.now());
  let stored = enabled ? await retained(phase) : 0;
  const flushStart = performance.now();
  while (
    enabled &&
    stored !== acknowledged &&
    performance.now() - flushStart < 60000
  ) {
    await delay(250);
    stored = await retained(phase);
  }
  const age = enabled ? await lag() : null;
  return {
    ...(diagnosticOrdinal === undefined
      ? {}
      : {
          diagnostic_only: true,
          actor_cohort: 0,
          maximum_inflight: maximumInflight,
        }),
    telegram_acknowledged: telegramAccepted,
    acknowledged_probe_points: acknowledged,
    stored_probe_points: stored,
    unexplained_probe_loss:
      enabled && stored !== null
        ? Math.abs(acknowledged - stored)
        : enabled
          ? null
          : 0,
    completed:
      scheduled === definition.seconds * definition.requests_per_second &&
      missed === 0 &&
      success === scheduled &&
      unexpected === 0 &&
      !queryFailure,
    scheduled,
    missed,
    success,
    unexpected_failures: unexpected,
    latency,
    timing_diagnostics: timing.result,
    slot_refusal: occupancy.result(),
    query_seconds: querySeconds,
    query_failure_counts: queryFailureCounts,
    query_failure_status_counts: queryFailureStatuses,
    source_cache_failure_counts: sourceCacheFailureCounts,
    source_cache_failures: sourceCacheFailures,
    source_cache_failure_overflow: sourceCacheFailureOverflow,
    ...(sourceCacheSampleDiagnostic === undefined
      ? {}
      : { source_cache_sample_diagnostic: sourceCacheSampleDiagnostic }),
    ingestion_lag_seconds: age,
  };
}
/** @param {string} text */
function parseDefinition(text) {
  const raw = parse(text);
  if (
    !record(raw) ||
    typeof raw["name"] !== "string" ||
    typeof raw["seconds"] !== "number" ||
    typeof raw["requests_per_second"] !== "number" ||
    !["idle", "steady", "spike"].includes(raw["name"]) ||
    ![10, 40].includes(raw["seconds"]) ||
    ![0, 10, 40].includes(raw["requests_per_second"])
  )
    throw new Error("closed phase required");
  return {
    name: raw["name"],
    seconds: raw["seconds"],
    requests_per_second: raw["requests_per_second"],
  };
}
const [action, ...args] = process.argv.slice(2);
/** @param {number} index */
function argument(index) {
  const value = args[index];
  if (value === undefined) throw new Error("fixed action arguments required");
  return value;
}
if (action === "source-warmup") {
  const absent = await call(
    "web",
    3000,
    "/missing-private-http-sentinel?email=private-http-sentinel",
  );
  const positive = await call("site.resource.test", 443, "/_health/live");
  const error = await call("site.resource.test", 443, "/_source_probe/error");
  console.log(
    JSON.stringify({
      ok:
        absent.status === 404 &&
        positive.status === 200 &&
        error.status === 503,
    }),
  );
} else if (action === "cache-ready") {
  console.log(JSON.stringify({ ok: (await sourceCacheReady()).ok }));
} else if (action === "web-http-seed") {
  const positive = await call(
    "web",
    3000,
    "/_health/live?token=private-http-sentinel",
  );
  const absent = await call(
    "web",
    3000,
    "/missing-private-http-sentinel?email=private-http-sentinel",
  );
  console.log(
    JSON.stringify({ ok: positive.status === 200 && absent.status === 404 }),
  );
} else if (action === "web-http-initial-ready") {
  console.log(JSON.stringify(await webHttpInitialReady(argument(0))));
} else if (action === "web-http-witness") {
  console.log(JSON.stringify(await webHttpWitness(argument(0))));
} else if (action === "web-http-ready") {
  console.log(JSON.stringify(await webHttpStored(argument(0), argument(1))));
} else if (action === "ready") {
  const response = await call(argument(0), Number(argument(1)), argument(2));
  // This one-shot process owns pending resolver handles too. Exit only after the
  // complete closed observation is flushed, keeping transport failure as false.
  process.stdout.write(
    JSON.stringify(readinessObservation(response, argument(0), argument(3))) +
      "\n",
    (error) => process.exit(error ? 1 : 0),
  );
} else if (action === "telegram-establish") {
  const { start, end } = telegramSeedRange(argument(0));
  let accepted = 0;
  for (let index = start; index < end; index++) {
    const result = await telegramUpdate(index, 1000000 + index);
    if (!operationOk(result, "telegram_webhook", ""))
      throw new Error("synthetic Telegram contact creation failed");
    accepted++;
  }
  console.log(JSON.stringify({ accepted }));
} else if (action === "establish") {
  let created = 0;
  /** @type {string[]} */ const accounts = [];
  for (const bearer of privateTokens()) {
    const result = await call("api", 3001, "/accounts", "POST", undefined, {
      authorization: "Bearer " + bearer,
    });
    if (result.status !== 201)
      throw new Error("synthetic Account creation failed");
    const identity = accountId(result.value);
    if (typeof identity !== "string")
      throw new Error("synthetic Account identity missing");
    accounts.push(identity);
    created++;
  }
  console.log(JSON.stringify({ created, accounts }));
} else if (action === "stability-load") {
  console.log(JSON.stringify(await runStabilityPhase(args, load)));
} else if (action === "load") {
  console.log(
    JSON.stringify(
      await load(
        parseDefinition(argument(0)),
        argument(1) === "on",
        Number(argument(2)),
      ),
    ),
  );
} else if (action === "loss") {
  const value = await probe(12, 0, Date.now());
  if (value.status === 200)
    throw new Error("controlled collector stop not observed");
  console.log(
    JSON.stringify({ attempted: 1, acknowledged: 0, explained_loss: 1 }),
  );
} else if (action === "recover-probe") {
  const value = await probe(13, 0, Date.now());
  const deadline = performance.now() + 60000;
  let good = null,
    bad = null;
  do {
    good = await retained(13);
    bad = await retained(12);
    if (good === 1 && bad === 0) break;
    await delay(250);
  } while (performance.now() < deadline);
  if (value.status !== 200 || good !== 1 || bad !== 0)
    throw new Error("outage ledger does not reconcile");
  console.log(
    JSON.stringify({
      post_restart_acknowledged: 1,
      post_restart_stored: 1,
      outage_stored: 0,
    }),
  );
} else throw new Error("fixed full-stack action required");

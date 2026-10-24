// @ts-check
/** Fixed synthetic full-stack client. No external hosts, raw response bodies or credentials in stdout. */
import { request } from "node:http";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
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
  rawProfile["accounts"] !== 128 ||
  rawProfile["materials"] !== 512 ||
  rawProfile["concurrency"] !== 8
)
  throw new Error("fixed profile required");
const profile = { accounts: 128, materials: 512, concurrency: 8 };
const privateTokens = () => {
  const raw = parse(readFileSync("/private/token.json", "utf8"));
  if (
    !record(raw) ||
    !Array.isArray(raw["tokens"]) ||
    raw["tokens"].length !== 128 ||
    !raw["tokens"].every((value) => typeof value === "string")
  )
    throw new Error("128 private tokens required");
  return raw["tokens"];
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
/** @param {string} host @param {number} port @param {string} path @param {string} [method] @param {unknown} [body] @param {Record<string,string>} [headers] */
async function call(
  host,
  port,
  path,
  method = "GET",
  body = undefined,
  headers = {},
) {
  if (
    ![
      "api",
      "web",
      "mcp",
      "umami",
      "umami-ingest",
      "umami-query",
      "gateway",
      "alloy",
    ].includes(host)
  )
    throw new Error("private target only");
  const started = performance.now();
  return await new Promise(
    /** @param {(value: {status:number,value:unknown,seconds:number}) => void} resolve */ (
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
        resolve({
          status,
          value,
          seconds: (performance.now() - started) / 1000,
        });
      };
      const req = request(
        {
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
            if (bytes > 1_048_576) {
              finish(0, null);
              req.destroy();
            } else chunks.push(chunk);
          });
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let value;
            try {
              value = parse(text);
            } catch {
              value = null;
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
    if (
      result.status !== 200 ||
      (index === 0 && vector(result.value) !== 1) ||
      (index === 2 &&
        (!record(result.value) || !Array.isArray(result.value["data"])))
    )
      return null;
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
  if (
    stats.status !== 200 ||
    !record(stats.value) ||
    !record(stats.value["current"]) ||
    typeof stats.value["current"]["pageviews"] !== "number" ||
    stats.value["current"]["pageviews"] < 1
  )
    return null;
  return Math.max(maximum, stats.seconds);
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
/** @param {number} index @param {boolean} enabled */
async function operation(index, enabled) {
  const bearer = privateTokens()[index % profile.accounts];
  const kind = index % 6;
  if (kind === 0)
    return { ...(await call("web", 3000, "/")), label: "web_home" };
  if (kind === 1)
    return {
      ...(await call(
        "web",
        3000,
        "/materials/resource-material-" +
          String((index % profile.materials) + 1),
      )),
      label: "web_material",
    };
  if (kind === 2)
    return {
      ...(await call("api", 3001, "/library/site-index")),
      label: "api_catalog",
    };
  if (kind === 3)
    return {
      ...(await call("api", 3001, "/accounts/current", "GET", undefined, {
        authorization: "Bearer " + bearer,
      })),
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
  if (!enabled)
    return {
      status: 204,
      value: null,
      seconds: 0,
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
            { key: "service.version", value: { stringValue: "a".repeat(40) } },
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
                            stringValue: "/resource/phase/" + String(phase),
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
    'sum(count_over_time(pilot_requests{"http.route"="/resource/phase/' +
    String(phase) +
    '"}[10m])) or vector(0)';
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
/** @param {{name:string,seconds:number,requests_per_second:number}} definition @param {boolean} enabled @param {number} pair */
async function load(definition, enabled, pair) {
  const start = performance.now(),
    end = start + definition.seconds * 1000;
  let scheduled = 0,
    missed = 0,
    unexpected = 0,
    success = 0,
    acknowledged = 0;
  const epoch = Date.now(),
    phase =
      pair * 6 +
      (enabled ? 3 : 0) +
      ["idle", "steady", "spike"].indexOf(definition.name);
  /** @type {{label:string,elapsed_ms:number}[]} */ const latency = [];
  /** @type {number[]} */ const querySeconds = [];
  /** @type {Set<Promise<void>>} */ const active = new Set();
  let querying = true,
    queryFailure = false;
  const queries = enabled
    ? (async () => {
        while (querying) {
          const value = await readMonitoring();
          if (value === null) queryFailure = true;
          else querySeconds.push(value);
          await delay(500);
        }
      })()
    : Promise.resolve();
  try {
    while (performance.now() < end) {
      if (definition.requests_per_second === 0) {
        await delay(Math.max(0, end - performance.now()));
        break;
      }
      const at = start + (scheduled * 1000) / definition.requests_per_second;
      await delay(Math.max(0, at - performance.now()));
      if (performance.now() >= end) break;
      const index = scheduled++;
      if (active.size >= profile.concurrency) {
        missed++;
        continue;
      }
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
        return await operation(index, enabled);
      })()
        .then((value) => {
          if (value.status < 200 || value.status >= 300) unexpected++;
          else success++;
          if (
            ["web_home", "web_material", "api_catalog", "api_account"].includes(
              value.label,
            )
          )
            latency.push({
              label: value.label,
              elapsed_ms: value.seconds * 1000,
            });
        })
        .finally(() => active.delete(work));
      active.add(work);
    }
    await Promise.all(active);
  } finally {
    querying = false;
    await queries;
  }
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
    query_seconds: querySeconds,
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
if (action === "ready") {
  const response = await call(argument(0), Number(argument(1)), argument(2));
  console.log(JSON.stringify({ ok: response.status === 200 }));
} else if (action === "establish") {
  let created = 0;
  for (const bearer of privateTokens()) {
    const result = await call("api", 3001, "/accounts", "POST", undefined, {
      authorization: "Bearer " + bearer,
    });
    if (result.status !== 201)
      throw new Error("synthetic Account creation failed");
    created++;
  }
  console.log(JSON.stringify({ created }));
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

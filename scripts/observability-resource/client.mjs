// @ts-check
// Container load generator and private JWKS double. Built-in Node only.
import { generateKeyPairSync, sign } from "node:crypto";
import { request } from "node:http";
import { createServer } from "node:https";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

/** @typedef {{label:string,outcome:string,status:number|null,elapsed_ms:number|null}} Sample */
const REQUEST_MS = 1200;
const RESPONSE_BYTES = 65_536;
const LABELS = ["public_index", "protected_account"];
const PATHS = ["/library/site-index", "/accounts/current"];
const TOKEN_LIFETIME_SECONDS = 300;
const TOKEN_REFRESH_MS = 60_000;
const TRANSPORT = { host: "api", port: 3001, timeoutMs: REQUEST_MS };

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** @param {string} filename */
function token(filename) {
  const body = readFileSync(filename);
  if (body.length > 16_384) throw new Error("private token size");
  /** @type {unknown} */ const value = JSON.parse(body.toString("utf8"));
  if (
    !record(value) ||
    typeof value["token"] !== "string" ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value["token"])
  )
    throw new Error("private token shape");
  return value["token"];
}
/** @param {number} operation @param {unknown} body */
function validBody(operation, body) {
  if (!record(body)) return false;
  if (operation === 0)
    return (
      Array.isArray(body["items"]) &&
      body["items"].length === 0 &&
      Array.isArray(body["productSlugs"]) &&
      body["productSlugs"].length === 0 &&
      Array.isArray(body["topicSlugs"]) &&
      body["topicSlugs"].length === 0 &&
      body["nextCursor"] === null
    );
  return record(body["account"]) && typeof body["account"]["id"] === "string";
}
/** @param {number} operation @param {string} bearer @param {boolean} [establish] @param {{host:string,port:number,timeoutMs:number}} [transport] @returns {Promise<Sample>} */
export async function sample(
  operation,
  bearer,
  establish = false,
  transport = TRANSPORT,
) {
  if (
    ![0, 1].includes(operation) ||
    transport.timeoutMs <= 0 ||
    transport.timeoutMs > REQUEST_MS
  )
    throw new Error("closed request contract");
  const start = performance.now();
  return await new Promise((resolve) => {
    let settled = false;
    /** @param {string} outcome @param {number | null} status */
    function finish(outcome, status) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        label: LABELS[operation] ?? "protected_account",
        outcome,
        status,
        elapsed_ms: performance.now() - start,
      });
    }
    const req = request(
      {
        host: transport.host,
        port: transport.port,
        path: establish ? "/accounts" : PATHS[operation],
        method: establish ? "POST" : "GET",
        agent: false,
        headers:
          operation === 1 || establish
            ? { authorization: "Bearer " + bearer }
            : {},
      },
      (response) => {
        /** @type {Buffer[]} */ const chunks = [];
        let bytes = 0;
        response.on("data", (/** @type {Buffer} */ chunk) => {
          bytes += chunk.length;
          if (bytes > RESPONSE_BYTES) {
            finish("oversize", response.statusCode ?? null);
            req.destroy();
          } else chunks.push(chunk);
        });
        response.on("error", () =>
          finish("transport_error", response.statusCode ?? null),
        );
        response.on("end", () => {
          let valid = false;
          try {
            /** @type {unknown} */
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            valid = validBody(establish ? 1 : operation, parsed);
          } catch {
            /* bodies never enter diagnostics */
          }
          finish(
            response.statusCode === (establish ? 201 : 200) && valid
              ? "ok"
              : "unexpected_response",
            response.statusCode ?? null,
          );
        });
      },
    );
    // Absolute lifetime includes DNS/connect, headers and every body byte, regardless of progress.
    const timer = setTimeout(() => {
      finish("timeout", null);
      req.destroy();
    }, transport.timeoutMs);
    req.on("error", () => finish("transport_error", null));
    req.end();
  });
}

/** @param {string} filename @param {{host:string,port:number}} [endpoint] @param {{key:Buffer,cert:Buffer}} [tls] */
export async function serve(
  filename,
  endpoint = { host: "0.0.0.0", port: 8081 },
  tls = {
    key: readFileSync("/provider-tls/server.key"),
    cert: readFileSync("/provider-tls/server.pem"),
  },
) {
  const pair = generateKeyPairSync("ec", { namedCurve: "P-384" });
  const jwk = {
    ...pair.publicKey.export({ format: "jwk" }),
    kid: "resource-fixture",
    alg: "ES384",
    use: "sig",
  };
  function issue() {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: "ES384", kid: "resource-fixture" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: "https://identity.resource.test/oidc",
        aud: "https://api.resource.test",
        sub: "resource-corpus-account",
        inside_verified_email: "resource-corpus@inside.test",
        iat: now,
        exp: now + TOKEN_LIFETIME_SECONDS,
      }),
    ).toString("base64url");
    const input = header + "." + payload;
    const signature = sign("sha384", Buffer.from(input), {
      key: pair.privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    writeFileSync(
      filename + ".new",
      JSON.stringify({ token: input + "." + signature }),
      { mode: 0o600 },
    );
    renameSync(filename + ".new", filename);
  }
  issue();
  const server = createServer(
    {
      ...tls,
      minVersion: "TLSv1.2",
      handshakeTimeout: 1000,
      requestTimeout: 2000,
      headersTimeout: 1000,
      connectionsCheckingInterval: 250,
    },
    (req, res) => {
      if (req.method !== "GET" || req.url !== "/oidc/jwks") {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [jwk] }));
    },
  );
  const refresh = setInterval(issue, TOKEN_REFRESH_MS);
  server.maxConnections = 4;
  /** @returns {Promise<void>} */
  async function close() {
    clearInterval(refresh);
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(endpoint.port, endpoint.host, () => resolve(undefined));
    });
  } catch {
    await close();
    throw new Error("private fixture startup failed");
  }
  return { server, close };
}

/** @param {number} count @param {(operation:number)=>Promise<Sample>} send @param {(index:number,sample:Sample)=>void} emit @param {{now:()=>number,wait:(ms:number)=>Promise<unknown>}} [clock] */
export async function schedule(
  count,
  send,
  emit,
  clock = { now: () => performance.now(), wait: delay },
) {
  const start = clock.now();
  for (let index = 0; index < count; index++) {
    const scheduled = start + index * 100;
    const wait = scheduled - clock.now();
    if (wait > 0) await clock.wait(wait);
    const value =
      clock.now() - scheduled >= 100
        ? {
            label: LABELS[index % 2] ?? "public_index",
            outcome: "schedule_missed",
            status: null,
            elapsed_ms: null,
          }
        : await send(index % 2);
    emit(index, value);
  }
  const tail = start + count * 100 - clock.now();
  if (tail > 0) await clock.wait(tail);
  return (clock.now() - start) / 1000;
}

/** @param {number} status @param {unknown} body */
export function metricResult(status, body) {
  const unknown = { state: "unknown", latest_seconds: null };
  if (
    status !== 200 ||
    !record(body) ||
    body["status"] !== "success" ||
    !record(body["data"]) ||
    body["data"]["resultType"] !== "vector" ||
    !Array.isArray(body["data"]["result"])
  )
    return unknown;
  const rows = body["data"]["result"];
  if (rows.length === 0) return { state: "known", latest_seconds: null };
  /** @type {unknown} */
  const row = rows[0];
  if (
    rows.length !== 1 ||
    !record(row) ||
    !Array.isArray(row["value"]) ||
    row["value"].length !== 2 ||
    typeof row["value"][1] !== "string"
  )
    return unknown;
  const latest = Number(row["value"][1]);
  return Number.isFinite(latest) && latest > 0
    ? { state: "known", latest_seconds: latest }
    : unknown;
}

/** @param {string} filename @returns {Promise<{state:string,latest_seconds:number|null}>} */
async function metric(filename) {
  const key = readFileSync(filename, "utf8").trim();
  if (!/^[A-Za-z0-9_-]{43}$/u.test(key))
    throw new Error("private query key shape");
  return await new Promise((resolve) => {
    let settled = false;
    /** @param {string} state @param {number|null} latest_seconds */
    const finish = (state, latest_seconds) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ state, latest_seconds });
    };
    const query =
      'max(timestamp({__name__=~"http_server_request_count(_total)?",service_name="platform-api"}))';
    const req = request(
      {
        host: "gateway",
        port: 8080,
        path: "/metrics/api/v1/query?query=" + encodeURIComponent(query),
        agent: false,
        headers: { authorization: "Bearer " + key },
      },
      (res) => {
        let size = 0;
        /** @type {Buffer[]} */
        const chunks = [];
        res.on("data", (/** @type {Buffer} */ part) => {
          size += part.length;
          if (size > RESPONSE_BYTES) {
            finish("unknown", null);
            req.destroy();
          } else chunks.push(part);
        });
        res.on("error", () => finish("unknown", null));
        res.on("end", () => {
          try {
            /** @type {unknown} */ const body = JSON.parse(
              Buffer.concat(chunks).toString("utf8"),
            );
            const value = metricResult(res.statusCode ?? 0, body);
            finish(value.state, value.latest_seconds);
          } catch {
            finish("unknown", null);
          }
        });
      },
    );
    const timer = setTimeout(() => {
      finish("unknown", null);
      req.destroy();
    }, 8000);
    req.on("error", () => finish("unknown", null));
    req.end();
  });
}

async function main() {
  const action = process.argv[2];
  const filename = process.argv[3];
  if (typeof filename !== "string")
    throw new Error("private token file required");
  if (action === "provider") {
    const handle = await serve(filename);
    const stop = () => {
      void handle.close();
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    return;
  }
  if (action === "metric") {
    process.stdout.write(JSON.stringify(await metric(filename)));
    return;
  }
  const bearer = token(filename);
  if (
    action === "establish" ||
    action === "ready" ||
    action === "protected-ready"
  ) {
    process.stdout.write(
      JSON.stringify(
        await sample(
          action === "ready" ? 0 : 1,
          bearer,
          action === "establish",
        ),
      ),
    );
    return;
  }
  if (action !== "load") throw new Error("closed resource action");
  /** @type {unknown} */ const profile = JSON.parse(
    readFileSync(
      new URL(
        "../../infra/observability/resource/profile.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  if (
    !record(profile) ||
    profile["profile"] !== "short-sdk-pair-v1" ||
    profile["warmup_seconds"] !== 2 ||
    profile["measurement_seconds"] !== 10 ||
    profile["requests_per_second"] !== 10
  )
    throw new Error("closed profile contract");
  const cpu = process.cpuUsage();
  /** @type {Sample[]} */ const warmup = [];
  await schedule(
    20,
    (operation) => sample(operation, bearer),
    (_index, value) => warmup.push(value),
  );
  process.stdout.write(
    JSON.stringify({ kind: "warmup", samples: warmup }) + "\n",
  );
  const elapsed_seconds = await schedule(
    100,
    (operation) => sample(operation, bearer),
    (index, value) =>
      process.stdout.write(
        JSON.stringify({ kind: "sample", index, ...value }) + "\n",
      ),
  );
  const usage = process.cpuUsage(cpu);
  process.stdout.write(
    JSON.stringify({
      kind: "completed",
      elapsed_seconds,
      client_cpu_seconds: (usage.user + usage.system) / 1e6,
    }) + "\n",
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write("resource-client: failed\n");
    process.exitCode = 1;
  });
}

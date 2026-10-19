// @ts-check
// Host load generator and private JWKS double; built-in Node only, no provider requests.
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer, request } from "node:http";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const REQUEST_MS = 1200;
const RESPONSE_BYTES = 65_536;
const API_PORT = 3001;
const LABELS = ["public_index", "protected_account"];
const PATHS = ["/library/site-index", "/accounts/current"];
const TOKEN_LIFETIME_SECONDS = 300;
const TOKEN_REFRESH_MS = 60_000;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** @param {string} filename */
function token(filename) {
  if (readFileSync(filename).length > 16_384) throw new Error("private token size");
  /** @type {unknown} */ const value = JSON.parse(readFileSync(filename, "utf8"));
  if (!record(value) || typeof value["token"] !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value["token"])) throw new Error("private token shape");
  return value["token"];
}

/** @param {number} operation @param {unknown} body */
function validBody(operation, body) {
  if (!record(body)) return false;
  if (operation === 0) return Array.isArray(body["items"]) && body["items"].length === 0 && Array.isArray(body["productSlugs"]) && Array.isArray(body["topicSlugs"]) && body["nextCursor"] === null;
  return record(body["account"]) && typeof body["account"]["id"] === "string";
}
/** @param {number} operation @param {string} bearer @param {boolean} [establish] */
export async function sample(operation, bearer, establish = false) {
  const start = performance.now();
  return await new Promise((resolve) => {
    let settled = false;
    /** @param {string} outcome @param {number | null} status */
    function finish(outcome, status) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ label: LABELS[operation] ?? "protected_account", outcome, status, elapsed_ms: performance.now() - start });
    }
    const req = request({host: "api", port: API_PORT, path: establish ? "/accounts" : PATHS[operation], method: establish ? "POST" : "GET", agent: false,
      headers: operation === 1 || establish ? {authorization: `Bearer ${bearer}`} : {}}, (response) => {
      const chunks = []; let bytes = 0;
      response.on("data", (chunk) => {bytes += chunk.length; if (bytes > RESPONSE_BYTES) {finish("oversize", response.statusCode ?? null); req.destroy();} else chunks.push(chunk);});
      response.on("error", () => finish("transport_error", response.statusCode ?? null));
      response.on("end", () => {
        let valid = false;
        try { /** @type {unknown} */ const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); valid = validBody(establish ? 1 : operation, parsed); } catch { /* response bodies never enter diagnostics */ }
        finish(response.statusCode === (establish ? 201 : 200) && valid ? "ok" : "unexpected_response", response.statusCode ?? null);
      });
    });
    // Absolute request lifetime includes connection, headers and all body bytes.
    const timer = setTimeout(() => {finish("timeout", null); req.destroy();}, REQUEST_MS);
    req.on("error", () => finish("transport_error", null));
    req.end();
  });
}

/** @param {string} filename */
export function serve(filename) {
  const pair = generateKeyPairSync("ec", {namedCurve: "P-384"});
  const jwk = {...pair.publicKey.export({format: "jwk"}), kid: "resource-fixture", alg: "ES384", use: "sig"};
  function issue() {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({alg: "ES384", kid: "resource-fixture"})).toString("base64url");
    const payload = Buffer.from(JSON.stringify({iss: "https://identity.resource.test/oidc", aud: "https://api.resource.test", sub: "resource-corpus-account", inside_verified_email: "resource-corpus@inside.test", iat: now, exp: now + TOKEN_LIFETIME_SECONDS})).toString("base64url");
    const input = `${header}.${payload}`;
    const signature = sign("sha384", Buffer.from(input), {key: pair.privateKey, dsaEncoding: "ieee-p1363"}).toString("base64url");
    writeFileSync(`${filename}.new`, JSON.stringify({token: `${input}.${signature}`}), {mode: 0o600});
    renameSync(`${filename}.new`, filename);
  }
  issue();
  const refresh = setInterval(issue, TOKEN_REFRESH_MS);
  const server = createServer({requestTimeout: 2000, headersTimeout: 1000, connectionsCheckingInterval: 250}, (req, res) => {
    if (req.method !== "GET" || req.url !== "/oidc/jwks") {res.writeHead(404);res.end();return;}
    res.writeHead(200, {"content-type": "application/json"}); res.end(JSON.stringify({keys: [jwk]}));
  });
  server.maxConnections = 4;
  server.listen(8081, "0.0.0.0");
  const close = () => {clearInterval(refresh);server.close();server.closeAllConnections();};
  process.once("SIGTERM", close);process.once("SIGINT", close);
}

async function main() {
  const action = process.argv[2];
  const filename = process.argv[3];
  if (typeof filename !== "string") throw new Error("private token file required");
  if (action === "provider") {serve(filename);return;}
  const bearer = token(filename);
  if (action === "establish" || action === "ready") {
    process.stdout.write(JSON.stringify(await sample(action === "establish" ? 1 : 0, bearer, action === "establish")));
    return;
  }
  if (action !== "load") throw new Error("closed resource action");
  /** @type {unknown} */ const profile = JSON.parse(readFileSync(new URL("../../infra/observability/resource/profile.json", import.meta.url), "utf8"));
  if (!record(profile) || profile["profile"] !== "short-sdk-pair-v1" || profile["warmup_seconds"] !== 2 || profile["measurement_seconds"] !== 10 || profile["requests_per_second"] !== 10) throw new Error("closed profile contract");
  // Fixed open-loop schedule; one active request, no catch-up bursts after a slow response.
  const cpu = process.cpuUsage();
  for (let index = 0; index < 20; index++) await sample(index % 2, bearer);
  const samples = []; const start = performance.now();
  for (let index = 0; index < 100; index++) {
    const scheduled = start + index * 100;
    const wait = scheduled - performance.now();
    if (wait > 0) await delay(wait);
    if (performance.now() - scheduled >= 100) {samples.push({label: LABELS[index % 2], outcome: "schedule_missed", status: null, elapsed_ms: null});continue;}
    samples.push(await sample(index % 2, bearer));
  }
  const elapsed_seconds = (performance.now() - start) / 1000;
  const usage = process.cpuUsage(cpu);
  process.stdout.write(JSON.stringify({samples, elapsed_seconds, client_cpu_seconds: (usage.user + usage.system) / 1e6}));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => {process.stderr.write("resource-client: failed\n");process.exitCode = 1;});
}

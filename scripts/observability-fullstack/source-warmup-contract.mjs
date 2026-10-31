// @ts-check
// deterministic-test-allow unit-io: root runOwnedProcess owns this worker, its loopback listener and inherited actual CLI; the root also removes temporary files after failure, timeout and SIGKILL.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = process.argv[2];
assert.ok(directory);
const hold = process.argv[3] === "hold";
const client = fileURLToPath(new URL("./client.mjs", import.meta.url));
const home = "/";
const material = "/materials/resource-material-2";
const absent = "/missing-private-http-sentinel?email=private-http-sentinel";
const health = "/_health/live";
const error = "/_source_probe/error";
let scenario = "cold-ready";
/** @type {string[]} */ let requests = [];
/** @type {Set<string>} */ let ready = new Set();
let pages = { active: 0, maximum: 0 };
const server = createServer((request, response) => {
  assert.ok(request.method === "GET", "readiness uses GET only");
  assert.ok(
    request.headers.authorization === undefined,
    "no bearer in readiness",
  );
  assert.ok(
    request.headers["content-length"] === undefined,
    "no readiness body",
  );
  const path = request.url ?? "";
  const host = request.headers["x-fixture-host"];
  requests.push(path);
  assert.ok(requests.length <= 5, "finite readiness request count");
  if (hold) return;
  if (path === absent) {
    assert.ok(host === "web", "direct Web family witness");
    response.writeHead(scenario === "old404" ? 200 : 404);
    response.end("private-http-sentinel");
    return;
  }
  assert.ok(host === "site.resource.test", "public Web target only");
  if (path === health || path === error) {
    response.writeHead(
      path === health
        ? scenario === "old200"
          ? 503
          : 200
        : scenario === "old503"
          ? 200
          : 503,
    );
    response.end("private-http-sentinel");
    return;
  }
  assert.ok(path === home || path === material, "fixed genuine routes");
  const pageState = pages;
  const completedRoutes = ready;
  pageState.active++;
  pageState.maximum = Math.max(pageState.maximum, pageState.active);
  response.once("close", () => pageState.active--);
  response.writeHead(
    (scenario === "home503" && path === home) ||
      (scenario === "material503" && path === material)
      ? 503
      : 200,
    { "content-type": "text/html" },
  );
  response.write("<html>");
  if (
    (scenario === "home-timeout" && path === home) ||
    (scenario === "material-timeout" && path === material)
  )
    return;
  if (
    (scenario === "home-overflow" && path === home) ||
    (scenario === "material-overflow" && path === material)
  ) {
    response.end("x".repeat(1_048_577));
    return;
  }
  const body =
    path === home
      ? scenario === "home-fallback"
        ? "<body>fallback</body></html>"
        : scenario === "home-error"
          ? '<body class="home-page">Главная Не удалось загрузить материалы</body></html>'
          : '<body class="home-page">Главная</body></html>'
      : scenario === "material-title"
        ? "<h1>Wrong title</h1></html>"
        : "<h1>Synthetic 2</h1></html>";
  response.once("finish", () => completedRoutes.add(path));
  // deterministic-test-allow duration-wait: model the observed cold response body tail below the unchanged2s client deadline; readiness is observed through complete delivery, not elapsed time.
  const timer = setTimeout(
    () => response.end(body),
    scenario === "cold-ready" ? 1400 : 0,
  );
  response.once("close", () => clearTimeout(timer));
});

/** @param {string} loader @returns {Promise<boolean>} */
async function cli(loader) {
  // deterministic-test-allow process-cleanup: CLI inherits the external worker group; finally kills/reaps it, while root runOwnedProcess handles worker loss and uncatchable termination.
  const child = spawn(
    process.execPath,
    ["--import", loader, client, "source-warmup"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "",
    stderr = "",
    overflow = false;
  /** @param {unknown} chunk @param {boolean} output */
  const collect = (chunk, output) => {
    assert.ok(Buffer.isBuffer(chunk), "bounded CLI output chunk");
    if (
      Buffer.byteLength(stdout) + Buffer.byteLength(stderr) + chunk.length >
      65536
    ) {
      overflow = true;
      child.kill("SIGKILL");
      return;
    }
    if (output) stdout += chunk.toString("utf8");
    else stderr += chunk.toString("utf8");
  };
  child.stdout.on("data", (chunk) => collect(chunk, true));
  child.stderr.on("data", (chunk) => collect(chunk, false));
  /** @type {Promise<number|null>} */
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 4000);
  try {
    const code = await closed;
    assert.ok(
      !overflow && code === 0,
      "actual readiness CLI completed within its owner",
    );
    assert.ok(
      !stdout.includes("private-http-sentinel") &&
        !stderr.includes("private-http-sentinel"),
      "no private witness output",
    );
    assert.ok(stderr === "", "closed readiness CLI stderr");
    /** @type {unknown} */ const reply = JSON.parse(stdout);
    assert.ok(
      reply !== null && typeof reply === "object" && !Array.isArray(reply),
      "closed readiness object",
    );
    /** @type {unknown} */ const ok = Reflect.get(reply, "ok");
    assert.ok(
      Object.keys(reply).join(",") === "ok" && typeof ok === "boolean",
      "only readiness boolean leaves client",
    );
    return ok;
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await closed.catch(() => {});
  }
}

try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await writeFile(
    join(directory, "listener.json"),
    JSON.stringify({ pid: process.pid, port: address.port }),
  );
  const cases = hold
    ? ["hold"]
    : [
        "cold-ready",
        "home-fallback",
        "home-error",
        "material-title",
        "home503",
        "material503",
        "home-overflow",
        "material-overflow",
        "home-timeout",
        "material-timeout",
        "old404",
        "old200",
        "old503",
        "full",
      ];
  for (const name of cases) {
    scenario = name;
    requests = [];
    ready = new Set();
    pages = { active: 0, maximum: 0 };
    const full = name === "full";
    const profile = fileURLToPath(
      new URL(
        full
          ? "../../infra/observability/fullstack/profile.json"
          : "../../infra/observability/fullstack/technical-profile.json",
        import.meta.url,
      ),
    );
    const loader = join(directory, "source-preload.mjs");
    await writeFile(
      loader,
      `import fs from 'node:fs';import http from 'node:http';import https from 'node:https';import {syncBuiltinESMExports} from 'node:module';
const read=fs.readFileSync;fs.readFileSync=(path,...args)=>{if(path==='/resource/full-profile.json')return read(${JSON.stringify(profile)},...args);if(path==='/private/caddy-root.pem')return Buffer.from('synthetic-public-ca');if(typeof path==='string'&&(path.startsWith('/private/')||path.startsWith('/query/')))throw new Error('readiness_private_file_forbidden');return read(path,...args);};
const request=http.request;http.request=https.request=(options,callback)=>{if(!['web','site.resource.test'].includes(options.hostname)||options.method!=='GET'||options.agent!==false)throw new Error('readiness_target_refused');if(options.hostname==='site.resource.test'&&(options.port!==443||options.servername!=='site.resource.test'||!Buffer.isBuffer(options.ca)))throw new Error('readiness_tls_options_required');return request({...options,hostname:'127.0.0.1',port:${address.port},headers:{...options.headers,'x-fixture-host':options.hostname}},callback);};syncBuiltinESMExports();`,
    );
    const ok = await cli(loader);
    if (name === "cold-ready") {
      assert.ok(
        ok && ready.has(home) && ready.has(material),
        "readiness returned before genuine Web bodies completed",
      );
      assert.ok(pages.maximum === 2, "two genuine routes prepare in parallel");
    } else assert.ok(ok === full, "negative or full-profile readiness result");
    assert.ok(
      requests.length === (full ? 3 : 5),
      "exact finite preparation requests",
    );
    assert.ok(
      requests[0] === absent && requests[1] === health && requests[2] === error,
      "all original witnesses stay ordered",
    );
    assert.ok(
      full
        ? !requests.includes(home) && !requests.includes(material)
        : requests.filter((path) => path === home).length === 1 &&
            requests.filter((path) => path === material).length === 1,
      "genuine routes are scope-bound and unique",
    );
    assert.ok(pages.maximum <= 2, "bounded preparation concurrency");
  }
  console.log(JSON.stringify({ ok: true, cases: cases.length }));
} finally {
  server.closeAllConnections();
  if (server.listening)
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve(undefined))),
    );
}

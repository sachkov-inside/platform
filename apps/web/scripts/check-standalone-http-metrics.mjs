// @ts-check
import assert from "node:assert/strict";
import { createServer } from "node:net";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { spawnOwned, stopOwned } from "../../../scripts/owned-process.mjs";

const image = resolve(".next/standalone/apps/web");
const identity = resolve(image, "release-identity.json");
assert.equal(
  existsSync(identity),
  false,
  "standalone proof must not replace an identity",
);
/** @type {Map<string,Buffer|undefined>} */
const previous = new Map();
const reserve = createServer();
await new Promise((resolve, reject) => {
  reserve.once("error", reject);
  reserve.listen(0, "127.0.0.1", () => resolve(undefined));
});
const address = reserve.address();
assert.ok(address !== null && typeof address !== "string");
const port = address.port;
await new Promise((resolve, reject) =>
  reserve.close((error) => {
    if (error === undefined) resolve(undefined);
    else reject(error);
  }),
);
/** @type {ReturnType<typeof spawnOwned>|undefined} */
let child;
let identityOwned = false;
try {
  // Replay exactly the Docker COPY closure, restoring any previous local build bytes.
  for (const file of [
    "web-http-preload.mjs",
    "runtime/package.json",
    "runtime/http-metrics-config.ts",
    "runtime/web-http-metrics.ts",
  ]) {
    const target = resolve(image, file);
    previous.set(target, existsSync(target) ? readFileSync(target) : undefined);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(file));
  }
  writeFileSync(
    identity,
    JSON.stringify({ release: "v1566", sourceSha: "7".repeat(40) }),
    { flag: "wx" },
  );
  identityOwned = true;
  child = spawnOwned(
    process.execPath,
    [
      "--import",
      resolve("test/support/web-http-metrics-dns.mjs"),
      "--import",
      resolve(image, "web-http-preload.mjs"),
      resolve(image, "server.js"),
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
        BACKEND_BASE_URL: "http://127.0.0.1:1",
        WEB_BASE_URL: "http://127.0.0.1:" + String(port),
        LOGTO_ENDPOINT: "https://identity.example.test",
        LOGTO_AUDIENCE: "http://127.0.0.1:1",
        LOGTO_APP_ID: "synthetic",
        LOGTO_APP_SECRET: "synthetic-secret-1566",
        LOGTO_COOKIE_SECRET: "synthetic-cookie-secret-1566-32characters",
        PLATFORM_RELEASE_VERSION: "v1566",
        PLATFORM_SOURCE_SHA: "7".repeat(40),
        INSIDE_WEB_HTTP_METRICS_ENABLED: "true",
        INSIDE_WEB_HTTP_METRICS_ENVIRONMENT: "test",
        INSIDE_OTEL_SAMPLE_RATIO: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stderr?.on("data", () => {});
  const owned = child;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("standalone readiness deadline")),
      10000,
    );
    owned.stdout?.on("data", (chunk) => {
      if (output.length < 65536) output += String(chunk);
      if (output.includes("Ready in")) {
        clearTimeout(timer);
        resolve(undefined);
      }
    });
    owned.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("standalone startup refused"));
    });
    owned.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  const read = async () => {
    const response = await fetch("http://127.0.0.1:9420/metrics", {
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(response.status, 200);
    return response.text();
  };
  // Do not poll Web readiness: this must be its first accepted request, during startup.
  const health = await fetch(
    "http://127.0.0.1:" +
      String(port) +
      "/_health/live?token=private-http-sentinel",
    { signal: AbortSignal.timeout(5000) },
  );
  assert.equal(health.status, 200);
  await health.text();
  assert.ok(
    (await read()).includes(
      'route="/_health/live",method="GET",code="200",outcome="completed"} 1',
    ),
  );
  const missing = await fetch(
    "http://127.0.0.1:" +
      String(port) +
      "/missing-private-http-sentinel?email=private-http-sentinel",
    { signal: AbortSignal.timeout(5000) },
  );
  assert.equal(missing.status, 404);
  await missing.text();
  const product = await fetch(
    "http://127.0.0.1:" +
      String(port) +
      "/products/private-product-sentinel?email=private-http-sentinel",
    { redirect: "manual", signal: AbortSignal.timeout(5000) },
  );
  await product.text();
  const wire = await read();
  assert.ok(
    wire.includes(
      'route="/products/[slug]",method="GET",code="' +
        String(product.status) +
        '",outcome="completed"} 1',
    ),
  );
  assert.ok(
    wire.includes(
      'route="_unmatched",method="GET",code="404",outcome="completed"} 1',
    ),
  );
  assert.ok(!wire.includes("private-http-sentinel"));
  assert.ok(!wire.includes("private-product-sentinel"));
  assert.ok(wire.includes('source_sha="' + "7".repeat(40) + '"'));
  assert.ok(wire.includes("inside_web_http_process_start_time_seconds"));
} finally {
  if (child !== undefined) await stopOwned(child);
  if (identityOwned) rmSync(identity, { force: true });
  for (const [target, value] of previous) {
    if (value === undefined) rmSync(target, { force: true });
    else writeFileSync(target, value);
  }
}
await assert.rejects(
  fetch("http://127.0.0.1:9420/metrics", { signal: AbortSignal.timeout(1000) }),
);
process.stdout.write(
  "Standalone first HTTP request, 200/404/privacy and owned cleanup passed.\n",
);

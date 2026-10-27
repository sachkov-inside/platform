// @ts-check
import assert from "node:assert/strict";
import { createServer } from "node:net";
import {
  cpSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnOwned, stopOwned } from "../../../scripts/owned-process.mjs";
import { copyProductionWebPreload } from "./copy-production-web-preload.mjs";

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
const directory = mkdtempSync(join(tmpdir(), "inside-web-standalone-"));
const image = resolve(directory, "apps/web");
const identity = resolve(image, "release-identity.json");
/** @type {ReturnType<typeof spawnOwned>|undefined} */
let child;
try {
  // An OS temporary directory has no checkout node_modules ancestor to mask a missing image dependency.
  cpSync(resolve(".next/standalone"), directory, {
    recursive: true,
    verbatimSymlinks: true,
  });
  // Docker preserves the relative pnpm graph. Dereferencing each package would
  // change Node's package ancestry and falsely lose that package's dependencies.
  const canonicalDirectory = realpathSync(directory);
  for (const entry of readdirSync(directory, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isSymbolicLink()) {
      assert.ok(
        realpathSync(join(entry.parentPath, entry.name)).startsWith(
          canonicalDirectory + "/",
        ),
        "standalone dependency must stay inside the copied image",
      );
    }
  }
  assert.equal(
    existsSync(identity),
    false,
    "standalone proof must not replace an identity",
  );
  await copyProductionWebPreload(directory);
  writeFileSync(
    identity,
    JSON.stringify({ release: "v1566", sourceSha: "7".repeat(40) }),
    { flag: "wx" },
  );
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
  let diagnostic = "";
  child.stderr?.on("data", (chunk) => {
    if (diagnostic.length < 65536) diagnostic += String(chunk);
  });
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
      reject(new Error("standalone startup refused\n" + diagnostic));
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
  try {
    if (child !== undefined) await stopOwned(child);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
await assert.rejects(
  fetch("http://127.0.0.1:9420/metrics", { signal: AbortSignal.timeout(1000) }),
);
process.stdout.write(
  "Standalone first HTTP request, 200/404/privacy and owned cleanup passed.\n",
);

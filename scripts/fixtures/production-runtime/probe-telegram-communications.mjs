/** Local routing proof. Only the production hostname/upstream are replaced; the matcher is exact. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnOwned } from "../../owned-process.mjs";
import { bounded, stopDiagnosticChild } from "../domain-contract-transfer/lifetime.mjs";

const source = process.env.CADDY_SOURCE_FILE ?? "apps/telegram/infra/production/telegram.caddy";
const port = Number(process.env.CADDY_PROBE_PORT ?? 18515);
const directory = await mkdtemp(join(tmpdir(), "inside-telegram-routing-"));
const calls = [];
const children = new Set();
const upstream = createServer((request, response) => {
  calls.push(`${request.method} ${request.url}`);
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ proof: "routing-upstream" }));
});
try {
  await bounded("upstream listen", 10_000, () => new Promise((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", resolve);
  }));
  const address = upstream.address();
  assert(address && typeof address !== "string");
  const original = await readFile(source, "utf8");
  assert(original.includes("telegram.sachkov.dev {"));
  assert(original.includes("reverse_proxy 127.0.0.1:3303"));
  const config = join(directory, "Caddyfile");
  await writeFile(config, `{\n admin off\n}\n${original
    .replace("telegram.sachkov.dev {", `http://127.0.0.1:${port} {`)
    .replace("reverse_proxy 127.0.0.1:3303", `reverse_proxy 127.0.0.1:${address.port}`)}`);
  const child = spawnOwned(process.env.CADDY_EXECUTABLE ?? "/opt/homebrew/bin/caddy", ["run", "--config", config, "--adapter", "caddyfile"], { stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  await bounded("Caddy startup", 10_000, () => new Promise((resolve, reject) => {
    let log = "";
    const read = (chunk) => {
      log += chunk;
      if (log.includes("serving initial configuration")) resolve();
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.once("error", reject);
    child.once("exit", (code, signal) => reject(new Error(`Caddy exited ${code}/${signal}: ${log}`)));
  }));
  for (const [method, path, expected] of [
    ["POST", "/integrations/platform/v2/communications", 200],
    ["GET", "/integrations/platform/v2/communications", 404],
    ["POST", "/integrations/platform/v1/communications", 404],
    ["POST", "/integrations/platform/v2/communications/", 404],
    ["POST", "/integrations/platform/v2/communications/private", 404],
    ["POST", "/internal/private", 404],
    ["POST", "/integrations/platform/v1/identity-links", 200],
    ["POST", "/integrations/platform/v1/community-entitlements", 200],
  ]) {
    const response = await bounded("Caddy HTTP headers/body", 10_000, async (signal) => {
      const result = await fetch(`http://127.0.0.1:${port}${path}`, { method, signal });
      return { status: result.status, body: await result.text() };
    });
    console.log(JSON.stringify({ source, method, path, expected, ...response }));
    assert.equal(response.status, expected);
    if (expected === 404) assert.equal(response.body, "");
  }
  assert.deepEqual(calls, [
    "POST /integrations/platform/v2/communications",
    "POST /integrations/platform/v1/identity-links",
    "POST /integrations/platform/v1/community-entitlements",
  ]);
  console.log(JSON.stringify({ source, forwarded: calls }));
} finally {
  for (const child of children) await stopDiagnosticChild(child, children);
  upstream.closeAllConnections();
  await bounded("upstream cleanup", 15_000, () => new Promise((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve())));
  await rm(directory, { recursive: true });
  console.log(JSON.stringify({ children: children.size, upstreamClosed: !upstream.listening }));
}

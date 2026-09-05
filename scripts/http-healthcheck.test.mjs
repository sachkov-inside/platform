import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { test } from "node:test";

const sourceSha = "1".repeat(40);
const expectedEnvironment = {
  PLATFORM_RELEASE_VERSION: "v1",
  PLATFORM_SOURCE_SHA: sourceSha,
  MCP_SERVER_URL: "https://mcp.example.invalid:8443/mcp",
};
const command = resolve("packages/runtime-identity/http-healthcheck.mjs");
const loopbackFixture = resolve("scripts/fixtures/http-healthcheck-loopback.mjs");

function ready(service) {
  return {
    process: service,
    status: "ready",
    release: { release: "v1", sourceSha },
    schema: { identity: `sha256:${"2".repeat(64)}`, migrationCount: 1 },
    ...(service === "web" ? { dependencies: { api: "ready" } } : { database: "reachable" }),
  };
}

async function probe(service, url, environment = {}) {
  const child = spawn(process.execPath, ["--import", loopbackFixture, command, service], {
    env: { ...process.env, ...expectedEnvironment, ...environment, HEALTHCHECK_TEST_URL: url },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5_000,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const [code, signal] = await once(child, "close");
  assert.equal(signal, null, stderr);
  assert.equal(stdout, "");
  return { code, stderr };
}

async function serverFor(t, handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

for (const [service, path, port] of [
  ["api", "/health/ready", 3001],
  ["mcp", "/_health/ready", 3002],
  ["web", "/_health/ready", 3000],
]) {
  test(`${service}: live HTTP command succeeds with exact readiness and Host`, async (t) => {
    let requests = 0;
    const { url } = await serverFor(t, (request, response) => {
      requests += 1;
      assert.equal(request.headers["x-probe-url"], `http://127.0.0.1:${port}${path}`);
      if (service === "mcp") assert.equal(request.headers.host, "mcp.example.invalid:8443");
      response.end(JSON.stringify(ready(service)));
    });
    assert.deepEqual(await probe(service, url), { code: 0, stderr: "" });
    assert.equal(requests, 1);
  });
}

test("safe failures reject HTTP, JSON, missing fields and wrong releases", async (t) => {
  const invalidReports = [
    null, [], {},
    { ...ready("api"), process: "mcp" },
    { ...ready("api"), status: "alive" },
    { ...ready("api"), database: "unreachable" },
    { ...ready("api"), schema: undefined },
    { ...ready("api"), schema: { identity: "secret", migrationCount: 1 } },
    { ...ready("api"), schema: { identity: `sha256:${"2".repeat(64)}`, migrationCount: -1 } },
    ...[undefined, {}, { release: "v1" }, { sourceSha }, { release: "", sourceSha },
      { release: "v1", sourceSha: "secret" }].map((release) => ({ ...ready("api"), release })),
  ];
  const cases = [
    [503, "secret", "HTTP 503"],
    [302, "secret", "HTTP 302"],
    [200, "secret", "invalid JSON response"],
    ...invalidReports.map((report) => [200, JSON.stringify(report), "invalid readiness report"]),
    [200, JSON.stringify({ ...ready("api"), release: { release: "v2", sourceSha } }), "release version mismatch"],
    [200, JSON.stringify({ ...ready("api"), release: { release: "v1", sourceSha: "3".repeat(40) } }), "source SHA mismatch"],
  ];
  let current;
  let requests = 0;
  const { url } = await serverFor(t, (_request, response) => {
    requests += 1;
    response.writeHead(current[0], { location: "https://external.example.invalid/secret" });
    response.end(current[1]);
  });
  for (current of cases) {
    assert.deepEqual(await probe("api", url), { code: 1, stderr: `readiness: ${current[2]}\n` });
  }
  assert.equal(requests, cases.length, "one captured response, no redirects or retries");
  current = [200, JSON.stringify({ ...ready("web"), dependencies: {} })];
  assert.deepEqual(await probe("web", url), { code: 1, stderr: "readiness: invalid readiness report\n" });
});

test("invalid expected identity and MCP URL fail before any request", async (t) => {
  let requests = 0;
  const { url } = await serverFor(t, (_request, response) => { requests += 1; response.end(); });
  for (const name of ["PLATFORM_RELEASE_VERSION", "PLATFORM_SOURCE_SHA"]) {
    for (const value of [undefined, "", " ", "secret"]) {
      assert.deepEqual(await probe("api", url, { [name]: value }), {
        code: 1, stderr: "readiness: invalid expected release identity\n",
      });
    }
  }
  for (const value of [undefined, "", "secret", "file:///secret"]) {
    assert.deepEqual(await probe("mcp", url, { MCP_SERVER_URL: value }), {
      code: 1, stderr: "readiness: invalid MCP server URL\n",
    });
  }
  assert.equal(requests, 0);
});

test("connection refusal fails with a safe reason", async (t) => {
  const { server, url } = await serverFor(t, () => {});
  await new Promise((resolveClose) => server.close(resolveClose));
  assert.deepEqual(await probe("api", url), { code: 1, stderr: "readiness: connection failed\n" });
});

for (const sendHeaders of [false, true]) {
  test(`timeout bounds a stalled ${sendHeaders ? "body" : "response"}`, async (t) => {
    const { url } = await serverFor(t, (_request, response) => {
      if (sendHeaders) { response.writeHead(200); response.write('{"secret":'); }
    });
    const started = performance.now();
    assert.deepEqual(await probe("api", url), { code: 1, stderr: "readiness: request timed out\n" });
    assert.ok(performance.now() - started < 4_500, "command exits before Docker's 5s timeout");
  });
}

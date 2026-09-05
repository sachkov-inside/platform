import { get } from "node:http";

import { z } from "zod";

import { productionRuntimeIdentitySchema, sha256IdentitySchema } from "./index.mjs";

// Leave Docker's five-second timeout room to capture a useful failure reason.
const readinessTimeoutMilliseconds = 3_000;
const endpoints = {
  api: "http://127.0.0.1:3001/health/ready",
  mcp: "http://127.0.0.1:3002/_health/ready",
  web: "http://127.0.0.1:3000/_health/ready",
};
const processSchema = z.enum(["api", "mcp", "web"]);
const reportSchema = z.object({
  process: processSchema,
  status: z.literal("ready"),
  release: productionRuntimeIdentitySchema,
  schema: z.object({
    identity: sha256IdentitySchema,
    migrationCount: z.number().int().nonnegative(),
  }),
});
const backendReportSchema = reportSchema.extend({ database: z.literal("reachable") });
const webReportSchema = reportSchema.extend({
  dependencies: z.object({ api: z.literal("ready") }),
});

function fail(reason) {
  // Only caller-owned fixed messages reach Docker health logs, never response/env values.
  console.error(`readiness: ${reason}`);
  process.exit(1);
}

async function main() {
  const selected = processSchema.safeParse(process.argv[2]);
  if (!selected.success || process.argv.length !== 3) fail("invalid process argument");
  const service = selected.data;
  const expected = productionRuntimeIdentitySchema.safeParse({
    release: process.env.PLATFORM_RELEASE_VERSION,
    sourceSha: process.env.PLATFORM_SOURCE_SHA,
  });
  if (!expected.success) fail("invalid expected release identity");

  const headers = {};
  if (service === "mcp") {
    const serverUrl = z.url({ protocol: /^https?$/ }).safeParse(process.env.MCP_SERVER_URL);
    if (!serverUrl.success) fail("invalid MCP server URL");
    headers.host = new URL(serverUrl.data).host;
  }

  // Covers both response headers and body; the timer also bounds a stalled body stream.
  const deadline = setTimeout(() => fail("request timed out"), readinessTimeoutMilliseconds);
  const body = await new Promise((resolve) => {
    // node:http preserves MCP's explicit Host and never follows redirects.
    const request = get(endpoints[service], { headers }, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        fail(`HTTP ${response.statusCode}`);
      }
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("error", () => fail("response read failed"));
      response.on("end", () => {
        try {
          resolve(JSON.parse(text));
        } catch {
          fail("invalid JSON response");
        }
      });
    });
    request.on("error", () => fail("connection failed"));
  });
  const schema = service === "web" ? webReportSchema : backendReportSchema;
  const report = schema.safeParse(body);
  if (!report.success || report.data.process !== service) fail("invalid readiness report");
  if (report.data.release.release !== expected.data.release) fail("release version mismatch");
  if (report.data.release.sourceSha !== expected.data.sourceSha) fail("source SHA mismatch");
  clearTimeout(deadline);
  process.exit(0);
}

void main().catch(() => fail("probe failed"));

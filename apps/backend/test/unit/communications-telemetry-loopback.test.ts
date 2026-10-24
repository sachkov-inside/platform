// deterministic-test-allow unit-io: native communications and OTLP owned loopback; immediate cleanup closes sockets and SDK.
import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import { expect, test, vi, type TestContext } from "vitest";
import { z } from "zod";
import { technicalTelemetryFromEnvironment } from "../../src/infrastructure/observability/technical-telemetry-runtime.js";
import { HttpCommunicationsProvider } from "../../src/modules/communications/infrastructure/http-communications-provider.js";
import { requestSchema } from "../../src/modules/communications/communications-schema.generated.js";

async function listen(owner: TestContext, handler: RequestListener) {
  const server = createServer(handler);
  owner.onTestFinished(async () => {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("owned listener unavailable");
  return `http://127.0.0.1:${address.port}`;
}
function runtime(owner: TestContext, endpoint: string, enabled = true) {
  for (const key of Object.keys(process.env))
    if (key.startsWith("OTEL_EXPORTER_OTLP")) vi.stubEnv(key, undefined);
  owner.onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const telemetry = technicalTelemetryFromEnvironment({
    environment: {
      INSIDE_OTEL_ENABLED: String(enabled),
      INSIDE_OTEL_ENDPOINT: endpoint,
    },
    service: "platform-api",
    mode: "test",
    identity: { release: "a".repeat(40), sourceSha: "a".repeat(40) },
  });
  owner.onTestFinished(() => telemetry.shutdown());
  return telemetry;
}
const request = requestSchema.parse({
  contractVersion: "inside-communications-v1",
  operation: "templates.read",
  operationId: "11111111-1111-4111-8111-111111111111",
  expectedRevision: 0,
  actor: { accountRef: "private-owner" },
  payload: { templateId: "22222222-2222-4222-8222-222222222222" },
});
const success = {
  contractVersion: "inside-communications-v1",
  status: "ok",
  template: {
    templateId: "22222222-2222-4222-8222-222222222222",
    revision: 1,
    botIdentity: "private-bot",
    content: {
      type: "text",
      text: "private-content",
      entities: [],
      buttons: [],
    },
  },
};
function provider(endpoint: string) {
  return new HttpCommunicationsProvider({
    endpoint,
    secret: "private-secret",
    authorizationSecret: "private-author",
    botIdentity: "private-bot",
    publicOrigin: "https://private.example.test",
  });
}
const traceSchema = z.object({
  resourceSpans: z.array(
    z.object({
      scopeSpans: z.array(
        z.object({
          spans: z.array(
            z.object({
              name: z.string(),
              kind: z.number(),
              attributes: z.array(
                z.object({ key: z.string(), value: z.unknown() }),
              ),
              events: z.array(z.unknown()).optional(),
            }),
          ),
        }),
      ),
    }),
  ),
});

test("native communications preserves seven request/body outcomes with one completion and no propagated credentials", async (owner) => {
  const exported: string[] = [];
  const collector = await listen(owner, (req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 1_048_576) req.destroy();
    });
    req.on("end", () => {
      exported.push(body);
      res.setHeader("content-type", "application/json");
      res.end("{}");
    });
  });
  const seen: {
    body: string;
    method: string | undefined;
    authorization: string | undefined;
    traceparent: string | string[] | undefined;
  }[] = [];
  let redirected = 0;
  const target = await listen(owner, (req, res) => {
    redirected++;
    req.resume();
    res.end("{}");
  });
  const endpoint = await listen(owner, (req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 1_048_576) req.destroy();
    });
    req.on("end", () => {
      seen.push({
        body,
        method: req.method,
        authorization: req.headers.authorization,
        traceparent: req.headers["traceparent"],
      });
      const mode = req.url;
      if (mode === "/cancel") {
        req.socket.destroy();
        return;
      }
      if (mode === "/redirect") {
        res.writeHead(307, { location: target }).end();
        return;
      }
      if (mode === "/truncated") {
        res.writeHead(200, { "content-length": "1000" });
        res.flushHeaders();
        res.write('{"private":');
        res.destroy();
        return;
      }
      res.setHeader("content-type", "application/json");
      if (mode === "/malformed") {
        res.end("{");
        return;
      }
      if (mode === "/http") {
        res.writeHead(503).end(
          JSON.stringify({
            contractVersion: "inside-communications-v1",
            status: "authorization_unavailable",
          }),
        );
        return;
      }
      if (mode === "/domain") {
        res.end('{"private":"private-body"}');
        return;
      }
      res.end(JSON.stringify(success));
    });
  });
  const telemetry = runtime(owner, collector);
  for (const mode of [
    "success",
    "http",
    "malformed",
    "truncated",
    "cancel",
    "redirect",
    "domain",
  ]) {
    const result = await telemetry.runJob(() =>
      provider(`${endpoint}/${mode}`).execute(request),
    );
    expect(result).toEqual(
      mode === "success"
        ? { ok: true, value: success }
        : {
            ok: false,
            error: {
              code:
                mode === "domain"
                  ? "provider_invalid_response"
                  : mode === "http"
                    ? "authorization_unavailable"
                    : "provider_unavailable",
            },
          },
    );
  }
  await telemetry.flush();
  expect(seen).toHaveLength(7);
  expect(redirected).toBe(0);
  for (const wire of seen)
    expect(wire).toEqual({
      body: JSON.stringify(request),
      method: "POST",
      authorization: "Bearer private-secret",
      traceparent: undefined,
    });
  const spans = exported
    .filter((body) => body.includes('"resourceSpans"'))
    .flatMap((body) =>
      traceSchema
        .parse(JSON.parse(body))
        .resourceSpans.flatMap((resource) =>
          resource.scopeSpans.flatMap((scope) => scope.spans),
        ),
    );
  expect(spans).toHaveLength(7);
  for (const span of spans) {
    expect(span.name).toBe("telegram communications.execute");
    expect(span.kind).toBe(3);
    expect(span.events ?? []).toEqual([]);
    expect(span.attributes.map((attr) => attr.key).sort()).toEqual(
      span.attributes.some((attr) => attr.key === "http.response.status_code")
        ? [
            "dependency.name",
            "dependency.operation",
            "dependency.outcome",
            "http.request.method",
            "http.response.status_code",
          ]
        : [
            "dependency.name",
            "dependency.operation",
            "dependency.outcome",
            "http.request.method",
          ],
    );
  }
  const metricSchema = z.object({
    resourceMetrics: z.array(
      z.object({
        scopeMetrics: z.array(
          z.object({
            metrics: z.array(
              z.object({
                name: z.string(),
                sum: z
                  .object({
                    dataPoints: z.array(
                      z.object({
                        asDouble: z.number(),
                        attributes: z.array(
                          z.object({ key: z.string(), value: z.unknown() }),
                        ),
                      }),
                    ),
                  })
                  .optional(),
              }),
            ),
          }),
        ),
      }),
    ),
  });
  const counterPoints = exported.flatMap((body) => {
    const parsed = metricSchema.safeParse(JSON.parse(body));
    return parsed.success
      ? parsed.data.resourceMetrics
          .flatMap((resource) =>
            resource.scopeMetrics.flatMap((scope) => scope.metrics),
          )
          .filter((metric) => metric.name === "inside.dependency.operations")
          .flatMap((metric) => metric.sum?.dataPoints ?? [])
      : [];
  });
  expect(counterPoints.reduce((sum, point) => sum + point.asDouble, 0)).toBe(7);
  for (const point of counterPoints)
    expect(point.attributes.map((attr) => attr.key).sort()).toEqual([
      "dependency",
      "operation",
      "outcome",
    ]);
  expect(exported.join("")).not.toContain("private-");
  expect(telemetry.diagnostics()).toEqual({
    droppedSpans: 0,
    failedTraceExports: 0,
    failedMetricExports: 0,
  });
});

test("native five second communications deadline preserves unavailable and no resend with failed export", async (owner) => {
  let requests = 0;
  const endpoint = await listen(owner, (req) => {
    requests++;
    req.resume();
  });
  const collector = await listen(owner, (req, res) => {
    req.resume();
    res.writeHead(503).end("private-export-error");
  });
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  owner.onTestFinished(() => warning.mockRestore());
  const telemetry = runtime(owner, collector);
  await expect(
    telemetry.runJob(() => provider(endpoint).execute(request)),
  ).resolves.toEqual({ ok: false, error: { code: "provider_unavailable" } });
  expect(requests).toBe(1);
  await telemetry.flush();
  expect(telemetry.diagnostics().failedTraceExports).toBeGreaterThan(0);
  expect(telemetry.diagnostics().failedMetricExports).toBeGreaterThan(0);
  expect(JSON.stringify(warning.mock.calls)).not.toContain("private-");
}, 10_000);

test("native communications remains usable with telemetry disabled and exports no request", async (owner) => {
  let requests = 0;
  let exports = 0;
  const endpoint = await listen(owner, (req, res) => {
    requests++;
    req.resume();
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(success));
  });
  const collector = await listen(owner, (req, res) => {
    exports++;
    req.resume();
    res.end("{}");
  });
  const telemetry = runtime(owner, collector, false);
  await expect(
    telemetry.runJob(() => provider(endpoint).execute(request)),
  ).resolves.toEqual({ ok: true, value: success });
  await telemetry.flush();
  expect(requests).toBe(1);
  expect(exports).toBe(0);
});

// deterministic-test-allow unit-io: owned T-Bank HTTP/OTLP loopback contract; sockets and SDK close in test cleanup.
import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import type { TestContext } from "vitest";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { technicalTelemetryFromEnvironment } from "../../src/infrastructure/observability/technical-telemetry-runtime.js";
import { localTbankConfig } from "../../src/config/tbank-config.js";
import {
  Tbank,
  tbankToken,
} from "../../src/modules/billing/infrastructure/tbank/tbank.js";
import { bankRequest } from "../../src/modules/billing/infrastructure/tbank/bank-request.js";

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

function runtime(owner: TestContext, exporter: string) {
  for (const key of Object.keys(process.env))
    if (key.startsWith("OTEL_EXPORTER_OTLP")) vi.stubEnv(key, undefined);
  owner.onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const telemetry = technicalTelemetryFromEnvironment({
    environment: {
      INSIDE_OTEL_ENABLED: "true",
      INSIDE_OTEL_ENDPOINT: exporter,
    },
    service: "platform-api",
    mode: "test",
    identity: { release: "a".repeat(40), sourceSha: "a".repeat(40) },
  });
  owner.onTestFinished(() => telemetry.shutdown());
  return telemetry;
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

test("native bank transport exports safe request-plus-JSON observations without changing wire bodies or redirects", async (owner) => {
  const exported: string[] = [];
  const exporter = await listen(owner, (request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 1_048_576) request.destroy();
    });
    request.on("end", () => {
      exported.push(body);
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  const config = localTbankConfig({});
  const requests: {
    path: string | undefined;
    method: string | undefined;
    traceparent: string | string[] | undefined;
    body: Record<string, unknown>;
  }[] = [];
  let redirectCalls = 0;
  const redirected = await listen(owner, (request, response) => {
    redirectCalls++;
    request.resume();
    response.end("{}");
  });
  const provider = await listen(owner, (request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 1_048_576) request.destroy();
    });
    request.on("end", () => {
      requests.push({
        path: request.url,
        method: request.method,
        traceparent: request.headers["traceparent"],
        body: z.record(z.string(), z.unknown()).parse(JSON.parse(body)),
      });
      const mode = request.url?.split("/")[1];
      if (mode === "cancel") {
        request.socket.destroy();
        return;
      }
      if (mode === "redirect") {
        response.writeHead(307, { location: redirected }).end();
        return;
      }
      if (mode === "unavailable") {
        response.writeHead(503).end("private-unread-response");
        return;
      }
      response.setHeader("content-type", "application/json");
      if (mode === "malformed") {
        response.end("{");
        return;
      }
      if (mode === "truncated") {
        response.writeHead(200, { "content-length": "1000" });
        response.flushHeaders();
        response.write('{"private":');
        response.destroy();
        return;
      }
      if (mode === "domain-invalid") {
        response.end('{"private":"private-response"}');
        return;
      }
      response.end(
        JSON.stringify({
          TerminalKey: config.terminalKey,
          OrderId: "private-order",
          PaymentId: "private-payment",
          Amount: 100,
          Status: "NEW",
          Success: true,
          ErrorCode: "0",
        }),
      );
    });
  });
  const telemetry = runtime(owner, exporter);
  for (const mode of [
    "success",
    "unavailable",
    "malformed",
    "truncated",
    "cancel",
    "redirect",
    "domain-invalid",
  ]) {
    const bank = new Tbank(
      {
        ...config,
        endpoints: { ...config.endpoints, apiBaseUrl: `${provider}/${mode}` },
      },
      bankRequest(undefined),
    );
    await telemetry.runJob(async () => {
      if (mode === "success")
        await expect(bank.state("private-payment")).resolves.toMatchObject({
          PaymentId: "private-payment",
        });
      else await expect(bank.state("private-payment")).rejects.toThrow();
    });
  }
  await telemetry.flush();
  expect(requests).toHaveLength(7);
  expect(redirectCalls).toBe(0);
  expect(
    requests.every(
      (request) =>
        request.method === "POST" && request.traceparent === undefined,
    ),
  ).toBe(true);
  for (const request of requests)
    expect(request.body).toEqual({
      PaymentId: "private-payment",
      TerminalKey: config.terminalKey,
      Token: tbankToken(
        { PaymentId: "private-payment", TerminalKey: config.terminalKey },
        config.password,
      ),
    });
  const wire = exported.join("\n");
  expect(wire).not.toContain("private-");
  expect(wire).not.toContain(provider);
  expect(wire).not.toContain(config.terminalKey);
  const spans = exported.flatMap((body) => {
    const parsed = traceSchema.safeParse(JSON.parse(body));
    return parsed.success
      ? parsed.data.resourceSpans.flatMap((resource) =>
          resource.scopeSpans.flatMap((scope) => scope.spans),
        )
      : [];
  });
  expect(spans).toHaveLength(7);
  expect(
    spans.every(
      (span) =>
        span.name === "tbank GetState" &&
        span.kind === 3 &&
        (span.events?.length ?? 0) === 0,
    ),
  ).toBe(true);
  const allowed = new Set([
    "dependency.name",
    "dependency.operation",
    "dependency.outcome",
    "http.request.method",
  ]);
  expect(
    spans.every((span) =>
      span.attributes.every((attribute) => allowed.has(attribute.key)),
    ),
  ).toBe(true);
  expect(
    spans.map(
      (span) =>
        span.attributes.find(
          (attribute) => attribute.key === "dependency.outcome",
        )?.value,
    ),
  ).toEqual([
    { stringValue: "completed" },
    ...Array.from({ length: 5 }, () => ({ stringValue: "failed" })),
    { stringValue: "completed" },
  ]);
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
                    dataPoints: z.array(z.object({ asDouble: z.number() })),
                  })
                  .optional(),
              }),
            ),
          }),
        ),
      }),
    ),
  });
  const counters = exported.flatMap((body) => {
    const parsed = metricSchema.safeParse(JSON.parse(body));
    return parsed.success
      ? parsed.data.resourceMetrics
          .flatMap((resource) =>
            resource.scopeMetrics.flatMap((scope) => scope.metrics),
          )
          .filter((metric) => metric.name === "inside.dependency.operations")
      : [];
  });
  expect(
    counters
      .flatMap((metric) => metric.sum?.dataPoints ?? [])
      .reduce((sum, point) => sum + point.asDouble, 0),
  ).toBe(7);
  expect(telemetry.diagnostics()).toEqual({
    droppedSpans: 0,
    failedTraceExports: 0,
    failedMetricExports: 0,
  });
});

test("the native ten second bank deadline still rejects once when the exporter returns 503", async (owner) => {
  let requests = 0;
  const provider = await listen(owner, (request) => {
    requests++;
    request.resume();
  });
  const exporter = await listen(owner, (request, response) => {
    request.resume();
    response.writeHead(503).end("private-export-error");
  });
  const warnings = vi
    .spyOn(console, "warn")
    .mockImplementation(() => undefined);
  owner.onTestFinished(() => warnings.mockRestore());
  const telemetry = runtime(owner, exporter);
  const config = localTbankConfig({});
  const bank = new Tbank(
    { ...config, endpoints: { ...config.endpoints, apiBaseUrl: provider } },
    bankRequest(undefined),
  );
  await expect(
    telemetry.runJob(() => bank.state("private-payment")),
  ).rejects.toMatchObject({ name: "TimeoutError" });
  expect(requests).toBe(1);
  await telemetry.flush();
  expect(telemetry.diagnostics().failedTraceExports).toBeGreaterThan(0);
  expect(telemetry.diagnostics().failedMetricExports).toBeGreaterThan(0);
  expect(JSON.stringify(warnings.mock.calls)).not.toContain("private-");
}, 15_000);

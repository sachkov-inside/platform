// deterministic-test-allow unit-io: owned Kinescope/OTLP loopback contract, sockets and telemetry close in test cleanup.
import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import type { TestContext } from "vitest";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";
import { technicalTelemetryFromEnvironment } from "../../src/infrastructure/observability/technical-telemetry-runtime.js";
import { createKinescopeVideoProvider } from "../../src/modules/videos/adapters/kinescope/kinescope-video-provider.js";

async function listen(
  owner: TestContext,
  handler: RequestListener,
): Promise<string> {
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

const upload = {
  access: "free",
  byteSize: 42,
  filename: "private-filename-sentinel",
  projectId: "private-project-sentinel",
  title: "private-title-sentinel",
} as const;

test("real provider HTTP responses preserve mappings and export only registered SDK fields", async (owner) => {
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
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });
  const requests: {
    method: string | undefined;
    traceparent: string | string[] | undefined;
    auth: string | undefined;
  }[] = [];
  const providerUrl = await listen(owner, (request, response) => {
    requests.push({
      method: request.method,
      traceparent: request.headers["traceparent"],
      auth: request.headers.authorization,
    });
    const id = request.url?.split("/").at(-1);
    request.resume();
    if (id === "cancel") {
      request.socket.destroy();
      return;
    }
    if (id === "truncated") {
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": "100",
      });
      response.flushHeaders();
      response.write('{"data":');
      response.destroy();
      return;
    }
    response.setHeader("x-request-id", "private-request-sentinel");
    response.setHeader("content-type", "application/json");
    if (id === "404" || id === "429" || id === "503") {
      response.writeHead(Number(id));
      response.end("private-unread-body-sentinel");
      return;
    }
    if (id === "malformed") {
      response.end("{");
      return;
    }
    if (request.method === "POST") {
      response.end(
        JSON.stringify({
          data: {
            id: "private-video-sentinel",
            endpoint: "https://uploader.kinescope.io/private-upload-sentinel",
          },
        }),
      );
      return;
    }
    if (request.method === "DELETE") {
      response.end('{"data":{"success":true}}');
      return;
    }
    response.end(
      JSON.stringify({
        data: {
          id: "private-video-sentinel",
          project_id: "private-project-sentinel",
          title: "private-title-sentinel",
          status: "done",
        },
      }),
    );
  });
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
  const provider = createKinescopeVideoProvider({
    apiBaseUrl: providerUrl,
    uploaderBaseUrl: providerUrl,
    apiToken: "private-token-sentinel",
  });
  await telemetry.runJob(async () => {
    expect(await provider.delete({ id: "success" })).toEqual({
      kind: "deleted",
      providerRequestId: "private-request-sentinel",
    });
    expect(
      await provider.find({
        id: "success",
        projectId: "private-project-sentinel",
      }),
    ).toMatchObject({ id: "private-video-sentinel" });
    expect(await provider.initUpload(upload)).toEqual({
      id: "private-video-sentinel",
      uploadEndpoint: "https://uploader.kinescope.io/private-upload-sentinel",
    });
    expect(
      await provider.find({ id: "404", projectId: "private-project-sentinel" }),
    ).toBeNull();
    expect(await provider.delete({ id: "429" })).toMatchObject({
      kind: "retryable_failure",
      category: "rate_limited",
    });
    expect(await provider.delete({ id: "503" })).toMatchObject({
      kind: "retryable_failure",
      category: "provider_unavailable",
    });
    await expect(
      provider.find({ id: "malformed", projectId: "private-project-sentinel" }),
    ).rejects.toThrow();
    await expect(
      provider.find({ id: "truncated", projectId: "private-project-sentinel" }),
    ).rejects.toThrow();
    await expect(
      provider.find({ id: "cancel", projectId: "private-project-sentinel" }),
    ).rejects.toThrow();
  });
  await telemetry.flush();
  expect(requests).toHaveLength(9);
  expect(
    requests.every(
      (request) =>
        request.traceparent === undefined &&
        request.auth === "Bearer private-token-sentinel",
    ),
  ).toBe(true);
  const wire = exported.join("\n");
  expect(wire).not.toContain("private-");
  expect(wire).not.toContain(providerUrl);
  expect(wire).toContain("inside.dependency.operations");
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
  const spans = exported.flatMap((body) => {
    const parsed = traceSchema.safeParse(JSON.parse(body));
    return parsed.success
      ? parsed.data.resourceSpans.flatMap((resource) =>
          resource.scopeSpans.flatMap((scope) => scope.spans),
        )
      : [];
  });
  expect(spans).toHaveLength(9);
  expect(
    spans.every((span) => span.kind === 3 && (span.events?.length ?? 0) === 0),
  ).toBe(true);
  const allowed = new Set([
    "dependency.name",
    "dependency.operation",
    "dependency.outcome",
    "http.request.method",
    "http.response.status_code",
  ]);
  expect(
    spans.every((span) =>
      span.attributes.every((attribute) => allowed.has(attribute.key)),
    ),
  ).toBe(true);
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
  ).toBe(9);
  expect(telemetry.diagnostics()).toEqual({
    droppedSpans: 0,
    failedTraceExports: 0,
    failedMetricExports: 0,
  });
});

test("real eight second provider deadline remains independent of failed OTLP export", async (owner) => {
  let calls = 0;
  const providerUrl = await listen(owner, (request) => {
    calls++;
    request.resume();
  });
  const failedExporter = await listen(owner, (request, response) => {
    request.resume();
    response.writeHead(503);
    response.end("private-export-error-sentinel");
  });
  for (const key of Object.keys(process.env))
    if (key.startsWith("OTEL_EXPORTER_OTLP")) vi.stubEnv(key, undefined);
  owner.onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const warnings = vi
    .spyOn(console, "warn")
    .mockImplementation(() => undefined);
  owner.onTestFinished(() => warnings.mockRestore());
  const telemetry = technicalTelemetryFromEnvironment({
    environment: {
      INSIDE_OTEL_ENABLED: "true",
      INSIDE_OTEL_ENDPOINT: failedExporter,
    },
    service: "platform-video-deletions-worker",
    mode: "test",
    identity: { release: "proof", sourceSha: "a".repeat(40) },
  });
  owner.onTestFinished(() => telemetry.shutdown());
  const provider = createKinescopeVideoProvider({
    apiBaseUrl: providerUrl,
    uploaderBaseUrl: providerUrl,
    apiToken: "private-token-sentinel",
  });
  await expect(
    telemetry.runJob(() => provider.delete({ id: "deadline" })),
  ).resolves.toEqual({ kind: "retryable_failure", category: "timeout" });
  expect(calls).toBe(1);
  await telemetry.flush();
  expect(telemetry.diagnostics().failedTraceExports).toBeGreaterThan(0);
  expect(telemetry.diagnostics().failedMetricExports).toBeGreaterThan(0);
  expect(JSON.stringify(warnings.mock.calls)).not.toContain("private-");
}, 15_000);

test("repeated dependency runtimes release only their context leases", async () => {
  for (let iteration = 0; iteration < 3; iteration++) {
    const spans = new InMemorySpanExporter();
    const runtime = createTechnicalTelemetry({
      enabled: true,
      service: "platform-api",
      environment: "test",
      release: "proof",
      sampleRatio: 1,
      exporters: {
        spans,
        metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
      },
    });
    try {
      const provider = createKinescopeVideoProvider({
        apiBaseUrl: "https://api.kinescope.io",
        uploaderBaseUrl: "https://uploader.kinescope.io",
        apiToken: "private-token-sentinel",
        fetch: vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(null, { status: 404 })),
      });
      await runtime.runJob(() =>
        provider.find({
          id: "private-video-sentinel",
          projectId: "private-project-sentinel",
        }),
      );
      await runtime.flush();
      expect(spans.getFinishedSpans()).toHaveLength(1);
    } finally {
      await runtime.shutdown();
    }
  }
});

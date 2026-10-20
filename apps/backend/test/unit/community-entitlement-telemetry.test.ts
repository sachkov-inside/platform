// deterministic-test-allow unit-io: owned community HTTP transport contract; each test closes native sockets and its telemetry SDK.
import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import {
  context,
  createContextKey,
  ROOT_CONTEXT,
  SpanKind,
} from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { technicalTelemetryFromEnvironment } from "../../src/infrastructure/observability/technical-telemetry-runtime.js";
import { z } from "zod";
import { expect, test, vi, type TestContext } from "vitest";
import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";
import { HttpCommunityEntitlementProvider } from "../../src/modules/telegram-membership/infrastructure/http/http-community-entitlement-provider.js";
import type { CommunitySetCommand } from "../../src/modules/telegram-membership/domain/community-entitlement.js";

const command: CommunitySetCommand = {
  contractVersion: "inside.community-entitlement.v2",
  operation: "entitlement.set",
  operationId: "00000000-0000-4000-8000-000000000001",
  binding: {
    accountRef: "private-account",
    telegramIdentityRef: "private-identity",
    linkRef: "00000000-0000-4000-8000-000000000002",
    linkRevision: 1,
  },
  entitlementRevision: 1,
  access: { kind: "lifetime" },
  issuedAt: "2030-01-01T00:00:00.000Z",
  correlationRef: "00000000-0000-4000-8000-000000000003",
};
const result = {
  contractVersion: command.contractVersion,
  operation: "entitlement.result",
  operationId: command.operationId,
  binding: command.binding,
  entitlementRevision: command.entitlementRevision,
  access: command.access,
  status: "applied",
  observedMembership: "member",
  admissionRestriction: "none",
  updatedAt: "2030-01-01T00:00:00.000Z",
};
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
    throw new Error("owned community listener unavailable");
  return `http://127.0.0.1:${address.port}/private-community`;
}
function runtime(owner: TestContext, sampleRatio = 1) {
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "proof",
    sampleRatio,
    exporters: { spans, metrics },
  });
  owner.onTestFinished(() => telemetry.shutdown());
  return { spans, metrics, telemetry };
}

test("one native community set exchange preserves the wire and emits one safe completion", async (owner) => {
  const bodies: string[] = [];
  const endpoint = await listen(owner, (request, response) => {
    expect(request.method).toBe("POST");
    expect(request.headers.authorization).toBe("Bearer private-secret");
    expect(request.headers["content-type"]).toBe("application/json");
    for (const name of ["traceparent", "tracestate", "baggage"])
      expect(request.headers[name]).toBeUndefined();
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      bodies.push(body);
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(result));
    });
  });
  const { telemetry, spans, metrics } = runtime(owner);
  const provider = new HttpCommunityEntitlementProvider(
    endpoint,
    "private-secret",
  );
  expect(await telemetry.runJob(() => provider.set(command))).toEqual({
    kind: "result",
    result,
  });
  await telemetry.flush();
  expect(bodies).toEqual([JSON.stringify(command)]);
  expect(spans.getFinishedSpans()).toHaveLength(1);
  const span = spans.getFinishedSpans()[0];
  expect(span?.kind).toBe(SpanKind.CLIENT);
  expect(span?.name).toBe("telegram community.set");
  expect(span?.attributes).toEqual({
    "dependency.name": "telegram",
    "dependency.operation": "community.set",
    "dependency.outcome": "completed",
    "http.request.method": "POST",
    "http.response.status_code": 200,
  });
  const count = metrics
    .getMetrics()
    .flatMap((resource) =>
      resource.scopeMetrics.flatMap((scope) => scope.metrics),
    )
    .find(
      (metric) => metric.descriptor.name === "inside.dependency.operations",
    );
  expect(count?.dataPoints).toMatchObject([
    {
      attributes: {
        dependency: "telegram",
        operation: "community.set",
        outcome: "completed",
      },
      value: 1,
    },
  ]);
});

test("status is its own fixed wire operation and local refusals create no request or metric", async (owner) => {
  const bodies: unknown[] = [];
  const endpoint = await listen(owner, (request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      bodies.push(JSON.parse(body));
      response.end(JSON.stringify(result));
    });
  });
  const { telemetry, spans } = runtime(owner);
  const provider = new HttpCommunityEntitlementProvider(
    endpoint,
    "private-secret",
  );
  await telemetry.runJob(async () => {
    expect(
      await provider.set({
        ...command,
        contractVersion: "inside.community-entitlement.v1",
      }),
    ).toEqual({ kind: "error", error: "unsupported_contract" });
    expect(
      await provider.set({
        ...command,
        binding: { ...command.binding, accountRef: "x".repeat(16_384) },
      }),
    ).toEqual({ kind: "unavailable" });
    expect(await provider.status(command)).toEqual({ kind: "result", result });
  });
  await telemetry.flush();
  expect(bodies).toEqual([
    {
      contractVersion: "inside.community-entitlement.v2",
      operation: "entitlement.status",
      operationId: command.operationId,
    },
  ]);
  expect(spans.getFinishedSpans().map((span) => span.name)).toEqual([
    "telegram community.status",
  ]);
});

test("correlated denials remain protocol answers while unavailable and contradictory answers fail observation", async (owner) => {
  let calls = 0;
  let status = 409;
  let payload: unknown;
  const endpoint = await listen(owner, (request, response) => {
    calls++;
    request.resume();
    response.writeHead(status).end(JSON.stringify(payload));
  });
  const { telemetry, spans } = runtime(owner);
  const provider = new HttpCommunityEntitlementProvider(
    endpoint,
    "private-secret",
  );
  const error = {
    contractVersion: command.contractVersion,
    operation: "entitlement.error",
    operationId: command.operationId,
    error: "operation_conflict",
  };
  await telemetry.runJob(async () => {
    payload = error;
    expect(await provider.set(command)).toEqual({
      kind: "error",
      error: "operation_conflict",
    });
    status = 503;
    payload = { ...error, error: "unavailable" };
    expect(await provider.status(command)).toEqual({
      kind: "error",
      error: "unavailable",
    });
    for (const value of [
      { ...error, operationId: "00000000-0000-4000-8000-000000000099" },
      { ...error, contractVersion: "inside.community-entitlement.v1" },
      error,
      { privateBody: "private-provider-error" },
    ]) {
      payload = value;
      expect(await provider.set(command)).toEqual({ kind: "unavailable" });
    }
    status = 200;
    for (const value of [
      { ...result, binding: { ...command.binding, linkRevision: 2 } },
      { ...result, entitlementRevision: 2 },
      {
        ...result,
        binding: { ...command.binding, accountRef: "private-other" },
      },
      { ...result, access: { kind: "none" } },
      { ...result, observedMembership: "unknown" },
    ]) {
      payload = value;
      expect(await provider.status(command)).toEqual({ kind: "unavailable" });
    }
  });
  await telemetry.flush();
  expect(calls).toBe(11);
  expect(
    spans
      .getFinishedSpans()
      .map((span) => span.attributes["dependency.outcome"]),
  ).toEqual(["completed", ...Array<string>(10).fill("failed")]);
  expect(
    spans.getFinishedSpans().every((span) => span.events.length === 0),
  ).toBe(true);
});

test("native redirect, malformed JSON and connection close stay unavailable without resend", async (owner) => {
  let redirected = 0;
  const target = await listen(owner, (request, response) => {
    redirected++;
    request.resume();
    response.end(JSON.stringify(result));
  });
  let calls = 0;
  let mode = "redirect";
  const endpoint = await listen(owner, (request, response) => {
    calls++;
    request.resume();
    if (mode === "redirect")
      response.writeHead(302, { location: target }).end();
    else if (mode === "malformed")
      response.writeHead(200).end("{private-provider-error");
    else request.socket.destroy();
  });
  const { telemetry, spans } = runtime(owner);
  const provider = new HttpCommunityEntitlementProvider(
    endpoint,
    "private-secret",
  );
  await telemetry.runJob(async () => {
    for (const value of ["redirect", "malformed", "close"]) {
      mode = value;
      expect(await provider.set(command)).toEqual({ kind: "unavailable" });
    }
  });
  await telemetry.flush();
  expect(calls).toBe(3);
  expect(redirected).toBe(0);
  expect(
    spans
      .getFinishedSpans()
      .map((span) => span.attributes["dependency.outcome"]),
  ).toEqual(["failed", "failed", "failed"]);
});

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("existing JSON completion owns duration and concurrent callers retain native parents", async (owner) => {
  const held = deferred<undefined>();
  let finishBody: (() => void) | undefined;
  owner.onTestFinished(() => {
    finishBody?.();
  });
  const endpoint = await listen(owner, (request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      if (body.includes('"entitlement.set"')) {
        response.writeHead(200, { "content-type": "application/json" });
        response.flushHeaders();
        response.write("{");
        finishBody = () => {
          response.end(JSON.stringify(result).slice(1));
        };
        held.resolve(undefined);
      } else response.end(JSON.stringify(result));
    });
  });
  const { telemetry, spans } = runtime(owner);
  const provider = new HttpCommunityEntitlementProvider(
    endpoint,
    "private-secret",
  );
  const first = telemetry.startHttp({
    method: "POST",
    route: "/billing/subscriptions/purchase",
  });
  const second = telemetry.startHttp({
    method: "GET",
    route: "/billing/payments/:purchaseRef",
  });
  const firstParent = first.run(() => telemetry.correlation()["spanId"]);
  const secondParent = second.run(() => telemetry.correlation()["spanId"]);
  const pending = first.run(async () => {
    const answer = await provider.set(command);
    expect(telemetry.correlation()["spanId"]).toBe(firstParent);
    return answer;
  });
  owner.onTestFinished(async () => {
    finishBody?.();
    await pending;
  });
  await held.promise;
  await telemetry.flush();
  expect(spans.getFinishedSpans()).toEqual([]);
  await second.run(async () => {
    expect(await provider.status(command)).toEqual({ kind: "result", result });
    expect(telemetry.correlation()["spanId"]).toBe(secondParent);
  });
  finishBody?.();
  expect(await pending).toEqual({ kind: "result", result });
  first.finish(200, 1);
  second.finish(200, 1);
  await telemetry.flush();
  expect(
    spans
      .getFinishedSpans()
      .filter((span) => span.kind === SpanKind.CLIENT)
      .map((span) => [span.name, span.parentSpanContext?.spanId]),
  ).toEqual([
    ["telegram community.status", secondParent],
    ["telegram community.set", firstParent],
  ]);
  expect(telemetry.correlation()).toEqual({});
});

test("native truncated body and unchanged five-second deadline preserve unknown effects and one request", async (owner) => {
  let mode = "truncated";
  let calls = 0;
  const bodyStarted = deferred<undefined>();
  let breakBody: (() => void) | undefined;
  owner.onTestFinished(() => {
    breakBody?.();
  });
  const endpoint = await listen(owner, (request, response) => {
    calls++;
    request.resume();
    if (mode === "truncated") {
      response.writeHead(200, { "content-length": "2000" });
      response.flushHeaders();
      response.write("{");
      breakBody = () => {
        response.destroy();
      };
      bodyStarted.resolve(undefined);
    }
  });
  const { telemetry, spans } = runtime(owner);
  const provider = new HttpCommunityEntitlementProvider(
    endpoint,
    "private-secret",
  );
  const pending = telemetry.runJob(() => provider.set(command));
  owner.onTestFinished(async () => {
    breakBody?.();
    await pending;
  });
  await bodyStarted.promise;
  breakBody?.();
  expect(await pending).toEqual({ kind: "unavailable" });
  mode = "deadline";
  const started = performance.now();
  expect(await telemetry.runJob(() => provider.status(command))).toEqual({
    kind: "unavailable",
  });
  expect(performance.now() - started).toBeGreaterThanOrEqual(4_900);
  await telemetry.flush();
  expect(calls).toBe(2);
  expect(
    spans
      .getFinishedSpans()
      .map((span) => span.attributes["dependency.outcome"]),
  ).toEqual(["failed", "failed"]);
}, 10_000);

test("default OFF and disabled nested scope suppress collection while zero sampling keeps the request counter", async (owner) => {
  let calls = 0;
  const endpoint = await listen(owner, (request, response) => {
    calls++;
    request.resume();
    response.end(JSON.stringify(result));
  });
  const provider = new HttpCommunityEntitlementProvider(
    endpoint,
    "private-secret",
  );
  const off = technicalTelemetryFromEnvironment({
    environment: {},
    service: "platform-api",
    mode: "test",
    identity: { release: "proof", sourceSha: "a".repeat(40) },
  });
  owner.onTestFinished(() => off.shutdown());
  const { telemetry, spans, metrics } = runtime(owner, 0);
  expect(await off.runJob(() => provider.set(command))).toEqual({
    kind: "result",
    result,
  });
  await telemetry.runJob(async () => {
    expect(await off.runJob(() => provider.status(command))).toEqual({
      kind: "result",
      result,
    });
    expect(await provider.set(command)).toEqual({ kind: "result", result });
  });
  await telemetry.flush();
  expect(calls).toBe(3);
  expect(spans.getFinishedSpans()).toEqual([]);
  const count = metrics
    .getMetrics()
    .flatMap((resource) =>
      resource.scopeMetrics.flatMap((scope) => scope.metrics),
    )
    .find(
      (metric) => metric.descriptor.name === "inside.dependency.operations",
    );
  expect(count?.dataPoints).toMatchObject([
    {
      attributes: {
        dependency: "telegram",
        operation: "community.set",
        outcome: "completed",
      },
      value: 1,
    },
  ]);
});

test("foreign context ownership and repeated telemetry leases preserve native delivery", async (owner) => {
  let calls = 0;
  const endpoint = await listen(owner, (request, response) => {
    calls++;
    request.resume();
    response.end(JSON.stringify(result));
  });
  const provider = new HttpCommunityEntitlementProvider(
    endpoint,
    "private-secret",
  );
  const foreign = new AsyncLocalStorageContextManager().enable();
  let registered = false;
  let candidate: ReturnType<typeof createTechnicalTelemetry> | undefined;
  try {
    registered = context.setGlobalContextManager(foreign);
    expect(registered).toBe(true);
    const spans = new InMemorySpanExporter();
    candidate = createTechnicalTelemetry({
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
    const marker = createContextKey("community foreign owner");
    const current = candidate;
    await foreign.with(ROOT_CONTEXT.setValue(marker, "preserved"), () =>
      current.runJob(async () => {
        expect(await provider.set(command)).toEqual({ kind: "result", result });
        expect(context.active().getValue(marker)).toBe("preserved");
      }),
    );
    await candidate.flush();
    expect(spans.getFinishedSpans()).toEqual([]);
  } finally {
    await candidate?.shutdown();
    if (registered) context.disable();
    foreign.disable();
  }
  for (let index = 0; index < 2; index++) {
    const spans = new InMemorySpanExporter();
    const telemetry = createTechnicalTelemetry({
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
      await telemetry.runJob(() => provider.status(command));
      await telemetry.flush();
      expect(spans.getFinishedSpans()).toHaveLength(1);
    } finally {
      await telemetry.shutdown();
    }
  }
  expect(calls).toBe(3);
});

for (const exportStatus of [200, 503] as const) {
  test(`native community exchange survives OTLP HTTP ${exportStatus} without exporting private protocol data`, async (owner) => {
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
        response
          .writeHead(exportStatus, { "content-type": "application/json" })
          .end(exportStatus === 200 ? "{}" : "private-export-error");
      });
    });
    let calls = 0;
    const endpoint = await listen(owner, (request, response) => {
      calls++;
      request.resume();
      response.end(JSON.stringify(result));
    });
    for (const key of Object.keys(process.env))
      if (key.startsWith("OTEL_EXPORTER_OTLP")) vi.stubEnv(key, undefined);
    owner.onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const warnings = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    owner.onTestFinished(() => {
      warnings.mockRestore();
    });
    const telemetry = technicalTelemetryFromEnvironment({
      environment: {
        INSIDE_OTEL_ENABLED: "true",
        INSIDE_OTEL_ENDPOINT: new URL(exporter).origin,
      },
      service: "platform-api",
      mode: "test",
      identity: { release: "proof", sourceSha: "a".repeat(40) },
    });
    owner.onTestFinished(() => telemetry.shutdown());
    const provider = new HttpCommunityEntitlementProvider(
      endpoint,
      "private-secret",
    );
    expect(await telemetry.runJob(() => provider.set(command))).toEqual({
      kind: "result",
      result,
    });
    await telemetry.flush();
    expect(calls).toBe(1);
    const wire = exported.join("\n");
    for (const value of [
      "private-",
      endpoint,
      command.operationId,
      command.binding.linkRef,
      command.correlationRef,
      "entitlementRevision",
      "observedMembership",
      "groupUrl",
      "authorization",
      "baggage",
      "tracestate",
    ])
      expect(wire).not.toContain(value);
    const traceSchema = z.object({
      resourceSpans: z.array(
        z.object({
          scopeSpans: z.array(
            z.object({
              spans: z.array(
                z.object({
                  spanId: z.string(),
                  name: z.string(),
                  attributes: z.array(z.object({ key: z.string() })),
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
    expect(new Set(spans.map((span) => span.spanId)).size).toBe(1);
    expect(
      spans.every(
        (span) =>
          span.name === "telegram community.set" &&
          (span.events?.length ?? 0) === 0 &&
          span.attributes.every((attribute) =>
            [
              "dependency.name",
              "dependency.operation",
              "dependency.outcome",
              "http.request.method",
              "http.response.status_code",
            ].includes(attribute.key),
          ),
      ),
    ).toBe(true);
    if (exportStatus === 503) {
      expect(telemetry.diagnostics().failedTraceExports).toBeGreaterThan(0);
      expect(telemetry.diagnostics().failedMetricExports).toBeGreaterThan(0);
    } else
      expect(telemetry.diagnostics()).toEqual({
        droppedSpans: 0,
        failedTraceExports: 0,
        failedMetricExports: 0,
      });
  });
}

import Fastify from "fastify";
import { request as nativeRequest } from "node:http";
import { deferred } from "../support/deferred.js";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { ResourceMetrics } from "@opentelemetry/sdk-metrics";
import { expect, it } from "vitest";
import { HttpLifetime } from "../../src/application/http-lifetime.js";
import { installTelegramHttpObservation } from "../../src/application/http-observation.js";
import { createTelegramObservability } from "../../src/observability/telegram-sdk.js";

it("owned native Fastify counts normal, schema400,404, thrown500 and terminal503 exactly once without trusting incoming parents", async () => {
  const spans: ReadableSpan[] = [];
  const metrics: ResourceMetrics[] = [];
  const runtime = createTelegramObservability({
    identity: {
      release: "test",
      sourceSha: "0000000000000000000000000000000000000000",
    },
    mode: "test",
    sampleRatio: 1,
    exporters: {
      spans: {
        export: (batch, callback) => {
          spans.push(...batch);
          callback({ code: ExportResultCode.SUCCESS });
        },
        shutdown: () => Promise.resolve(),
      },
      metrics: {
        export: (batch, callback) => {
          metrics.push(batch);
          callback({ code: ExportResultCode.SUCCESS });
        },
        forceFlush: () => Promise.resolve(),
        shutdown: () => Promise.resolve(),
      },
    },
  });
  const server = Fastify({ logger: false });
  installTelegramHttpObservation(server, runtime);
  const lifetime = new HttpLifetime(server);
  let healthCalls = 0;
  try {
    server.get("/health", () => {
      healthCalls++;
      return { status: "ok" };
    });
    server.get("/ready", () => {
      throw new Error("private_synthetic_error");
    });
    server.post(
      "/integrations/platform/v1/communications",
      {
        schema: {
          body: {
            type: "object",
            required: ["accepted"],
            properties: { accepted: { type: "boolean" } },
            additionalProperties: false,
          },
        },
      },
      () => ({ status: "ok" }),
    );
    const base = await server.listen({ host: "127.0.0.1", port: 0 });
    const statuses: number[] = [];
    for (const [route, method, body] of [
      ["/health", "GET", undefined],
      ["/integrations/platform/v1/communications", "POST", "{}"],
      ["/private_synthetic_identifier?private=query", "GET", undefined],
      ["/ready", "GET", undefined],
    ] as const) {
      // deterministic-test-allow unit-io: actual owned native HTTP,1000ms client failure budget, finally drains public Fastify and SDK owners.
      const response = await fetch(new URL(route, base), {
        method,
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(1000),
        headers: {
          traceparent:
            "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01",
          baggage: "private=private_synthetic_baggage",
          "content-type": "application/json",
        },
      });
      statuses.push(response.status);
      await response.body?.cancel();
    }
    lifetime.closeAdmission();
    // deterministic-test-allow unit-io: actual terminal admission response, existing same1000ms failure budget, public lifetime owns cleanup.
    const stopped = await fetch(new URL("/health", base), {
      signal: AbortSignal.timeout(1000),
    });
    statuses.push(stopped.status);
    await stopped.body?.cancel();
    expect(statuses).toEqual([200, 400, 404, 500, 503]);
    expect(healthCalls).toBe(1);
  } finally {
    await lifetime.drain();
    await runtime.shutdown();
  }
  expect(spans).toHaveLength(5);
  for (const span of spans) {
    expect(span.parentSpanContext).toBeUndefined();
    expect(span.spanContext().traceId).not.toBe(
      "1234567890abcdef1234567890abcdef",
    );
    expect(JSON.stringify(span.attributes)).not.toContain("private_synthetic");
  }
  const counts = metrics
    .flatMap((batch) => batch.scopeMetrics.flatMap((scope) => scope.metrics))
    .filter((metric) => metric.descriptor.name === "http.server.request.count")
    .flatMap((metric) => metric.dataPoints.map((point) => point.value));
  expect(counts).toEqual([2, 1, 1, 1]);
});

it("owned native disconnect finishes HTTP once while the real rejected handler retains both lifetime and SDK cleanup ownership", async () => {
  const spans: ReadableSpan[] = [];
  const metrics: ResourceMetrics[] = [];
  const held = deferred();
  const started = deferred();
  const wireClosed = deferred();
  const clientClosed = deferred();
  const original = new Error("private_synthetic_late_handler_failure");
  let sdkClosed = 0;
  const runtime = createTelegramObservability({
    identity: {
      release: "test",
      sourceSha: "0000000000000000000000000000000000000000",
    },
    mode: "test",
    sampleRatio: 1,
    exporters: {
      spans: {
        export: (batch, callback) => {
          spans.push(...batch);
          callback({ code: ExportResultCode.SUCCESS });
        },
        shutdown: () => {
          sdkClosed++;
          return Promise.resolve();
        },
      },
      metrics: {
        export: (batch, callback) => {
          metrics.push(batch);
          callback({ code: ExportResultCode.SUCCESS });
        },
        forceFlush: () => Promise.resolve(),
        shutdown: () => Promise.resolve(),
      },
    },
  });
  const server = Fastify({ logger: false });
  installTelegramHttpObservation(server, runtime);
  const lifetime = new HttpLifetime(server);
  let client: ReturnType<typeof nativeRequest> | undefined;
  try {
    server.get("/health", async (_request, reply) => {
      reply.raw.once("close", () => wireClosed.resolve());
      started.resolve();
      await held.promise;
      return { status: "ok" };
    });
    const base = await server.listen({ host: "127.0.0.1", port: 0 });
    client = nativeRequest(new URL("/health", base));
    client.on("error", () => undefined);
    client.once("close", () => clientClosed.resolve());
    client.end();
    await started.promise;
    client.destroy();
    await clientClosed.promise;
    await wireClosed.promise;
    const draining = lifetime.drain();
    const closing = runtime.shutdown();
    expect(lifetime.isQuiescent()).toBe(false);
    expect(sdkClosed).toBe(0);
    held.reject(original);
    expect((await draining).failures).toEqual([original]);
    await closing;
    expect(sdkClosed).toBe(1);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes).toEqual({
      "http.route": "/health",
      "http.request.method": "GET",
      "http.request.outcome": "aborted",
    });
    const counts = metrics
      .flatMap((batch) => batch.scopeMetrics.flatMap((scope) => scope.metrics))
      .filter(
        (metric) => metric.descriptor.name === "http.server.request.count",
      )
      .flatMap((metric) => metric.dataPoints.map((point) => point.value));
    expect(counts).toEqual([1]);
  } finally {
    client?.destroy();
    held.resolve();
    await lifetime.drain();
    await runtime.shutdown();
  }
});

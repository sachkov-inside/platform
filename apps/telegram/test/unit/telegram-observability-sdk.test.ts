import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import type {
  PushMetricExporter,
  ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import { expect, it } from "vitest";
import { deferred } from "../support/deferred.js";
import { createTelegramObservability } from "../../src/observability/telegram-sdk.js";

function collector() {
  const spans: ReadableSpan[] = [];
  const metrics: ResourceMetrics[] = [];
  const traceExporter: SpanExporter = {
    export: (batch, callback) => {
      spans.push(...batch);
      callback({ code: ExportResultCode.SUCCESS });
    },
    shutdown: () => Promise.resolve(),
  };
  const metricExporter: PushMetricExporter = {
    export: (batch, callback) => {
      metrics.push(batch);
      callback({ code: ExportResultCode.SUCCESS });
    },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
  return {
    spans,
    metrics,
    exporters: { spans: traceExporter, metrics: metricExporter },
  };
}

it("local ratio0 ignores remote sampled flags while actual operations still increment metrics", async () => {
  const sink = collector();
  const runtime = createTelegramObservability({
    identity: {
      release: "test",
      sourceSha: "0000000000000000000000000000000000000000",
    },
    mode: "test",
    sampleRatio: 0,
    exporters: sink.exporters,
  });
  try {
    await runtime.runReceipt(
      "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01",
      async (carrier) => {
        expect(carrier).toMatch(
          /^00-1234567890abcdef1234567890abcdef-[0-9a-f]{16}-00$/,
        );
        await runtime.runAuthorization(carrier, (wire) => {
          expect(wire.traceparent()).toMatch(
            /^00-1234567890abcdef1234567890abcdef-[0-9a-f]{16}-00$/,
          );
          wire.response(200);
          wire.complete("accepted");
          return Promise.resolve();
        });
        await runtime.runAttempt(carrier, () =>
          runtime.runBotApi(() =>
            Promise.resolve({
              kind: "delivered" as const,
              providerMessageId: "private_synthetic",
            }),
          ),
        );
      },
    );
  } finally {
    await runtime.shutdown();
  }
  expect(sink.spans).toEqual([]);
  const counts = sink.metrics
    .flatMap((batch) => batch.scopeMetrics.flatMap((scope) => scope.metrics))
    .filter((metric) => metric.descriptor.name === "inside.telegram.operations")
    .flatMap((metric) =>
      metric.dataPoints.map((point) => ({
        operation: point.attributes["operation"],
        value: point.value,
      })),
    );
  expect(counts).toEqual([
    { operation: "authorization", value: 1 },
    { operation: "sendMessage", value: 1 },
    { operation: "attempt", value: 1 },
    { operation: "receipt", value: 1 },
  ]);
});

it("local ratio1 records unsampled remote lineage with authorization and durable attempt as siblings", async () => {
  const sink = collector();
  const runtime = createTelegramObservability({
    identity: {
      release: "test",
      sourceSha: "0000000000000000000000000000000000000000",
    },
    mode: "test",
    sampleRatio: 1,
    exporters: sink.exporters,
  });
  const receiptCarriers: (string | null)[] = [];
  let authorizationCarrier: string | undefined;
  try {
    await runtime.runReceipt(
      "00-1234567890abcdef1234567890abcdef-1234567890abcdef-00",
      async (carrier) => {
        receiptCarriers.push(carrier);
        expect(carrier?.endsWith("-01")).toBe(true);
        await runtime.runAuthorization(carrier, (wire) => {
          authorizationCarrier = wire.traceparent();
          wire.response(200);
          wire.complete("accepted");
          return Promise.resolve();
        });
        await runtime.runAttempt(carrier, () =>
          runtime.runBotApi(() =>
            Promise.resolve({
              kind: "delivered" as const,
              providerMessageId: "private_synthetic",
            }),
          ),
        );
      },
    );
  } finally {
    await runtime.shutdown();
  }
  expect(sink.spans).toHaveLength(4);
  const receipt = sink.spans.find((span) => span.name === "waitlist receipt");
  const authorization = sink.spans.find(
    (span) => span.name === "platform waitlist.confirm",
  );
  const attempt = sink.spans.find((span) => span.name === "waitlist attempt");
  const bot = sink.spans.find((span) => span.name === "telegram sendMessage");
  expect(receipt?.parentSpanContext).toMatchObject({
    spanId: "1234567890abcdef",
    traceFlags: 0,
    isRemote: true,
  });
  expect(authorization?.parentSpanContext?.spanId).toBe(
    receipt?.spanContext().spanId,
  );
  expect(attempt?.parentSpanContext?.spanId).toBe(
    receipt?.spanContext().spanId,
  );
  expect(bot?.parentSpanContext?.spanId).toBe(attempt?.spanContext().spanId);
  expect(authorizationCarrier?.split("-")[2]).toBe(
    authorization?.spanContext().spanId,
  );
  expect(receiptCarriers[0]?.split("-")[2]).toBe(receipt?.spanContext().spanId);
  for (const span of sink.spans) {
    expect(span.spanContext().traceId).toBe("1234567890abcdef1234567890abcdef");
    expect(span.spanContext().traceFlags).toBe(1);
    expect(span.events).toEqual([]);
    expect(span.links).toEqual([]);
    expect(JSON.stringify(span.attributes)).not.toContain("private_synthetic");
    expect(span.resource.attributes).toEqual({
      "service.name": "inside-telegram",
      "deployment.environment.name": "test",
      "service.version": "test",
    });
  }
});

it("fractional sampling makes the same fixed trace decision for either remote flag", async () => {
  const sink = collector();
  const runtime = createTelegramObservability({
    identity: {
      release: "test",
      sourceSha: "0000000000000000000000000000000000000000",
    },
    mode: "test",
    sampleRatio: 0.5,
    exporters: sink.exporters,
  });
  const low = "00000000000000000000000000000001";
  const high = "ffffffff000000000000000000000000";
  const carriers: (string | null)[] = [];
  try {
    for (const traceId of [low, high])
      for (const flag of ["00", "01"]) {
        await runtime.runReceipt(
          `00-${traceId}-1234567890abcdef-${flag}`,
          (value) => {
            carriers.push(value);
            return Promise.resolve();
          },
        );
      }
  } finally {
    await runtime.shutdown();
  }
  // Literal trace IDs lie on opposite sides of the pinned ratio0.5 boundary.
  expect(carriers.map((value) => value?.slice(-2))).toEqual([
    "01",
    "01",
    "00",
    "00",
  ]);
  expect(sink.spans.map((span) => span.spanContext().traceId)).toEqual([
    low,
    low,
  ]);
});

it("a null stored row carrier starts independently even inside a different owned receipt scope", async () => {
  const sink = collector();
  const runtime = createTelegramObservability({
    identity: {
      release: "test",
      sourceSha: "0000000000000000000000000000000000000000",
    },
    mode: "test",
    sampleRatio: 1,
    exporters: sink.exporters,
  });
  try {
    await runtime.runReceipt(
      "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01",
      async () => {
        await runtime.runAttempt(null, () => Promise.resolve());
      },
    );
    await runtime.runReceipt(undefined, (value) => {
      expect(value).toBeNull();
      return Promise.resolve();
    });
  } finally {
    await runtime.shutdown();
  }
  const attempt = sink.spans.find((span) => span.name === "waitlist attempt");
  expect(attempt?.parentSpanContext).toBeUndefined();
  expect(attempt?.spanContext().traceId).not.toBe(
    "1234567890abcdef1234567890abcdef",
  );
  expect(sink.spans).toHaveLength(3);
});

it("bounds512 live SDK scopes, preserves overflow operations and waits admitted work before exporter close", async () => {
  const sink = collector();
  const held = deferred();
  const sdkClosed = deferred();
  let traceClosed = 0;
  const runtime = createTelegramObservability({
    identity: {
      release: "test",
      sourceSha: "0000000000000000000000000000000000000000",
    },
    mode: "test",
    sampleRatio: 1,
    exporters: {
      ...sink.exporters,
      spans: {
        ...sink.exporters.spans,
        shutdown: () => {
          traceClosed++;
          sdkClosed.resolve();
          return Promise.resolve();
        },
      },
    },
  });
  const running = Array.from({ length: 512 }, () =>
    runtime.runAttempt(null, () => held.promise),
  );
  let overflowRan = false;
  await runtime.runAttempt(null, () => {
    overflowRan = true;
    return Promise.resolve();
  });
  const closing = runtime.shutdown();
  expect(runtime.shutdown()).toBe(closing);
  expect(traceClosed).toBe(0);
  try {
    expect(overflowRan).toBe(true);
    held.resolve();
    await Promise.all(running);
    await sdkClosed.promise;
    await closing;
    expect(traceClosed).toBe(1);
    expect(sink.spans).toHaveLength(512);
    const metrics = sink.metrics.flatMap((batch) =>
      batch.scopeMetrics.flatMap((scope) => scope.metrics),
    );
    expect(
      metrics
        .find((metric) => metric.descriptor.name === "telemetry.trace.dropped")
        ?.dataPoints.map((point) => point.value),
    ).toEqual([1]);
    expect(
      metrics
        .find(
          (metric) => metric.descriptor.name === "inside.telegram.operations",
        )
        ?.dataPoints.map((point) => point.value),
    ).toEqual([513]);
  } finally {
    held.resolve();
    await Promise.all(running);
    await closing;
  }
});

it("partial official SDK construction releases acquired transports and leaves business work available", async () => {
  const sink = collector();
  let tracesClosed = 0;
  let metricsClosed = 0;
  Object.defineProperty(
    sink.exporters.metrics,
    "selectAggregationTemporality",
    {
      get: () => {
        throw new Error("synthetic exporter boundary failure");
      },
    },
  );
  const runtime = createTelegramObservability({
    identity: {
      release: "test",
      sourceSha: "0000000000000000000000000000000000000000",
    },
    mode: "test",
    sampleRatio: 1,
    exporters: {
      spans: {
        ...sink.exporters.spans,
        shutdown: () => {
          tracesClosed++;
          return Promise.resolve();
        },
      },
      metrics: Object.assign(sink.exporters.metrics, {
        shutdown: () => {
          metricsClosed++;
          return Promise.resolve();
        },
      }),
    },
  });
  expect(
    await runtime.runReceipt(undefined, (carrier) => {
      expect(carrier).toBeNull();
      return Promise.resolve("unchanged");
    }),
  ).toBe("unchanged");
  await runtime.shutdown();
  await runtime.shutdown();
  expect(tracesClosed).toBe(1);
  expect(metricsClosed).toBe(1);
});

it("business metric dimensions match the collector contract while span dimensions remain prefixed", async () => {
  const sink = collector();
  const runtime = createTelegramObservability({
    identity: {
      release: "test",
      sourceSha: "0000000000000000000000000000000000000000",
    },
    mode: "test",
    sampleRatio: 1,
    exporters: sink.exporters,
  });
  try {
    await runtime.runReceipt(
      "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01",
      () => Promise.resolve(),
    );
  } finally {
    await runtime.shutdown();
  }
  const business = sink.metrics
    .flatMap((batch) => batch.scopeMetrics.flatMap((scope) => scope.metrics))
    .filter(
      (metric) =>
        metric.descriptor.name === "inside.telegram.operations" ||
        metric.descriptor.name === "inside.telegram.duration",
    );
  expect(business.map((metric) => metric.descriptor.name).sort()).toEqual([
    "inside.telegram.duration",
    "inside.telegram.operations",
  ]);
  for (const metric of business) {
    expect(metric.dataPoints).toHaveLength(1);
    expect(metric.dataPoints[0]?.attributes).toEqual({
      operation: "receipt",
      outcome: "completed",
    });
  }
  expect(sink.spans).toHaveLength(1);
  expect(sink.spans[0]?.attributes).toEqual({
    "telegram.operation": "receipt",
    "telegram.outcome": "completed",
  });
});

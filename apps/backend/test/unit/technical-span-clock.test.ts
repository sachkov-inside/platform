import { context, ROOT_CONTEXT, SpanKind, trace } from "@opentelemetry/api";
import { performance } from "node:perf_hooks";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { expect, test, vi } from "vitest";
import {
  beginPostgresObservation,
  createTechnicalTelemetry,
} from "../../src/infrastructure/observability/technical-telemetry.js";

function nanoseconds(value: readonly [number, number]): bigint {
  return BigInt(value[0]) * 1_000_000_000n + BigInt(value[1]);
}

test("a SQL child completed before its tracking delivery retains that strict exported end order across wall-clock quantization", async () => {
  const spans = new InMemorySpanExporter();
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "test",
    sampleRatio: 1,
    exporters: {
      spans,
      metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    },
  });
  const base = Math.floor(performance.timeOrigin) + 100;
  const initial = base - performance.timeOrigin + 0.9;
  let wall = base;
  let elapsed = initial;
  const date = vi.spyOn(Date, "now").mockImplementation(() => wall);
  const monotonic = vi
    .spyOn(performance, "now")
    .mockImplementation(() => elapsed);
  try {
    await telemetry.runTrackingDelivery(undefined, () => {
      // Two starts straddle an integer Date.now millisecond while only0.1ms elapses.
      // This is an external clock input; the real SDK/provider/exporter stay in place.
      wall = base + 1;
      elapsed = initial + 0.1;
      const query = beginPostgresObservation("query");
      elapsed = initial + 0.2;
      query.complete(false, () => undefined);
      elapsed = initial + 0.3;
      return Promise.resolve();
    });
    await telemetry.flush();
    const finished = spans.getFinishedSpans();
    expect(finished).toHaveLength(2);
    const child = finished.find((span) => span.name === "postgresql query");
    const parent = finished.find((span) => span.name === "tracking deliver");
    expect(child).toBeDefined();
    expect(parent).toBeDefined();
    if (child === undefined || parent === undefined)
      throw new Error("expected completed delivery and SQL child");
    expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
    expect(child.spanContext().traceId).toBe(parent.spanContext().traceId);
    expect(nanoseconds(child.startTime)).toBeGreaterThanOrEqual(
      nanoseconds(parent.startTime),
    );
    expect(nanoseconds(child.endTime)).toBeLessThanOrEqual(
      nanoseconds(parent.endTime),
    );
  } finally {
    date.mockRestore();
    monotonic.mockRestore();
    await telemetry.shutdown();
  }
});

test("the pg-boss supplied consumer tracer and SQL instrumentation share the same monotonic clock", async () => {
  const spans = new InMemorySpanExporter();
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-notifications-worker",
    environment: "test",
    release: "test",
    sampleRatio: 1,
    exporters: {
      spans,
      metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    },
  });
  const base = Math.floor(performance.timeOrigin) + 100;
  const initial = base - performance.timeOrigin + 0.9;
  let wall = base;
  let elapsed = initial;
  const date = vi.spyOn(Date, "now").mockImplementation(() => wall);
  const monotonic = vi
    .spyOn(performance, "now")
    .mockImplementation(() => elapsed);
  try {
    const tracer = telemetry
      .pgBoss(["notification.dispatch"])
      .tracerProvider?.getTracer("pg-boss");
    if (tracer === undefined)
      throw new Error("expected enabled consumer tracer");
    const parent = tracer.startSpan("process notification.dispatch", {
      kind: SpanKind.CONSUMER,
      attributes: {
        "messaging.operation.name": "process",
        "messaging.destination.name": "notification.dispatch",
      },
    });
    context.with(trace.setSpan(ROOT_CONTEXT, parent), () =>
      telemetry.runJob(() => {
        wall = base + 1;
        elapsed = initial + 0.1;
        const query = beginPostgresObservation("query");
        elapsed = initial + 0.2;
        query.complete(false, () => undefined);
        elapsed = initial + 0.3;
        parent.end();
      }),
    );
    await telemetry.flush();
    const finished = spans.getFinishedSpans();
    expect(finished).toHaveLength(2);
    const child = finished.find((span) => span.name === "postgresql query");
    const consumer = finished.find(
      (span) => span.name === "process notification.dispatch",
    );
    if (child === undefined || consumer === undefined)
      throw new Error("expected consumer and SQL child");
    expect(child.parentSpanContext?.spanId).toBe(consumer.spanContext().spanId);
    expect(child.spanContext().traceId).toBe(consumer.spanContext().traceId);
    expect(nanoseconds(child.startTime)).toBeGreaterThanOrEqual(
      nanoseconds(consumer.startTime),
    );
    expect(nanoseconds(child.endTime)).toBeLessThanOrEqual(
      nanoseconds(consumer.endTime),
    );
  } finally {
    date.mockRestore();
    monotonic.mockRestore();
    await telemetry.shutdown();
  }
});

test("explicit caller timestamps stay intact even when they describe a child outside its parent interval", async () => {
  const spans = new InMemorySpanExporter();
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-notifications-worker",
    environment: "test",
    release: "test",
    sampleRatio: 1,
    exporters: {
      spans,
      metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    },
  });
  try {
    const tracer = telemetry
      .pgBoss(["notification.dispatch"])
      .tracerProvider?.getTracer("pg-boss");
    if (tracer === undefined)
      throw new Error("expected enabled consumer tracer");
    const parent = tracer.startSpan("process notification.dispatch", {
      startTime: [100, 0],
      attributes: {
        "messaging.operation.name": "process",
        "messaging.destination.name": "notification.dispatch",
      },
    });
    const child = tracer.startSpan(
      "send notification.dispatch",
      {
        startTime: [100, 100],
        attributes: {
          "messaging.operation.name": "send",
          "messaging.destination.name": "notification.dispatch",
        },
      },
      trace.setSpan(ROOT_CONTEXT, parent),
    );
    child.end([100, 300]);
    parent.end([100, 200]);
    await telemetry.flush();
    const finished = spans.getFinishedSpans();
    expect(finished).toHaveLength(2);
    const send = finished.find(
      (span) => span.name === "send notification.dispatch",
    );
    const process = finished.find(
      (span) => span.name === "process notification.dispatch",
    );
    expect(send?.startTime).toEqual([100, 100]);
    expect(send?.endTime).toEqual([100, 300]);
    expect(process?.startTime).toEqual([100, 0]);
    expect(process?.endTime).toEqual([100, 200]);
  } finally {
    await telemetry.shutdown();
  }
});

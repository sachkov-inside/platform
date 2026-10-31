import { SpanKind } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { expect, test, onTestFinished } from "vitest";
import {
  captureNotificationTraceparent,
  createTechnicalTelemetry,
  observeCommunicationsRequest,
} from "../../src/infrastructure/observability/technical-telemetry.js";

test("tracking attempts resume their original HTTP parent and isolate retries from unrelated ambient requests", async () => {
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "test",
    sampleRatio: 1,
    exporters: { spans, metrics },
  });
  onTestFinished(() => telemetry.shutdown());
  const source = telemetry.startHttp({
    method: "POST",
    route: "/communications/tracking/resolve",
  });
  const parent = source.run(() => captureNotificationTraceparent());
  source.finish(200, 1);
  const unrelated = telemetry.startHttp({ method: "GET", route: "/health" });
  const privateFailure = new Error("private-provider-failure-sentinel");
  for (let attempt = 0; attempt < 2; attempt++) {
    await unrelated.run(() =>
      telemetry.runTrackingDelivery(parent, async (observation) => {
        await observeCommunicationsRequest((response) => {
          response(200);
          return Promise.resolve(undefined);
        });
        if (attempt === 0) observation.fail();
      }),
    );
  }
  await expect(
    telemetry.runTrackingDelivery(parent, () => Promise.reject(privateFailure)),
  ).rejects.toBe(privateFailure);
  unrelated.finish(200, 1);
  await telemetry.flush();
  const finished = spans.getFinishedSpans();
  const request = finished.find(
    (span) => span.name === "POST /communications/tracking/resolve",
  );
  expect(request).toBeDefined();
  const deliveries = finished.filter(
    (span) => span.name === "tracking deliver",
  );
  expect(deliveries).toHaveLength(3);
  expect(
    new Set(deliveries.map((span) => span.spanContext().spanId)).size,
  ).toBe(3);
  for (const delivery of deliveries) {
    expect(delivery.kind).toBe(SpanKind.INTERNAL);
    expect(delivery.spanContext().traceId).toBe(request?.spanContext().traceId);
    expect(delivery.parentSpanContext?.spanId).toBe(
      request?.spanContext().spanId,
    );
    expect(Object.keys(delivery.attributes).sort()).toEqual([
      "tracking.operation",
      "tracking.outcome",
    ]);
  }
  expect(deliveries.map((span) => span.attributes["tracking.outcome"])).toEqual(
    ["failed", "completed", "failed"],
  );
  const children = finished.filter(
    (span) => span.name === "telegram communications.execute",
  );
  expect(children).toHaveLength(2);
  for (const child of children)
    expect(
      deliveries.some(
        (parent) =>
          parent.spanContext().spanId === child.parentSpanContext?.spanId,
      ),
    ).toBe(true);
  const exported = metrics
    .getMetrics()
    .flatMap((batch) => batch.scopeMetrics.flatMap((scope) => scope.metrics));
  const counts = exported
    .filter((metric) => metric.descriptor.name === "inside.tracking.operations")
    .flatMap((metric) =>
      metric.dataPointType === DataPointType.SUM ? metric.dataPoints : [],
    );
  expect(counts.map((point) => [point.attributes, point.value])).toEqual([
    [{ operation: "deliver", outcome: "failed" }, 2],
    [{ operation: "deliver", outcome: "completed" }, 1],
  ]);
  expect(
    JSON.stringify({
      spans: finished.map((span) => ({
        attributes: span.attributes,
        events: span.events,
      })),
      metrics: metrics.getMetrics(),
    }),
  ).not.toContain("private-");
});

test.each([
  { label: "NULL", parent: null },
  { label: "absent", parent: undefined },
  { label: "malformed", parent: "private-invalid-carrier" },
  {
    label: "zero trace",
    parent: "00-00000000000000000000000000000000-1111111111111111-01",
  },
  { label: "foreign object", parent: { traceparent: "private-carrier" } },
])(
  "invalid historical carrier $label loses only causality",
  async ({ parent }) => {
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
    onTestFinished(() => telemetry.shutdown());
    const unrelated = telemetry.startHttp({ method: "GET", route: "/health" });
    const result = await unrelated.run(() =>
      telemetry.runTrackingDelivery(parent, () => Promise.resolve("delivered")),
    );
    unrelated.finish(200, 1);
    expect(result).toBe("delivered");
    await telemetry.flush();
    const delivery = spans
      .getFinishedSpans()
      .find((span) => span.name === "tracking deliver");
    expect(delivery).toBeDefined();
    expect(delivery?.parentSpanContext).toBeUndefined();
    expect(JSON.stringify(delivery?.attributes)).not.toContain("private-");
  },
);

test("disabled delivery observation clears foreign technical scope and preserves work errors", async () => {
  const spans = new InMemorySpanExporter();
  const enabled = createTechnicalTelemetry({
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
  onTestFinished(() => enabled.shutdown());
  const disabled = createTechnicalTelemetry({ enabled: false });
  const request = enabled.startHttp({ method: "GET", route: "/health" });
  const error = new Error("private-work-error");
  await expect(
    request.run(() =>
      disabled.runTrackingDelivery(undefined, async () => {
        expect(captureNotificationTraceparent()).toBeUndefined();
        await observeCommunicationsRequest(() => Promise.resolve(undefined));
        throw error;
      }),
    ),
  ).rejects.toBe(error);
  request.finish(200, 1);
  await enabled.flush();
  expect(spans.getFinishedSpans().map((span) => span.name)).toEqual([
    "GET /health",
  ]);
});

test("sampled-out tracking attempts still count their completion", async () => {
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "test",
    sampleRatio: 0,
    exporters: { spans, metrics },
  });
  onTestFinished(() => telemetry.shutdown());
  expect(
    await telemetry.runTrackingDelivery(null, () =>
      Promise.resolve("delivered"),
    ),
  ).toBe("delivered");
  await telemetry.flush();
  expect(spans.getFinishedSpans()).toEqual([]);
  const count = metrics
    .getMetrics()
    .flatMap((batch) => batch.scopeMetrics.flatMap((scope) => scope.metrics))
    .find((metric) => metric.descriptor.name === "inside.tracking.operations");
  expect(
    count?.dataPoints.map((point) => [point.attributes, point.value]),
  ).toEqual([[{ operation: "deliver", outcome: "completed" }, 1]]);
});

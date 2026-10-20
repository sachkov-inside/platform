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

test("waitlist attempts resume their original HTTP parent and isolate retries from unrelated ambient requests", async () => {
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
    route: "/product-waitlists/join",
  });
  const parent = source.run(() => captureNotificationTraceparent());
  source.finish(200, 1);
  const unrelated = telemetry.startHttp({ method: "GET", route: "/health" });
  const privateFailure = new Error("private-provider-failure-sentinel");
  for (let attempt = 0; attempt < 2; attempt++) {
    await unrelated.run(() =>
      telemetry.runWaitlistDelivery(parent, async (observation) => {
        await observeCommunicationsRequest((response) => {
          response(200);
          return Promise.resolve(undefined);
        });
        if (attempt === 0) observation.fail();
      }),
    );
  }
  await expect(
    telemetry.runWaitlistDelivery(parent, () => Promise.reject(privateFailure)),
  ).rejects.toBe(privateFailure);
  unrelated.finish(200, 1);
  await telemetry.flush();
  const finished = spans.getFinishedSpans();
  const request = finished.find(
    (span) => span.name === "POST /product-waitlists/join",
  );
  expect(request).toBeDefined();
  const deliveries = finished.filter(
    (span) => span.name === "waitlist deliver",
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
      "waitlist.operation",
      "waitlist.outcome",
    ]);
  }
  expect(deliveries.map((span) => span.attributes["waitlist.outcome"])).toEqual(
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
    .filter((metric) => metric.descriptor.name === "inside.waitlist.operations")
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
      telemetry.runWaitlistDelivery(parent, () => Promise.resolve("delivered")),
    );
    unrelated.finish(200, 1);
    expect(result).toBe("delivered");
    await telemetry.flush();
    const delivery = spans
      .getFinishedSpans()
      .find((span) => span.name === "waitlist deliver");
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
      disabled.runWaitlistDelivery(undefined, async () => {
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

test("sampled-out waitlist attempts still count their completion", async () => {
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
    await telemetry.runWaitlistDelivery(null, () =>
      Promise.resolve("delivered"),
    ),
  ).toBe("delivered");
  await telemetry.flush();
  expect(spans.getFinishedSpans()).toEqual([]);
  const count = metrics
    .getMetrics()
    .flatMap((batch) => batch.scopeMetrics.flatMap((scope) => scope.metrics))
    .find((metric) => metric.descriptor.name === "inside.waitlist.operations");
  expect(
    count?.dataPoints.map((point) => [point.attributes, point.value]),
  ).toEqual([[{ operation: "deliver", outcome: "completed" }, 1]]);
});

test("actual receipt POST is a child of the durable waitlist attempt and never forwards trace metadata", async () => {
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const { deliverWaitlistConfirmation } = await import("../../src/modules/sales-funnel/adapters/nest/waitlist-confirmation-pump.js");
  const spans = new InMemorySpanExporter();
  const telemetry = createTechnicalTelemetry({ enabled: true, service: "platform-api", environment: "test", release: "test", sampleRatio: 1,
    exporters: { spans, metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE) } });
  onTestFinished(() => telemetry.shutdown());
  const command = { contractVersion: "inside.waitlist-confirmation.v1" as const, eventId: "11111111-1111-4111-8111-111111111111", intakeId: "22222222-2222-4222-8222-222222222222", accountRef: "private-account", telegramIdentityRef: "private-identity", linkRevision: 1 };
  const received: string[] = [];
  const server = createServer((request, response) => {
    received.push(JSON.stringify(request.headers));
    request.resume();
    request.on("end", () => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ eventId: command.eventId, status: "accepted" })); });
  });
  onTestFinished(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Owned listener missing");
  const result = await telemetry.runWaitlistDelivery("00-12345678901234567890123456789012-1234567890123456-01", async observation => {
    const result = await deliverWaitlistConfirmation({ endpoint: `http://127.0.0.1:${address.port}`, secret: "private-secret" }, command);
    if (result === "unavailable") observation.fail();
    return result;
  });
  expect(result).toBe("accepted");
  expect(received).toHaveLength(1);
  expect(received[0]).not.toContain("traceparent");
  expect(received[0]).not.toContain("baggage");
  await telemetry.flush();
  const finished = spans.getFinishedSpans();
  const delivery = finished.find(span => span.name === "waitlist deliver");
  const request = finished.find(span => span.name === "telegram waitlist.confirm");
  expect(request).toBeDefined();
  expect(request?.kind).toBe(SpanKind.CLIENT);
  expect(request?.parentSpanContext?.spanId).toBe(delivery?.spanContext().spanId);
  expect(request?.attributes).toEqual({ "dependency.name": "telegram", "dependency.operation": "waitlist.confirm", "dependency.outcome": "completed", "http.request.method": "POST", "http.response.status_code": 200 });
  expect(JSON.stringify(finished.map(span => ({ attributes: span.attributes, events: span.events })))).not.toContain("private-");
});

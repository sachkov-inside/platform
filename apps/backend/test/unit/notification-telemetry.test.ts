import { context, propagation } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { expect, test } from "vitest";
import {
  captureNotificationTraceparent,
  createTechnicalTelemetry,
  observeNotification,
} from "../../src/infrastructure/observability/technical-telemetry.js";

test("durable attempts isolate their persisted parent, preserve caller errors and exclude raw error/baggage data", async () => {
  const spans = new InMemorySpanExporter();
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-notifications-worker",
    environment: "test",
    release: "proof",
    sampleRatio: 1,
    exporters: {
      spans,
      metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    },
  });
  try {
    const unrelated = telemetry.startHttp({
      method: "GET",
      route: "/unrelated",
    });
    const error = new Error("private-error-sentinel", {
      cause: new Error("private-cause-sentinel"),
    });
    error.stack = "private-stack-sentinel";
    await expect(
      unrelated.run(() =>
        context.with(
          propagation.setBaggage(
            context.active(),
            propagation.createBaggage({
              secret: { value: "private-baggage-sentinel" },
            }),
          ),
          () =>
            observeNotification(
              "publish",
              "00-11111111111111111111111111111111-2222222222222222-01",
              (carrier) => {
                expect(carrier).toContain("11111111111111111111111111111111");
                expect(
                  propagation.getBaggage(context.active()),
                ).toBeUndefined();
                return Promise.reject(error);
              },
            ),
        ),
      ),
    ).rejects.toBe(error);
    await unrelated.run(() =>
      observeNotification("audience", null, (carrier) => {
        expect(carrier).toBeUndefined();
        expect(telemetry.correlation()["traceId"]).not.toBe(
          unrelated.run(() => telemetry.correlation()["traceId"]),
        );
        return Promise.resolve();
      }),
    );
    unrelated.finish(200, 1);
    expect(captureNotificationTraceparent()).toBeUndefined();
    await telemetry.flush();
    const attempt = spans
      .getFinishedSpans()
      .find((span) => span.name === "publish materials");
    expect(attempt?.parentSpanContext?.spanId).toBe("2222222222222222");
    expect(attempt?.status).toEqual({ code: 2 });
    expect(attempt?.events).toEqual([]);
    expect(attempt?.attributes["error.type"]).toBe(
      "notification_operation_failed",
    );
    expect(
      JSON.stringify({
        status: attempt?.status,
        attributes: attempt?.attributes,
        events: attempt?.events,
      }),
    ).not.toContain("private-");
  } finally {
    await telemetry.shutdown();
  }
});

test("disabled scopes never capture or propagate another runtime's context", async () => {
  const disabled = createTechnicalTelemetry({ enabled: false });
  const enabled = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "other",
    sampleRatio: 1,
    exporters: {
      spans: new InMemorySpanExporter(),
      metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    },
  });
  try {
    await enabled.runJob(() =>
      disabled.runJob(() =>
        observeNotification(
          "receive",
          "00-11111111111111111111111111111111-2222222222222222-01",
          (carrier) => {
            expect(carrier).toBeUndefined();
            expect(captureNotificationTraceparent()).toBeUndefined();
            return Promise.resolve();
          },
        ),
      ),
    );
  } finally {
    await enabled.shutdown();
    await disabled.shutdown();
  }
});

test("operation counts remain independent of trace sampling", async () => {
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-notifications-worker",
    environment: "test",
    release: "proof",
    sampleRatio: 0,
    exporters: { spans, metrics },
  });
  try {
    await telemetry.runJob(() =>
      observeNotification(
        "audience",
        "00-11111111111111111111111111111111-2222222222222222-01",
        () => Promise.resolve(),
      ),
    );
    await telemetry.flush();
    expect(spans.getFinishedSpans()).toEqual([]);
    const operations = metrics
      .getMetrics()
      .flatMap((resource) =>
        resource.scopeMetrics.flatMap((scope) => scope.metrics),
      )
      .find(
        (metric) => metric.descriptor.name === "inside.notification.operations",
      );
    expect(operations?.dataPoints).toMatchObject([
      { attributes: { operation: "audience", outcome: "completed" }, value: 1 },
    ]);
  } finally {
    await telemetry.shutdown();
  }
});

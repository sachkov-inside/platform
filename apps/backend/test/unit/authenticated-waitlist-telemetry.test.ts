import { SpanKind } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { expect, test } from "vitest";
import {
  captureNotificationTraceparent,
  createTechnicalTelemetry,
  runAuthenticatedWaitlistAuthorization,
} from "../../src/infrastructure/observability/technical-telemetry.js";

// Parent admission belongs to the authenticated controller, never generic HTTP instrumentation.
test.each(["00", "01"])(
  "authenticated authorization uses explicit parent with remote flags %s while HTTP remains a local root",
  async (flags) => {
    const spans = new InMemorySpanExporter();
    const metrics = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    const telemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-api",
      environment: "test",
      release: "test",
      sampleRatio: 1,
      exporters: { spans, metrics },
    });
    const http = telemetry.startHttp({
      method: "POST",
      route: "/integrations/telegram/v1/communications/waitlist",
    });
    let carrier: string | undefined;
    const original = new Error("private-authorization-failure");
    try {
      expect(
        await http.run(() =>
          runAuthenticatedWaitlistAuthorization(
            `00-1234567890abcdef1234567890abcdef-1234567890abcdef-${flags}`,
            () => {
              carrier = captureNotificationTraceparent();
              return Promise.resolve("accepted");
            },
          ),
        ),
      ).toBe("accepted");
      await expect(
        http.run(() =>
          runAuthenticatedWaitlistAuthorization(undefined, () =>
            Promise.reject(original),
          ),
        ),
      ).rejects.toBe(original);
      http.finish(200, 1);
      await telemetry.flush();
      const finished = spans.getFinishedSpans();
      const authorization = finished.filter(
        (span) => span.name === "waitlist authorize",
      );
      expect(authorization).toHaveLength(2);
      expect(authorization[0]?.kind).toBe(SpanKind.INTERNAL);
      expect(authorization[0]?.spanContext().traceId).toBe(
        "1234567890abcdef1234567890abcdef",
      );
      expect(authorization[0]?.parentSpanContext?.spanId).toBe(
        "1234567890abcdef",
      );
      expect(carrier).toBe(
        `00-1234567890abcdef1234567890abcdef-${authorization[0]?.spanContext().spanId}-01`,
      );
      expect(authorization[1]?.parentSpanContext).toBeUndefined();
      const server = finished.find((span) => span.kind === SpanKind.SERVER);
      expect(server).toBeDefined();
      expect(server?.parentSpanContext).toBeUndefined();
      expect(server?.spanContext().traceId).not.toBe(
        "1234567890abcdef1234567890abcdef",
      );
      expect(authorization.map((span) => span.attributes)).toEqual([
        { "waitlist.operation": "authorize", "waitlist.outcome": "completed" },
        { "waitlist.operation": "authorize", "waitlist.outcome": "failed" },
      ]);
      expect(
        JSON.stringify(
          authorization.map((span) => ({
            attributes: span.attributes,
            events: span.events,
          })),
        ),
      ).not.toContain("private-");
      const counts = metrics
        .getMetrics()
        .flatMap((batch) =>
          batch.scopeMetrics.flatMap((scope) => scope.metrics),
        )
        .filter(
          (metric) => metric.descriptor.name === "inside.waitlist.operations",
        )
        .flatMap((metric) =>
          metric.dataPointType === DataPointType.SUM ? metric.dataPoints : [],
        );
      expect(counts.map((point) => [point.attributes, point.value])).toEqual([
        [{ operation: "authorize", outcome: "completed" }, 1],
        [{ operation: "authorize", outcome: "failed" }, 1],
      ]);
    } finally {
      http.finish(200, 1);
      await telemetry.shutdown();
    }
  },
);

test("local ratio0 never records authenticated authorization even for remote sampled flags, while counting both calls", async () => {
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
  const http = telemetry.startHttp({
    method: "POST",
    route: "/integrations/telegram/v1/communications/waitlist",
  });
  try {
    for (const flags of ["00", "01"]) {
      await http.run(() =>
        runAuthenticatedWaitlistAuthorization(
          `00-1234567890abcdef1234567890abcdef-1234567890abcdef-${flags}`,
          () => {
            expect(captureNotificationTraceparent()).toMatch(
              /^00-1234567890abcdef1234567890abcdef-[0-9a-f]{16}-00$/,
            );
            return Promise.resolve();
          },
        ),
      );
    }
    http.finish(200, 1);
    await telemetry.flush();
    expect(spans.getFinishedSpans()).toEqual([]);
    const counts = metrics
      .getMetrics()
      .flatMap((batch) => batch.scopeMetrics.flatMap((scope) => scope.metrics))
      .filter(
        (metric) => metric.descriptor.name === "inside.waitlist.operations",
      )
      .flatMap((metric) =>
        metric.dataPointType === DataPointType.SUM ? metric.dataPoints : [],
      );
    expect(counts.map((point) => [point.attributes, point.value])).toEqual([
      [{ operation: "authorize", outcome: "completed" }, 2],
    ]);
  } finally {
    http.finish(200, 1);
    await telemetry.shutdown();
  }
});

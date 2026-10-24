import { SpanKind } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { ResourceMetrics } from "@opentelemetry/sdk-metrics";
import { expect, it } from "vitest";
import { createTelegramObservability } from "../../src/observability/telegram-sdk.js";

it("generic HTTP is a local SERVER root and the first actual wire outcome counts once", async () => {
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
  try {
    await runtime.runReceipt(
      "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01",
      async () => {
        const observation = runtime.startHttp(
          "POST",
          "/integrations/platform/v1/communications",
        );
        expect(await observation.run(() => Promise.resolve("unchanged"))).toBe(
          "unchanged",
        );
        observation.finish({ outcome: "completed", status: 200 });
        observation.finish({ outcome: "aborted" });
      },
    );
  } finally {
    await runtime.shutdown();
  }
  const server = spans.find((span) => span.kind === SpanKind.SERVER);
  expect(server?.parentSpanContext).toBeUndefined();
  expect(server?.spanContext().traceId).not.toBe(
    "1234567890abcdef1234567890abcdef",
  );
  expect(server?.attributes).toEqual({
    "http.route": "/integrations/platform/v1/communications",
    "http.request.method": "POST",
    "http.request.outcome": "completed",
    "http.response.status_code": 200,
  });
  const counts = metrics
    .flatMap((batch) => batch.scopeMetrics.flatMap((scope) => scope.metrics))
    .filter((metric) => metric.descriptor.name === "http.server.request.count")
    .flatMap((metric) =>
      metric.dataPoints.map((point) => ({
        attributes: point.attributes,
        value: point.value,
      })),
    );
  expect(counts).toEqual([
    {
      attributes: {
        "http.route": "/integrations/platform/v1/communications",
        "http.request.method": "POST",
        "http.request.outcome": "completed",
      },
      value: 1,
    },
  ]);
});

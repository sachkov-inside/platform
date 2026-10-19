import {
  context,
  propagation,
  trace,
  ROOT_CONTEXT,
  createTraceState,
  SpanStatusCode,
} from "@opentelemetry/api";
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
} from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { ExportResultCode } from "@opentelemetry/core";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  createTechnicalTelemetry,
  type TechnicalTelemetry,
} from "../../src/infrastructure/observability/technical-telemetry.js";

import {
  observeJob,
  writeLog,
} from "../../src/infrastructure/observability/index.js";

function enabledPgBoss(
  telemetry: TechnicalTelemetry,
  queues: readonly string[],
) {
  const options = telemetry.pgBoss(queues);
  const { tracerProvider, meterProvider, propagator } = options;
  if (
    tracerProvider === undefined ||
    meterProvider === undefined ||
    propagator === undefined
  )
    throw new Error("enabled queue telemetry unavailable");
  return { ...options, tracerProvider, meterProvider, propagator };
}

describe("pg-boss telemetry privacy boundary", () => {
  it("retains only a detached bounded span snapshot before SDK batching, preserving the caller span", async () => {
    const retention = vi.spyOn(BatchSpanProcessor.prototype, "onEnd");
    const spans = new InMemorySpanExporter();
    const metrics = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    const telemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-material-assets-worker",
      environment: "test",
      release: "test",
      sampleRatio: 1,
      exporters: { spans, metrics },
    });
    try {
      const options = enabledPgBoss(telemetry, ["material-assets.cleanup"]);
      const span = options.tracerProvider
        .getTracer("pg-boss")
        .startSpan("process material-assets.cleanup", {
          attributes: {
            "messaging.operation.name": "process",
            "messaging.destination.name": "material-assets.cleanup",
          },
          links: [
            {
              context: {
                traceId: "1".repeat(32),
                spanId: "2".repeat(16),
                traceFlags: 1,
              },
              attributes: { private: "sentinel-link" },
            },
          ],
        });
      const privateMessage = "sentinel-status-" + "x".repeat(2 * 1024 * 1024);
      span.setStatus({ code: SpanStatusCode.ERROR, message: privateMessage });
      span.end();
      const retained = retention.mock.calls[0]?.[0];
      expect(Object.keys(retained?.status ?? {})).toEqual(["code"]);
      expect(retained?.status.code).toBe(SpanStatusCode.ERROR);
      expect(retained).not.toBe(span);
      expect(retained).not.toHaveProperty("_spanProcessor");
      expect(JSON.stringify(retained).includes("sentinel-")).toBe(false);
      expect(JSON.stringify(retained).length).toBeLessThan(4096);
      expect(retained?.spanContext().traceId).toBe(span.spanContext().traceId);
      expect(retained?.spanContext().spanId).toBe(span.spanContext().spanId);
      expect(retained?.links).toEqual([
        {
          context: {
            traceId: "1".repeat(32),
            spanId: "2".repeat(16),
            traceFlags: 1,
            isRemote: false,
          },
        },
      ]);
      expect(
        z.object({ status: z.object({ message: z.string() }) }).parse(span)
          .status.message === privateMessage,
      ).toBe(true);
    } finally {
      await telemetry.shutdown();
      retention.mockRestore();
    }
  });
  it("keeps PostgreSQL UUID formats including nil and non-RFC variants, excluding non-UUID IDs", async () => {
    const spans = new InMemorySpanExporter();
    const metrics = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    const telemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-material-assets-worker",
      environment: "test",
      release: "test",
      sampleRatio: 1,
      exporters: { spans, metrics },
    });
    try {
      const options = enabledPgBoss(telemetry, ["material-assets.cleanup"]);
      const ids = [
        "550e8400-e29b-41d4-a716-446655440000",
        "00000000-0000-0000-0000-000000000000",
        "FFFFFFFF-FFFF-FFFF-0FFF-FFFFFFFFFFFF",
        "not-a-job-id",
      ];
      for (const id of ids)
        options.tracerProvider
          .getTracer("pg-boss")
          .startSpan("process", { attributes: { "messaging.message.id": id } })
          .end();
      await telemetry.flush();
      expect(
        spans
          .getFinishedSpans()
          .map((span) => span.attributes["messaging.message.id"]),
      ).toEqual([ids[0], ids[1], ids[2], undefined]);
    } finally {
      await telemetry.shutdown();
    }
  });
  it.each([true, false])(
    "keeps job outcomes and request IDs with enabled=%s",
    async (enabled) => {
      const spans = new InMemorySpanExporter();
      const metrics = new InMemoryMetricExporter(
        AggregationTemporality.CUMULATIVE,
      );
      const telemetry = createTechnicalTelemetry(
        enabled
          ? {
              enabled: true,
              service: "platform-api",
              environment: "test",
              release: "job-release",
              sampleRatio: 1,
              exporters: { spans, metrics },
            }
          : { enabled: false },
      );
      const logs = vi
        .spyOn(console, "info")
        .mockImplementation(() => undefined);
      try {
        const options = telemetry.pgBoss(["material-assets.cleanup"]);
        const span = options.tracerProvider
          ?.getTracer("pg-boss")
          .startSpan("process");
        const handler = observeJob(
          "material-assets-worker",
          "material-assets.cleanup",
          async () => {
            await Promise.resolve();
            writeLog("info", "job_result");
            return "same-result";
          },
          telemetry,
        );
        const result = await context.with(
          span === undefined ? ROOT_CONTEXT : trace.setSpan(ROOT_CONTEXT, span),
          () => handler([{ id: "same-job-id" }]),
        );
        span?.end();
        expect(result).toBe("same-result");
        const record = logs.mock.calls.map(([line]) => String(line)).join("");
        expect(record).toContain('"requestId":"same-job-id"');
        if (enabled) {
          expect(record).toContain('"release":"job-release"');
          expect(record).toContain(span?.spanContext().traceId);
        } else {
          expect(options).toEqual({ enabled: false });
          expect(record).not.toContain("traceId");
        }
      } finally {
        logs.mockRestore();
        await telemetry.shutdown();
      }
    },
  );
  it("counts unsampled queue work after normalizing private error classes before aggregation", async () => {
    const spans = new InMemorySpanExporter();
    const metrics = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    const telemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-api",
      environment: "test",
      release: "test",
      sampleRatio: 0,
      exporters: { spans, metrics },
    });
    try {
      const options = enabledPgBoss(telemetry, ["material-assets.cleanup"]);
      const counter = options.meterProvider
        .getMeter("pg-boss")
        .createCounter("messaging.client.sent.messages");
      for (let index = 0; index < 200; index++) {
        options.tracerProvider.getTracer("pg-boss").startSpan("send").end();
        counter.add(1, {
          "messaging.destination.name": "material-assets.cleanup",
          "error.type": `sentinel-error-${index}`,
        });
      }
      await telemetry.flush();
      expect(spans.getFinishedSpans()).toEqual([]);
      const exported = metrics
        .getMetrics()
        .flatMap((batch) =>
          batch.scopeMetrics.flatMap((scope) => scope.metrics),
        )
        .find(
          (metric) =>
            metric.descriptor.name === "messaging.client.sent.messages",
        );
      expect(
        exported?.dataPoints.map((point) => ({
          value: point.value,
          attributes: point.attributes,
        })),
      ).toEqual([
        {
          value: 200,
          attributes: {
            "messaging.system": "pg-boss",
            "messaging.destination.name": "material-assets.cleanup",
            "error.type": "job_error",
          },
        },
      ]);
    } finally {
      await telemetry.shutdown();
    }
  });

  it("preserves job results when the span exporter fails and reports bounded drops", async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const metrics = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    const telemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-material-assets-worker",
      environment: "test",
      release: "test",
      sampleRatio: 1,
      exporters: {
        spans: {
          export: (_spans, callback) => {
            void blocked.then(() =>
              callback({
                code: ExportResultCode.FAILED,
                error: new Error("sentinel-export-error"),
              }),
            );
          },
          shutdown: () => Promise.resolve(),
        },
        metrics,
      },
    });
    try {
      const options = enabledPgBoss(telemetry, ["material-assets.cleanup"]);
      const tracer = options.tracerProvider.getTracer("pg-boss");
      const handler = observeJob(
        "material-assets-worker",
        "material-assets.cleanup",
        () => Promise.resolve("same-result"),
        telemetry,
      );
      for (let index = 0; index < 600; index++) {
        const span = tracer.startSpan("process");
        expect(
          await context.with(trace.setSpan(ROOT_CONTEXT, span), () =>
            handler([{ id: "same-id" }]),
          ),
        ).toBe("same-result");
        span.end();
      }
      release?.();
      await telemetry.flush();
      expect(telemetry.diagnostics().droppedSpans).toBeGreaterThan(0);
      expect(telemetry.diagnostics().failedTraceExports).toBeGreaterThan(0);
      expect(JSON.stringify(metrics.getMetrics())).not.toContain("sentinel-");
    } finally {
      release?.();
      await telemetry.shutdown();
    }
  });

  it("preserves trace-only propagation and fixed failure evidence without private labels", async () => {
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
    try {
      const options = enabledPgBoss(telemetry, ["billing.reconcile"]);
      expect(options.enabled).toBe(true);
      const tracer = options.tracerProvider.getTracer("pg-boss");
      const span = tracer.startSpan("process sentinel-queue", {
        attributes: {
          "messaging.destination.name": "sentinel-queue",
          "db.namespace": "sentinel-database",
          "error.type": "sentinel-constructor",
        },
      });
      span.recordException(new Error("sentinel-error-sql"));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "sentinel-status",
      });
      span.end();
      options.meterProvider
        .getMeter("pg-boss")
        .createCounter("messaging.client.sent.messages")
        .add(1, {
          "messaging.destination.name": "sentinel-queue",
          "error.type": "sentinel-constructor",
          "db.namespace": "sentinel-database",
        });
      await telemetry.flush();
      const finished = spans.getFinishedSpans();
      expect(finished).toHaveLength(1);
      expect(finished[0]?.status).toEqual({ code: SpanStatusCode.ERROR });
      expect(finished[0]?.attributes["error.type"]).toBe("job_error");
      expect(
        JSON.stringify({ spans: finished, metrics: metrics.getMetrics() }),
      ).not.toContain("sentinel-");
      const baggage = propagation.createBaggage({
        secret: { value: "sentinel-baggage" },
      });
      const carrier: Record<string, string> = {};
      options.propagator.inject(
        propagation.setBaggage(
          trace.setSpanContext(context.active(), {
            traceId: "1".repeat(32),
            spanId: "2".repeat(16),
            traceFlags: 1,
            traceState: createTraceState("vendor=sentinel-tracestate"),
          }),
          baggage,
        ),
        carrier,
        {
          set: (target: Record<string, string>, key: string, value: string) => {
            target[key] = value;
          },
        },
      );
      expect(carrier).toEqual({
        traceparent: `00-${"1".repeat(32)}-${"2".repeat(16)}-01`,
      });
      const extracted = options.propagator.extract(
        ROOT_CONTEXT,
        {
          ...carrier,
          baggage: "private=sentinel-baggage",
          tracestate: "vendor=sentinel-tracestate",
        },
        {
          keys: (value: Record<string, string>) => Object.keys(value),
          get: (value: Record<string, string>, key: string) => value[key],
        },
      );
      expect(trace.getSpanContext(extracted)?.traceState).toBeUndefined();
      expect(propagation.getBaggage(extracted)).toBeUndefined();
    } finally {
      await telemetry.shutdown();
    }
  });
});

import { SpanStatusCode } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import { z } from "zod";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  InMemoryMetricExporter,
  AggregationTemporality,
} from "@opentelemetry/sdk-metrics";
import Fastify from "fastify";
import { observeHttpRequests } from "../../src/infrastructure/observability/http-request-log.js";
import { writeLog } from "../../src/infrastructure/observability/log.js";
import { describe, expect, it, vi } from "vitest";

import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";

describe("technical telemetry", () => {
  it("captures only a route template and counts health and failures without sampling", async () => {
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
    for (const status of [200, 500]) {
      const request = telemetry.startHttp({ method: "GET", route: "/health" });
      await request.run(() => Promise.resolve());
      request.finish(status, 12);
    }
    await telemetry.flush();
    expect(spans.getFinishedSpans()).toHaveLength(0);
    const exported = metrics
      .getMetrics()
      .flatMap((batch) => batch.scopeMetrics.flatMap((scope) => scope.metrics));
    const count = exported.find(
      (metric) => metric.descriptor.name === "http.server.request.count",
    );
    expect(count?.dataPoints.map((point) => point.value)).toEqual([1, 1]);
    expect(
      count?.dataPoints.map(
        (point) => point.attributes["http.response.status_code"],
      ),
    ).toEqual([200, 500]);
    await telemetry.shutdown();
  });

  it("isolates concurrent request correlation and excludes private HTTP input and exception text", async () => {
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
    const logs = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const server = Fastify();
    try {
      observeHttpRequests(server, "api", telemetry);
      server.get("/items/:id", async (request) => {
        await Promise.resolve();
        writeLog("info", "handler_result", { requestId: request.id });
        throw new Error("sentinel-private-error");
      });
      const responses = await Promise.all([
        server.inject({
          url: "/items/sentinel-first?token=sentinel-query",
          headers: { authorization: "sentinel-bearer" },
        }),
        server.inject({ url: "/items/sentinel-second" }),
      ]);
      expect(responses.map((response) => response.statusCode)).toEqual([
        500, 500,
      ]);
      await telemetry.flush();
      const finished = spans.getFinishedSpans();
      expect(finished).toHaveLength(2);
      expect(finished.map((span) => span.name)).toEqual([
        "GET /items/:id",
        "GET /items/:id",
      ]);
      expect(
        finished.every((span) => span.status.code === SpanStatusCode.ERROR),
      ).toBe(true);
      const output = JSON.stringify({
        spans: finished.map((span) => ({
          name: span.name,
          attributes: span.attributes,
          events: span.events,
          resource: span.resource.attributes,
        })),
        metrics: metrics.getMetrics(),
        logs: logs.mock.calls,
      });
      expect(output).not.toContain("sentinel-");
      const handlerLogs = logs.mock.calls
        .filter((call) => String(call[0]).includes("handler_result"))
        .map((call) =>
          z
            .object({
              traceId: z.string(),
              spanId: z.string(),
              requestId: z.string(),
            })
            .parse(JSON.parse(String(call[0]))),
        );
      expect(new Set(handlerLogs.map((line) => line.traceId)).size).toBe(2);
      expect(handlerLogs.map((line) => line.traceId).sort()).toEqual(
        finished.map((span) => span.spanContext().traceId).sort(),
      );
      expect(telemetry.correlation()).toEqual({});
    } finally {
      await server.close();
      await telemetry.shutdown();
      logs.mockRestore();
    }
  });

  it("bounds outstanding spans and reports failed exports without retaining error text", async () => {
    const spans = new InMemorySpanExporter();
    const metrics = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    const failures: string[] = [];
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const telemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-api",
      environment: "test",
      release: "test",
      sampleRatio: 1,
      onExportFailure: (signal) => failures.push(signal),
      exporters: {
        spans: {
          export: (batch, callback) => {
            void blocked.then(() => {
              spans.export(batch, () =>
                callback({
                  code: ExportResultCode.FAILED,
                  error: new Error("sentinel-export-error"),
                }),
              );
            });
          },
          shutdown: () => Promise.resolve(),
        },
        metrics,
      },
    });
    try {
      for (let index = 0; index < 600; index++)
        telemetry.startHttp({ method: "GET", route: "/health" }).finish(200, 1);
      expect(telemetry.diagnostics().droppedSpans).toBe(88);
      release?.();
      await telemetry.flush();
      expect(telemetry.diagnostics().failedTraceExports).toBeGreaterThan(0);
      expect(failures.every((signal) => signal === "traces")).toBe(true);
      expect(JSON.stringify(telemetry.diagnostics())).not.toContain(
        "sentinel-",
      );
    } finally {
      release?.();
      await telemetry.shutdown();
    }
  });

  it("marks metric cardinality overflow while keeping all completed request counts", async () => {
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
      for (let route = 0; route < 200; route++)
        telemetry
          .startHttp({ method: "GET", route: `/registered-route-${route}` })
          .finish(200, 1);
      await telemetry.flush();
      const count = metrics
        .getMetrics()
        .flatMap((batch) =>
          batch.scopeMetrics.flatMap((scope) => scope.metrics),
        )
        .find(
          (metric) => metric.descriptor.name === "http.server.request.count",
        );
      expect(
        count?.dataPoints.some(
          (point) => point.attributes["otel.metric.overflow"] === true,
        ),
      ).toBe(true);
      expect(
        count?.dataPoints.reduce((sum, point) => sum + Number(point.value), 0),
      ).toBe(200);
    } finally {
      await telemetry.shutdown();
    }
  });

  it("keeps the disabled path inert and preserves the result", async () => {
    const telemetry = createTechnicalTelemetry({ enabled: false });
    const request = telemetry.startHttp({ method: "GET", route: "/health" });
    expect(await request.run(() => Promise.resolve(42))).toBe(42);
    request.finish(200, 2);
    expect(telemetry.correlation()).toEqual({});
    await telemetry.shutdown();
  });
});

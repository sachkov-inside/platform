import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it, vi } from "vitest";
import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";

function fixture() {
  const waiting: (() => void)[] = [];
  const delivered: string[] = [];
  let shutdowns = 0;
  const exporter: SpanExporter = {
    export: (spans, callback) => {
      waiting.push(() => {
        delivered.push(...spans.map((span) => span.spanContext().spanId));
        callback({ code: ExportResultCode.SUCCESS });
      });
    },
    forceFlush: () => {
      for (const complete of waiting.splice(0)) complete();
      return Promise.resolve();
    },
    shutdown: () => {
      shutdowns++;
      return Promise.resolve();
    },
  };
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "test",
    sampleRatio: 1,
    exporters: {
      spans: exporter,
      metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    },
  });
  const end = (count: number) => {
    for (let i = 0; i < count; i++)
      telemetry.startHttp({ method: "GET", route: "/health" }).finish(200, 1);
  };
  return { telemetry, end, delivered, waiting, shutdowns: () => shutdowns };
}

describe("technical telemetry lifecycle", () => {
  it("waits for the background batch as well as every final batch on shutdown", async () => {
    const f = fixture();
    f.end(130);
    await f.telemetry.shutdown();
    expect(f.delivered).toHaveLength(130);
    expect(new Set(f.delivered).size).toBe(130);
    expect(f.shutdowns()).toBe(1);
    await f.telemetry.shutdown();
    expect(f.shutdowns()).toBe(1);
  });
});

it("coalesces concurrent callers into two generations and covers spans ended before each call", async () => {
  const f = fixture();
  f.end(1);
  const first = f.telemetry.flush();
  f.end(1);
  const next = f.telemetry.flush();
  for (let i = 0; i < 500; i++) expect(f.telemetry.flush()).toBe(next);
  await next;
  await first;
  expect(f.delivered).toHaveLength(2);
  for (let i = 0; i < 20; i++) {
    f.end(1);
    await f.telemetry.flush();
    expect(f.delivered).toHaveLength(i + 3);
  }
  await Promise.all(Array.from({ length: 500 }, () => f.telemetry.flush()));
  await f.telemetry.shutdown();
  expect(f.shutdowns()).toBe(1);
});

it("bounds pending admission to 512, including the background batch", async () => {
  const f = fixture();
  f.end(600);
  expect(f.telemetry.diagnostics().droppedSpans).toBe(88);
  await f.telemetry.flush();
  expect(f.delivered).toHaveLength(512);
  f.end(1);
  await f.telemetry.shutdown();
  expect(f.delivered).toHaveLength(513);
  f.end(1);
  await f.telemetry.flush();
  expect(f.delivered).toHaveLength(513);
});

it.each(["failure", "throw", "duplicate"] as const)(
  "cleans up once after exporter %s and releases the context lease",
  async (mode) => {
    let shutdowns = 0;
    const telemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-api",
      environment: "test",
      release: "test",
      sampleRatio: 1,
      exporters: {
        spans: {
          export: (_spans, callback) => {
            if (mode === "throw") throw new Error("fixed-export-failure");
            const result = {
              code:
                mode === "failure"
                  ? ExportResultCode.FAILED
                  : ExportResultCode.SUCCESS,
            };
            callback(result);
            if (mode === "duplicate") callback(result);
          },
          forceFlush: () =>
            mode === "failure"
              ? Promise.reject(new Error("fixed-flush-failure"))
              : Promise.resolve(),
          shutdown: () => {
            shutdowns++;
            return Promise.resolve();
          },
        },
        metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
      },
    });
    telemetry.startHttp({ method: "GET", route: "/health" }).finish(200, 1);
    await telemetry.flush();
    const closing = telemetry.shutdown();
    expect(telemetry.shutdown()).toBe(closing);
    await closing;
    expect(shutdowns).toBe(1);
    expect(telemetry.diagnostics().failedTraceExports).toBe(
      mode === "duplicate" ? 0 : 1,
    );
    const next = fixture();
    next.end(1);
    await next.telemetry.shutdown();
    expect(next.delivered).toHaveLength(1);
  },
);

it("accounts a late failed callback once after the SDK deadline without reopening terminal admission", async () => {
  vi.useFakeTimers();
  const callbacks: ((result: ExportResult) => void)[] = [];
  let shutdowns = 0;
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "test",
    sampleRatio: 1,
    exporters: {
      spans: {
        export: (_spans, callback) => {
          callbacks.push(callback);
        },
        shutdown: () => {
          shutdowns++;
          return Promise.resolve();
        },
      },
      metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    },
  });
  try {
    telemetry.startHttp({ method: "GET", route: "/health" }).finish(200, 1);
    const flushing = telemetry.flush();
    await vi.advanceTimersByTimeAsync(1000);
    await flushing;
    const late = callbacks.shift();
    expect(late).toBeTypeOf("function");
    late?.({ code: ExportResultCode.FAILED });
    late?.({ code: ExportResultCode.FAILED });
    expect(telemetry.diagnostics().failedTraceExports).toBe(1);
    for (let i = 0; i < 600; i++)
      telemetry.startHttp({ method: "GET", route: "/health" }).finish(200, 1);
    expect(telemetry.diagnostics().droppedSpans).toBe(88);
    const closing = telemetry.shutdown();
    await vi.advanceTimersByTimeAsync(0);
    for (const callback of callbacks.splice(0))
      callback({ code: ExportResultCode.SUCCESS });
    await closing;
    telemetry.startHttp({ method: "GET", route: "/health" }).finish(200, 1);
    await telemetry.flush();
    expect(callbacks).toHaveLength(0);
    expect(shutdowns).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    await telemetry.shutdown();
    vi.useRealTimers();
  }
});

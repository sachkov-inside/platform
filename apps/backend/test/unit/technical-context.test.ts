import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  context,
  trace,
  createContextKey,
  ROOT_CONTEXT,
  propagation,
} from "@opentelemetry/api";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
} from "@opentelemetry/sdk-trace-base";
import {
  InMemoryMetricExporter,
  AggregationTemporality,
} from "@opentelemetry/sdk-metrics";
import { describe, it, expect } from "vitest";
import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";

function exporters() {
  return {
    spans: new InMemorySpanExporter(),
    metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
  };
}

describe("technical OpenTelemetry context", () => {
  it("makes each real HTTP span active across overlapping asynchronous work", async () => {
    const telemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-api",
      environment: "test",
      release: "test",
      sampleRatio: 1,
      exporters: exporters(),
    });
    try {
      const observed = await Promise.all(
        [1, 2].map(async () => {
          const request = telemetry.startHttp({
            method: "GET",
            route: "/items/:id",
          });
          try {
            return await request.run(async () => {
              await Promise.resolve();
              const active = trace.getSpan(context.active())?.spanContext();
              expect(active?.traceId).toBe(telemetry.correlation()["traceId"]);
              expect(active?.spanId).toBe(telemetry.correlation()["spanId"]);
              return active?.traceId;
            });
          } finally {
            request.finish(200, 1);
          }
        }),
      );
      expect(new Set(observed).size).toBe(2);
      expect(trace.getSpan(context.active())).toBeUndefined();
      expect(telemetry.correlation()).toEqual({});
    } finally {
      await telemetry.shutdown();
    }
  });
  it("shares process ownership across enabled runtimes and repeated shutdown without affecting the remaining scope", async () => {
    const first = createTechnicalTelemetry({
      enabled: true,
      service: "platform-api",
      environment: "test",
      release: "test",
      sampleRatio: 1,
      exporters: exporters(),
    });
    const second = createTechnicalTelemetry({
      enabled: true,
      service: "platform-mcp",
      environment: "test",
      release: "test",
      sampleRatio: 1,
      exporters: exporters(),
    });
    try {
      await first.shutdown();
      await first.shutdown();
      const request = second.startHttp({ method: "GET", route: "/mcp" });
      request.run(() =>
        expect(trace.getSpan(context.active())?.spanContext().traceId).toBe(
          second.correlation()["traceId"],
        ),
      );
      request.finish(200, 1);
    } finally {
      await first.shutdown();
      await second.shutdown();
    }
    const again = createTechnicalTelemetry({
      enabled: true,
      service: "platform-api",
      environment: "test",
      release: "test",
      sampleRatio: 1,
      exporters: exporters(),
    });
    try {
      const request = again.startHttp({ method: "GET" });
      request.run(() => expect(trace.getSpan(context.active())).toBeDefined());
      request.finish(200, 1);
    } finally {
      await again.shutdown();
    }
  });

  it("keeps a foreign global context manager intact when enabled registration fails or telemetry is disabled", async () => {
    let foreign: AsyncLocalStorageContextManager | undefined;
    let registered = false;
    let enabled: ReturnType<typeof createTechnicalTelemetry> | undefined;
    let disabled: ReturnType<typeof createTechnicalTelemetry> | undefined;
    try {
      foreign = new AsyncLocalStorageContextManager().enable();
      const key = createContextKey("foreign-owner-test");
      registered = context.setGlobalContextManager(foreign);
      expect(registered).toBe(true);
      let refused = false;
      enabled = createTechnicalTelemetry({
        enabled: true,
        service: "platform-api",
        environment: "test",
        release: "test",
        sampleRatio: 1,
        exporters: exporters(),
        onContextUnavailable: () => {
          refused = true;
        },
      });
      disabled = createTechnicalTelemetry({ enabled: false });
      expect(refused).toBe(true);
      await enabled.shutdown();
      await disabled.shutdown();
      await foreign.with(ROOT_CONTEXT.setValue(key, "preserved"), async () => {
        await Promise.resolve();
        expect(context.active().getValue(key)).toBe("preserved");
      });
    } finally {
      await Promise.allSettled([
        Promise.resolve().then(() => enabled?.shutdown()),
        Promise.resolve().then(() => disabled?.shutdown()),
      ]);
      if (registered) context.disable();
      else foreign?.disable();
    }
  });

  it("makes independent HTTP roots and exports only W3C trace context without baggage", async () => {
    const telemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-api",
      environment: "test",
      release: "test",
      sampleRatio: 1,
      exporters: exporters(),
    });
    try {
      const outer = telemetry.startHttp({ method: "GET", route: "/outer" });
      outer.run(() => {
        const outerId = telemetry.correlation()["traceId"];
        const nested = telemetry.startHttp({
          method: "GET",
          route: "/independent",
        });
        nested.run(() => {
          expect(telemetry.correlation()["traceId"]).not.toBe(outerId);
          const carrier: Record<string, string> = {};
          const withBaggage = propagation.setBaggage(
            context.active(),
            propagation.createBaggage({
              private: { value: "sentinel-private-baggage" },
            }),
          );
          expect(
            propagation.getBaggage(withBaggage)?.getEntry("private")?.value,
          ).toBe("sentinel-private-baggage");
          new W3CTraceContextPropagator().inject(withBaggage, carrier, {
            set: (
              target: Record<string, string>,
              key: string,
              value: string,
            ) => {
              target[key] = value;
            },
          });
          expect(Object.keys(carrier)).toEqual(["traceparent"]);
        });
        nested.finish(200, 1);
      });
      outer.finish(200, 1);
    } finally {
      await telemetry.shutdown();
    }
  });

  it("cleans a failed SDK construction and permits a fresh context lifecycle", async () => {
    const ports = exporters();
    const broken = createTechnicalTelemetry({
      enabled: true,
      service: "platform-api",
      environment: "test",
      release: "test",
      sampleRatio: 1,
      exporters: {
        spans: ports.spans,
        metrics: {
          export: ports.metrics.export.bind(ports.metrics),
          forceFlush: ports.metrics.forceFlush.bind(ports.metrics),
          shutdown: ports.metrics.shutdown.bind(ports.metrics),
          selectAggregationTemporality: () => {
            throw new Error("sentinel-exporter-construction");
          },
        },
      },
    });
    await broken.shutdown();
    const next = createTechnicalTelemetry({
      enabled: true,
      service: "platform-api",
      environment: "test",
      release: "test",
      sampleRatio: 1,
      exporters: exporters(),
    });
    try {
      const request = next.startHttp({ method: "GET" });
      request.run(() => expect(trace.getSpan(context.active())).toBeDefined());
      request.finish(200, 1);
    } finally {
      await next.shutdown();
    }
  });
  it("preserves a replacement foreign manager when the former owner shuts down", async () => {
    const telemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-api",
      environment: "test",
      release: "test",
      sampleRatio: 1,
      exporters: exporters(),
    });
    let foreign: AsyncLocalStorageContextManager | undefined;
    let registered = false;
    try {
      context.disable();
      foreign = new AsyncLocalStorageContextManager().enable();
      const key = createContextKey("replacement-manager-test");
      registered = context.setGlobalContextManager(foreign);
      expect(registered).toBe(true);
      await telemetry.shutdown();
      foreign.with(ROOT_CONTEXT.setValue(key, true), () =>
        expect(context.active().getValue(key)).toBe(true),
      );
    } finally {
      try {
        await telemetry.shutdown();
      } finally {
        if (registered) context.disable();
        else foreign?.disable();
      }
    }
  });

  it("links real library child spans and restores the parent context after an asynchronous error", async () => {
    const telemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-api",
      environment: "test",
      release: "test",
      sampleRatio: 1,
      exporters: exporters(),
    });
    const captured = new InMemorySpanExporter();
    const library = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(captured)],
    });
    try {
      const request = telemetry.startHttp({
        method: "GET",
        route: "/items/:id",
      });
      await request.run(async () => {
        const parent = trace.getSpan(context.active())?.spanContext();
        await expect(
          library
            .getTracer("library-boundary")
            .startActiveSpan("library.operation", async (span) => {
              try {
                await Promise.resolve();
                expect(telemetry.correlation()["spanId"]).toBe(
                  span.spanContext().spanId,
                );
                expect(telemetry.correlation()["traceId"]).toBe(
                  parent?.traceId,
                );
                throw new Error("expected-library-error");
              } finally {
                span.end();
              }
            }),
        ).rejects.toThrow("expected-library-error");
        expect(trace.getSpan(context.active())?.spanContext().spanId).toBe(
          parent?.spanId,
        );
        await library.forceFlush();
        expect(captured.getFinishedSpans()[0]?.parentSpanContext?.spanId).toBe(
          parent?.spanId,
        );
      });
      request.finish(500, 1);
      expect(telemetry.correlation()).toEqual({});
    } finally {
      await library.shutdown();
      await telemetry.shutdown();
    }
  });
});

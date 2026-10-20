import { beforeEach, expect, it, vi } from "vitest";
import { telegramObservabilityFromEnvironment } from "../../src/observability/telegram-telemetry-runtime.js";

const boundary = vi.hoisted(() => ({
  spans: vi.fn(),
  metrics: vi.fn(),
  spanShutdown: vi.fn(() => Promise.resolve()),
}));
vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: class {
    constructor() {
      boundary.spans();
    }
    shutdown() {
      return boundary.spanShutdown();
    }
  },
}));
vi.mock("@opentelemetry/exporter-metrics-otlp-http", () => ({
  OTLPMetricExporter: function () {
    boundary.metrics();
    throw new Error("synthetic optional SDK construction failure");
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

it("invalid optional telemetry config constructs no exporters and preserves business work", async () => {
  for (const environment of [
    {},
    { INSIDE_OTEL_ENABLED: "TRUE", INSIDE_OTEL_ENDPOINT: "http://alloy:4318" },
    { INSIDE_OTEL_ENABLED: "true" },
    { INSIDE_OTEL_ENABLED: "true", INSIDE_OTEL_ENDPOINT: "file:///private" },
    {
      INSIDE_OTEL_ENABLED: "true",
      INSIDE_OTEL_ENDPOINT: "https://user:password@synthetic.invalid",
    },
    {
      INSIDE_OTEL_ENABLED: "true",
      INSIDE_OTEL_ENDPOINT: "http://alloy:4318?private=value",
    },
    {
      INSIDE_OTEL_ENABLED: "true",
      INSIDE_OTEL_ENDPOINT: "http://alloy:4318#private",
    },
    {
      INSIDE_OTEL_ENABLED: "true",
      INSIDE_OTEL_ENDPOINT: "http://alloy:4318",
      INSIDE_OTEL_SAMPLE_RATIO: "2",
    },
    {
      INSIDE_OTEL_ENABLED: "true",
      INSIDE_OTEL_ENDPOINT: "http://alloy:4318",
      OTEL_EXPORTER_OTLP_HEADERS: "synthetic=private",
    },
  ]) {
    const runtime = telegramObservabilityFromEnvironment({
      environment,
      mode: "test",
    });
    let called = 0;
    expect(
      await runtime.runReceipt(
        "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01",
        (carrier) => {
          called++;
          expect(carrier).toBeNull();
          return Promise.resolve("unchanged");
        },
      ),
    ).toBe("unchanged");
    await runtime.runAuthorization(null, (wire) => {
      expect(wire.traceparent()).toBeUndefined();
      return Promise.resolve();
    });
    await runtime.shutdown();
    expect(called).toBe(1);
  }
  expect(boundary.spans).not.toHaveBeenCalled();
  expect(boundary.metrics).not.toHaveBeenCalled();
});

it("optional exporter construction failure cleans already acquired transport once and preserves cleanup failure privately", async () => {
  const original = new Error("synthetic original transport cleanup failure");
  boundary.spanShutdown.mockRejectedValueOnce(original);
  const runtime = telegramObservabilityFromEnvironment({
    mode: "test",
    environment: {
      INSIDE_OTEL_ENABLED: "true",
      INSIDE_OTEL_ENDPOINT: "http://alloy:4318",
    },
  });
  expect(
    await runtime.runReceipt(undefined, (carrier) => {
      expect(carrier).toBeNull();
      return Promise.resolve("unchanged");
    }),
  ).toBe("unchanged");
  const closing = runtime.shutdown();
  expect(runtime.shutdown()).toBe(closing);
  await expect(closing).rejects.toBe(original);
  expect(boundary.spans).toHaveBeenCalledTimes(1);
  expect(boundary.metrics).toHaveBeenCalledTimes(1);
  expect(boundary.spanShutdown).toHaveBeenCalledTimes(1);
});

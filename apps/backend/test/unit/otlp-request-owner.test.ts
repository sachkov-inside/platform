// deterministic-test-allow unit-io: owned native agents/requests, constructor-failure and shutdown cleanup.
import { request } from "node:http";
import { expect, it, vi } from "vitest";
import { createOtlpRequestOwner } from "../../src/infrastructure/observability/otlp-request-owner.js";

it("memoizes concurrent lazy factory calls and refuses new work after idempotent shutdown", async () => {
  const owner = createOtlpRequestOwner();
  const agents = await Promise.all(
    Array.from({ length: 20 }, () => owner.factory("http:")),
  );
  expect(new Set(agents).size).toBe(1);
  const closing = owner.shutdown();
  expect(owner.shutdown()).toBe(closing);
  await closing;
  await expect(owner.factory("http:")).rejects.toThrow(
    "Telemetry transport closed",
  );
});

it("cleans up a request whose native constructor throws before emitting close", async () => {
  const owner = createOtlpRequestOwner();
  const agent = await owner.factory("http:");
  agent.createConnection = () => {
    throw new Error("fixed-test-connect-throw");
  };
  expect(() => request("http://127.0.0.1:1", { agent })).toThrow(
    "fixed-test-connect-throw",
  );
  await owner.shutdown();
});

it("refuses an unsupported protocol without retaining failed initialization", async () => {
  const owner = createOtlpRequestOwner();
  await expect(owner.factory("unsupported:")).rejects.toThrow(
    "Unsupported telemetry protocol",
  );
  await owner.shutdown();
});

it("refuses an unsupported owned Agent hook safely", async () => {
  let destroyed = false;
  vi.doMock("node:https", () => ({
    Agent: class {
      destroy() {
        destroyed = true;
      }
    },
  }));
  const owner = createOtlpRequestOwner();
  try {
    await expect(owner.factory("https:")).rejects.toThrow(
      "Unsupported telemetry agent",
    );
    await owner.shutdown();
    expect(destroyed).toBe(true);
  } finally {
    vi.doUnmock("node:https");
  }
});

it("keeps application startup and shutdown available when agent initialization is unsupported", async () => {
  vi.doMock("node:https", () => ({
    Agent: class {
      destroy() {
        return undefined;
      }
    },
  }));
  const warnings = vi
    .spyOn(console, "warn")
    .mockImplementation(() => undefined);
  for (const key of Object.keys(process.env))
    if (key.startsWith("OTEL_EXPORTER_OTLP")) vi.stubEnv(key, undefined);
  const { technicalTelemetryFromEnvironment } =
    await import("../../src/infrastructure/observability/technical-telemetry-runtime.js");
  const telemetry = technicalTelemetryFromEnvironment({
    environment: {
      INSIDE_OTEL_ENABLED: "true",
      INSIDE_OTEL_ENDPOINT: "https://localhost:1",
    },
    service: "platform-api",
    mode: "test",
    identity: { release: "test", sourceSha: "test" },
  });
  try {
    telemetry.startHttp({ method: "GET", route: "/health" }).finish(200, 1);
    await telemetry.flush();
    await telemetry.shutdown();
    expect(telemetry.diagnostics()).toEqual({
      droppedSpans: 0,
      failedTraceExports: 1,
      failedMetricExports: 2,
    });
  } finally {
    await telemetry.shutdown();
    vi.doUnmock("node:https");
    vi.unstubAllEnvs();
    warnings.mockRestore();
  }
});

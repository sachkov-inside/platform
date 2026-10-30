// deterministic-test-allow unit-io: owned loopback OTLP exporter contract, server closed in finally.
import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { technicalTelemetryFromEnvironment } from "../../src/infrastructure/observability/technical-telemetry-runtime.js";

function isolateAmbientOtlp(): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("OTEL_EXPORTER_OTLP")) vi.stubEnv(key, undefined);
  }
}

describe("OTLP runtime transport", () => {
  it.each([
    "OTEL_EXPORTER_OTLP_HEADERS",
    "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
    "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
    "OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE",
    "OTEL_EXPORTER_OTLP_CLIENT_KEY",
    "OTEL_EXPORTER_OTLP_CERTIFICATE",
    "OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE",
    "OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY",
    "OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE",
    "OTEL_EXPORTER_OTLP_METRICS_CLIENT_CERTIFICATE",
    "OTEL_EXPORTER_OTLP_METRICS_CLIENT_KEY",
    "OTEL_EXPORTER_OTLP_METRICS_CERTIFICATE",
  ])(
    "disables export instead of forwarding ambient %s credentials",
    async (key) => {
      const captured: string[] = [];
      const receiver = createServer((request, response) => {
        captured.push(JSON.stringify(request.headers));
        request.resume();
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
      const warnings = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      let telemetry:
        ReturnType<typeof technicalTelemetryFromEnvironment> | undefined;
      isolateAmbientOtlp();
      vi.stubEnv(
        key,
        "Authorization=Bearer%20sentinel-foreign-key,x-person=sentinel-person",
      );
      try {
        receiver.listen(0, "127.0.0.1");
        await once(receiver, "listening");
        const address = receiver.address();
        if (address === null || typeof address === "string")
          throw new Error("listener address unavailable");
        telemetry = technicalTelemetryFromEnvironment({
          environment: {
            INSIDE_OTEL_ENABLED: "true",
            INSIDE_OTEL_ENDPOINT: `http://127.0.0.1:${address.port}`,
          },
          service: "platform-api",
          mode: "test",
          identity: { release: "test", sourceSha: "test" },
        });
        telemetry.startHttp({ method: "GET", route: "/health" }).finish(200, 1);
        await telemetry.flush();
        await telemetry.shutdown();
        expect(captured).toEqual([]);
        expect(
          warnings.mock.calls.map((call) => String(call[0])).join(""),
        ).toContain("telemetry_ambient_configuration_unsupported");
        expect(JSON.stringify(warnings.mock.calls)).not.toContain("sentinel-");
      } finally {
        await telemetry?.shutdown();
        await new Promise<void>((resolve, reject) =>
          receiver.close((error) =>
            error === undefined ? resolve() : reject(error),
          ),
        );
        vi.unstubAllEnvs();
        warnings.mockRestore();
      }
    },
  );

  it("exports real SDK traces and metrics to the configured receiver without private input", async () => {
    const captured: { path: string; body: string }[] = [];
    const receiver = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => {
        captured.push({ path: request.url ?? "", body });
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    isolateAmbientOtlp();
    receiver.listen(0, "127.0.0.1");
    let telemetry:
      ReturnType<typeof technicalTelemetryFromEnvironment> | undefined;
    try {
      await once(receiver, "listening");
      const address = receiver.address();
      if (address === null || typeof address === "string")
        throw new Error("listener address unavailable");
      telemetry = technicalTelemetryFromEnvironment({
        environment: {
          INSIDE_OTEL_ENABLED: "true",
          INSIDE_OTEL_ENDPOINT: `http://127.0.0.1:${address.port}`,
        },
        service: "platform-api",
        mode: "test",
        identity: { release: "test", sourceSha: "test" },
      });
      const request = telemetry.startHttp({
        method: "POST",
        route: "/items/:id",
      });
      request.run(() => undefined);
      request.finish(503, 12);
      await telemetry.flush();
      expect(captured.map((item) => item.path).sort()).toEqual([
        "/v1/metrics",
        "/v1/traces",
      ]);
      const wire = captured.map((item) => item.body).join("\n");
      expect(wire).toContain("platform-api");
      expect(wire).toContain("POST /items/:id");
      expect(wire).toContain("http.server.request.count");
      expect(wire).not.toContain("exception.message");
      expect(telemetry.diagnostics()).toEqual({
        droppedSpans: 0,
        failedTraceExports: 0,
        failedMetricExports: 0,
      });
    } finally {
      await telemetry?.shutdown();
      await new Promise<void>((resolve, reject) =>
        receiver.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
      vi.unstubAllEnvs();
    }
  });
});

it.each(["success", "stream"] as const)(
  "bounds and owns actual native %s requests through shutdown",
  async (mode) => {
    const bodies: string[] = [];
    const intervals = new Set<ReturnType<typeof setInterval>>();
    const socketCloses: Promise<void>[] = [];
    const receiver = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => {
        if (request.url === "/v1/traces") bodies.push(body);
        response.writeHead(200, { "content-type": "application/json" });
        if (mode === "stream" && request.url === "/v1/traces") {
          response.write("{");
          const interval = setInterval(() => response.write(" "), 50);
          intervals.add(interval);
          response.once("close", () => {
            clearInterval(interval);
            intervals.delete(interval);
          });
        } else response.end("{}");
      });
    });
    receiver.on("connection", (socket) =>
      socketCloses.push(
        new Promise<void>((resolve) => socket.once("close", resolve)),
      ),
    );
    // deterministic-test-allow duration-wait: resource watchdog closes the real receiver after a deadline regression and fails the assertion; no polling/sleep.
    const watchdog = setTimeout(() => receiver.closeAllConnections(), 2500);
    let telemetry:
      ReturnType<typeof technicalTelemetryFromEnvironment> | undefined;
    isolateAmbientOtlp();
    try {
      receiver.listen(0, "127.0.0.1");
      await once(receiver, "listening");
      const address = receiver.address();
      if (address === null || typeof address === "string")
        throw new Error("listener unavailable");
      telemetry = technicalTelemetryFromEnvironment({
        environment: {
          INSIDE_OTEL_ENABLED: "true",
          INSIDE_OTEL_ENDPOINT: `http://127.0.0.1:${address.port}`,
        },
        service: "platform-api",
        mode: "test",
        identity: { release: "test", sourceSha: "test" },
      });
      const count = mode === "stream" ? 64 : 130;
      const began = performance.now();
      for (let i = 0; i < count; i++)
        telemetry.startHttp({ method: "GET", route: "/health" }).finish(200, 1);
      await telemetry.shutdown();
      const elapsed = performance.now() - began;
      expect(elapsed).toBeLessThan(2000);
      if (mode === "stream") expect(elapsed).toBeGreaterThanOrEqual(990);
      await Promise.all(socketCloses);
      expect(intervals.size).toBe(0);
      expect(
        new Set(bodies.join("").match(/"spanId":"[a-f0-9]+"/gu)).size,
      ).toBe(count);
      expect(telemetry.diagnostics()).toEqual({
        droppedSpans: 0,
        failedTraceExports: mode === "stream" ? 1 : 0,
        failedMetricExports: 0,
      });
    } finally {
      clearTimeout(watchdog);
      for (const interval of intervals) clearInterval(interval);
      await telemetry?.shutdown();
      receiver.closeAllConnections();
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
      vi.unstubAllEnvs();
    }
  },
);

it("retains the ninth callback-before-queue-pop slot without losing newly admitted spans", async () => {
  const held: ServerResponse[] = [];
  const ids = new Set<string>();
  const failures: string[] = [];
  let replenished = false;
  const receiver = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      if (request.url !== "/v1/traces") {
        response.writeHead(200).end("{}");
        return;
      }
      for (const match of body.matchAll(/"spanId":"([a-f0-9]+)"/gu))
        if (match[1] !== undefined) ids.add(match[1]);
      held.push(response);
      if (held.length === 8) held[0]?.writeHead(400).end("fixed-rejection");
      if (held.length === 9)
        for (const pending of held.slice(1)) pending.writeHead(200).end("{}");
    });
  });
  let telemetry:
    ReturnType<typeof technicalTelemetryFromEnvironment> | undefined;
  isolateAmbientOtlp();
  try {
    receiver.listen(0, "127.0.0.1");
    await once(receiver, "listening");
    const address = receiver.address();
    if (address === null || typeof address === "string")
      throw new Error("listener unavailable");
    telemetry = technicalTelemetryFromEnvironment({
      environment: {
        INSIDE_OTEL_ENABLED: "true",
        INSIDE_OTEL_ENDPOINT: `http://127.0.0.1:${address.port}`,
      },
      service: "platform-api",
      mode: "test",
      identity: { release: "test", sourceSha: "test" },
      onExportFailureObservation: (signal, failure) => {
        if (signal !== "traces") return;
        failures.push(failure.kind);
        // Refill admission inside the real callback, before the SDK promise
        // queue removes its completed background slot.
        if (!replenished) {
          replenished = true;
          for (let i = 0; i < 64; i++)
            telemetry
              ?.startHttp({ method: "GET", route: "/health" })
              .finish(200, 1);
        }
      },
    });
    for (let i = 0; i < 512; i++)
      telemetry.startHttp({ method: "GET", route: "/health" }).finish(200, 1);
    await telemetry.flush();
    await telemetry.shutdown();
    expect(held).toHaveLength(9);
    expect(ids.size).toBe(576);
    expect(failures).toEqual(["http"]);
    expect(telemetry.diagnostics()).toEqual({
      droppedSpans: 0,
      failedTraceExports: 1,
      failedMetricExports: 0,
    });
  } finally {
    await telemetry?.shutdown();
    receiver.closeAllConnections();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
    vi.unstubAllEnvs();
  }
});

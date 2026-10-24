// deterministic-test-allow unit-io: owned loopback OTLP exporter contract, server closed in finally.
import { createServer } from "node:http";
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

// deterministic-test-allow unit-io: owned loopback OTLP exporter contract, server closed in finally.
import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";

import { technicalTelemetryFromEnvironment } from "../../src/infrastructure/observability/technical-telemetry-runtime.js";

describe("OTLP runtime transport", () => {
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
    }
  });
});

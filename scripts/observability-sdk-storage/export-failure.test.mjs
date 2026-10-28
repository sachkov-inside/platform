// @ts-check
// deterministic-test-allow unit-io: real production SDK exports to one owned loopback receiver; bounded requests and cleanup in finally.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { technicalTelemetryFromEnvironment } from "../../apps/backend/dist/infrastructure/observability/technical-telemetry-runtime.js";

for (const mode of ["http400", "reset", "delayed", "positive200"]) {
  test(
    `real SDK ${mode} preserves counters and exposes only closed callback failures`,
    { timeout: 30_000 },
    async () => {
      /** @type {{signal:string,failure:import('../../apps/backend/src/infrastructure/observability/technical-telemetry.js').ExportFailureObservation}[]} */
      const failures = [];
      const signals = new Set();
      /** @type {Set<ReturnType<typeof setTimeout>>} */
      const timers = new Set();
      let requests = 0;
      const receiver = createServer((request, response) => {
        signals.add(
          request.url === "/v1/traces"
            ? "traces"
            : request.url === "/v1/metrics"
              ? "metrics"
              : "unsupported",
        );
        if (++requests > 16) {
          request.destroy();
          return;
        }
        let bytes = 0;
        request.on("data", (/** @type {Buffer} */ chunk) => {
          if ((bytes += chunk.length) > 262144) request.destroy();
        });
        request.on("end", () => {
          if (mode === "reset") {
            request.socket.destroy();
            return;
          }
          const finish = () =>
            response
              .writeHead(mode === "http400" ? 400 : 200, {
                "content-type": "application/json",
              })
              .end("{}");
          if (mode === "delayed") {
            const timer = setTimeout(() => {
              timers.delete(timer);
              finish();
            }, 1500);
            timers.add(timer);
          } else finish();
        });
      });
      /** @type {ReturnType<typeof technicalTelemetryFromEnvironment>|undefined} */
      let sdk;
      try {
        receiver.listen(0, "127.0.0.1");
        await once(receiver, "listening");
        const address = receiver.address();
        assert.ok(address !== null && typeof address !== "string");
        sdk = technicalTelemetryFromEnvironment({
          environment: {
            INSIDE_OTEL_ENABLED: "true",
            INSIDE_OTEL_ENDPOINT: `http://127.0.0.1:${address.port}`,
            INSIDE_OTEL_SAMPLE_RATIO: "1",
          },
          service: "platform-api",
          mode: "test",
          identity: { release: "test", sourceSha: "test" },
          onExportFailureObservation: (signal, failure) =>
            failures.push({ signal, failure }),
        });
        sdk.startHttp({ method: "GET", route: "/health" }).finish(200, 1);
        await sdk.flush();
        assert.deepEqual(sdk.diagnostics(), {
          droppedSpans: 0,
          failedTraceExports: mode === "positive200" ? 0 : 1,
          failedMetricExports: mode === "positive200" ? 0 : 1,
        });
        assert.ok(
          signals.has("traces") &&
            signals.has("metrics") &&
            !signals.has("unsupported"),
        );
        if (mode === "positive200") assert.deepEqual(failures, []);
        else
          for (const signal of ["traces", "metrics"]) {
            const row = failures.find(
              (item) => item.signal === signal,
            )?.failure;
            assert.ok(
              row,
              "real failed exporter callback must reach the optional observer",
            );
            assert.equal(
              row.kind,
              mode === "http400"
                ? "http"
                : mode === "reset"
                  ? "network"
                  : "timeout",
            );
            if (row.kind === "http") assert.equal(row.code, 400);
            if (row.kind === "network") assert.equal(row.code, "ECONNRESET");
            assert.ok(
              row.elapsedMs !== null &&
                Number.isInteger(row.elapsedMs) &&
                row.elapsedMs >= 0 &&
                row.elapsedMs <= 600000,
            );
            assert.deepEqual(
              Object.keys(row).sort(),
              (row.kind === "http" || row.kind === "network"
                ? ["kind", "code", "elapsedMs"]
                : ["kind", "elapsedMs"]
              ).sort(),
            );
          }
      } finally {
        await sdk?.shutdown();
        for (const timer of timers) clearTimeout(timer);
        receiver.closeAllConnections();
        if (receiver.listening)
          await new Promise((resolve, reject) =>
            receiver.close((error) =>
              error ? reject(error) : resolve(undefined),
            ),
          );
        assert.equal(receiver.listening, false);
      }
    },
  );
}

// @ts-check
// deterministic-test-allow unit-io: real production SDK exports to one owned loopback receiver; bounded requests and cleanup in finally.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { channel } from "node:diagnostics_channel";
import { observeSdkTransport } from "./transport.mjs";
/** @typedef {typeof import("../../apps/backend/src/infrastructure/observability/technical-telemetry-runtime.js")} RuntimeApi */
/** @param {unknown} value @returns {value is RuntimeApi} */
function isRuntimeApi(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Object.getOwnPropertyDescriptor(
      value,
      "technicalTelemetryFromEnvironment",
    )?.value === "function"
  );
}
// Types come from tracked source even before build. Execution still uses the actual compiled SDK.
const runtimeUrl = new URL(
  "../../apps/backend/dist/infrastructure/observability/technical-telemetry-runtime.js",
  import.meta.url,
).href;
/** @type {unknown} */
const runtimeModule = await import(runtimeUrl);
assert.ok(isRuntimeApi(runtimeModule), "compiled SDK API unavailable");
const { technicalTelemetryFromEnvironment } = runtimeModule;

for (const mode of ["http400", "reset", "delayed", "positive200"]) {
  test(
    `real SDK ${mode} preserves counters and exposes only closed callback failures`,
    { timeout: 30_000 },
    async () => {
      /** @type {{signal:string,failure:import('../../apps/backend/src/infrastructure/observability/technical-telemetry.js').ExportFailureObservation}[]} */
      const failures = [];
      const channels = [
        "http.client.request.created",
        "http.client.request.start",
        "http.client.response.finish",
      ];
      const subscribed = channels.map((name) => channel(name).hasSubscribers);
      const signals = new Set();
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
            // Hold the response until the real exporter's timeout settles flush().
            // finally closes the connection even if setup or flush fails.
            return;
          } else finish();
        });
      });
      /** @type {ReturnType<typeof technicalTelemetryFromEnvironment>|undefined} */
      let sdk;
      /** @type {ReturnType<typeof observeSdkTransport>|undefined} */
      let transport;
      try {
        receiver.listen(0, "127.0.0.1");
        await once(receiver, "listening");
        const address = receiver.address();
        assert.ok(address !== null && typeof address !== "string");
        transport = observeSdkTransport(`http://127.0.0.1:${address.port}`);
        sdk = technicalTelemetryFromEnvironment({
          environment: {
            INSIDE_OTEL_ENABLED: "true",
            INSIDE_OTEL_ENDPOINT: `http://127.0.0.1:${address.port}`,
            INSIDE_OTEL_SAMPLE_RATIO: "1",
          },
          service: "platform-api",
          mode: "test",
          identity: { release: "test", sourceSha: "test" },
          onExportFailureObservation: (signal, failure) => {
            transport?.exportFailure(signal);
            failures.push({ signal, failure });
          },
        });
        sdk.startHttp({ method: "GET", route: "/health" }).finish(200, 1);
        transport.enterFlush();
        await sdk.flush();
        const milestones = transport.snapshot();
        assert.ok(milestones.available);
        assert.ok(milestones.sdkFlushMs !== null);
        for (const row of [milestones.metrics, milestones.traces]) {
          assert.ok(row !== null);
          assert.ok(
            row.createdMs !== null &&
              row.submittedMs !== null &&
              row.bodyFinishedMs !== null,
          );
          assert.ok(
            row.createdMs <= row.submittedMs &&
              row.submittedMs <= row.bodyFinishedMs,
          );
          if (mode === "positive200") {
            assert.ok(row.headersMs !== null && row.endMs !== null);
            assert.ok(
              row.bodyFinishedMs <= row.headersMs && row.headersMs <= row.endMs,
            );
            assert.equal(row.failureMs, null);
          } else {
            assert.ok(row.failureMs !== null);
            if (mode === "delayed") {
              assert.equal(row.headersMs, null);
              assert.equal(row.endMs, null);
            }
          }
        }
        // Reset may trigger the pinned transport's existing retry behavior.
        // The owned direct HTTP test below isolates the observer's request count.
        if (mode === "reset") assert.ok(requests >= 2 && requests <= 16);
        else
          assert.equal(requests, 2, "observer must not issue a probe or retry");
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
        try {
          await sdk?.shutdown();
        } finally {
          transport?.close();
          assert.deepEqual(
            channels.map((name) => channel(name).hasSubscribers),
            subscribed,
          );
          receiver.closeAllConnections();
          if (receiver.listening)
            await new Promise((resolve, reject) =>
              receiver.close((error) =>
                error ? reject(error) : resolve(undefined),
              ),
            );
          assert.equal(receiver.listening, false);
        }
      }
    },
  );
}

// deterministic-test-allow unit-io: passive observer around owned loopback HTTP, bounded requests, listeners/subscriptions closed in finally.
test(
  "transport milestones isolate peer/path/signal and close without consuming response bytes",
  { timeout: 10000 },
  async (owner) => {
    const { request } = await import("node:http");
    const names = [
      "http.client.request.created",
      "http.client.request.start",
      "http.client.response.finish",
    ];
    const baseline = names.map((name) => channel(name).hasSubscribers);
    let count = 0;
    const receiver = createServer((incoming, response) => {
      count++;
      incoming.resume();
      incoming.on("end", () => {
        if (incoming.url === "/held-body") response.write("held-response");
        else response.end("owned-response");
      });
    });
    const other = createServer((incoming, response) => {
      incoming.resume();
      incoming.on("end", () => response.end("other-response"));
    });
    /** @type {ReturnType<typeof observeSdkTransport>|undefined} */ let observer;
    const cleanupAbort = new AbortController();
    /** @type {Promise<void>|undefined} */ let cleanupTask;
    const cleanup = () =>
      (cleanupTask ??= (async () => {
        cleanupAbort.abort();
        observer?.close();
        for (const server of [receiver, other]) {
          server.closeAllConnections();
          if (server.listening)
            await new Promise((resolve, reject) =>
              server.close((error) =>
                error ? reject(error) : resolve(undefined),
              ),
            );
          assert.equal(server.listening, false);
        }
      })());
    owner.after(cleanup);
    const requestBudgetMs = 3000;
    /** @param {string} url @param {string} method @param {string} [host] @returns {Promise<string>} */
    const send = async (url, method, host) =>
      new Promise((resolve, reject) => {
        const outgoing = request(
          url,
          {
            method,
            signal: AbortSignal.any([
              owner.signal,
              cleanupAbort.signal,
              AbortSignal.timeout(requestBudgetMs),
            ]),
            headers: {
              authorization: "private-sentinel",
              ...(host === undefined ? {} : { host }),
            },
          },
          (response) => {
            let body = "";
            response.on("data", (chunk) => {
              body += String(chunk);
              if (body.length > 64) outgoing.destroy();
            });
            response.on("end", () => resolve(body));
            response.on("error", reject);
          },
        );
        outgoing.on("error", reject);
        outgoing.end("{}");
      });
    try {
      receiver.listen(0, "127.0.0.1");
      other.listen(0, "127.0.0.1");
      await Promise.all([
        once(receiver, "listening"),
        once(other, "listening"),
      ]);
      const address = receiver.address(),
        otherAddress = other.address();
      assert.ok(
        address !== null &&
          typeof address !== "string" &&
          otherAddress !== null &&
          typeof otherAddress !== "string",
      );
      const endpoint = `http://127.0.0.1:${address.port}`;
      observer = observeSdkTransport(endpoint);
      for (const message of [
        null,
        {},
        new Proxy(
          {},
          {
            get() {
              throw Error("private-sentinel");
            },
          },
        ),
        Object.defineProperty({}, "request", {
          get() {
            throw Error("private-sentinel");
          },
        }),
      ])
        for (const name of names)
          assert.doesNotThrow(() => channel(name).publish(message));
      await send(`http://127.0.0.1:${otherAddress.port}/v1/metrics`, "POST");
      await send(`${endpoint}/v1/metrics?private-sentinel`, "POST");
      await send(`${endpoint}/v1/metrics`, "GET");
      let value = observer.snapshot();
      assert.ok(value.available);
      assert.equal(value.metrics.createdMs, null);
      assert.equal(value.traces.createdMs, null);
      await send(
        `http://127.0.0.1:${otherAddress.port}/v1/traces`,
        "POST",
        `127.0.0.1:${address.port}`,
      );
      value = observer.snapshot();
      assert.ok(value.available);
      assert.equal(
        value.traces.createdMs,
        null,
        "spoofed Host cannot admit another peer port",
      );
      observer.enterFlush();
      assert.equal(
        await send(`${endpoint}/v1/metrics`, "POST"),
        "owned-response",
      );
      value = observer.snapshot();
      assert.ok(value.available);
      assert.ok(value.metrics.endMs !== null);
      assert.equal(value.traces.createdMs, null);
      const first = value.metrics;
      await send(`${endpoint}/v1/metrics`, "POST");
      value = observer.snapshot();
      assert.ok(value.available);
      assert.deepEqual(value.metrics, first);
      assert.equal(count, 4);
      assert.ok(!JSON.stringify(value).includes("private-sentinel"));
      observer.close();
      const final = observer.snapshot();
      assert.deepEqual(
        names.map((name) => channel(name).hasSubscribers),
        baseline,
      );
      await send(`${endpoint}/v1/traces`, "POST");
      assert.deepEqual(observer.snapshot(), final);
      observer.close();
      assert.deepEqual(
        names.map((name) => channel(name).hasSubscribers),
        baseline,
      );
      await assert.rejects(send(`${endpoint}/held-body`, "POST"), {
        name: "AbortError",
      });
    } finally {
      await cleanup();
    }
  },
);

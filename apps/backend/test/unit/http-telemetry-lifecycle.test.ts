// deterministic-test-allow unit-io: owned Fastify/socket lifecycle contract; socket and server close in finally.
import { request as httpRequest } from "node:http";
// deterministic-test-allow unit-io: partial-body and timeout socket contract; clients destroyed in finally.
import { connect, type Socket } from "node:net";
import { once } from "node:events";
import Fastify from "fastify";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  InMemoryMetricExporter,
  AggregationTemporality,
} from "@opentelemetry/sdk-metrics";
import { describe, it, expect } from "vitest";

import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";
import { observeHttpRequests } from "../../src/infrastructure/observability/http-request-log.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("HTTP telemetry terminal lifecycle", () => {
  it("keeps a fully read POST active until its real response completes", async () => {
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
    const server = Fastify();
    const release = deferred<undefined>();
    let client: ReturnType<typeof httpRequest> | undefined;
    try {
      observeHttpRequests(server, "api", telemetry);
      const entered = deferred<boolean>();
      server.post("/items/:id", async (request) => {
        entered.resolve(request.raw.complete);
        await release.promise;
        return { ok: true };
      });
      await server.listen({ port: 0, host: "127.0.0.1" });
      const address = server.server.address();
      if (address === null || typeof address === "string")
        throw new Error("listener address unavailable");
      const completed = deferred<number | undefined>();
      client = httpRequest(
        {
          host: "127.0.0.1",
          port: address.port,
          path: "/items/sentinel-secret",
          method: "POST",
          headers: { "content-type": "application/json", "content-length": 2 },
        },
        (response) => {
          response.resume();
          response.once("end", () => completed.resolve(response.statusCode));
        },
      );
      client.once("error", completed.reject);
      client.end("{}");
      expect(await entered.promise).toBe(true);
      await telemetry.flush();
      expect(spans.getFinishedSpans()).toHaveLength(0);
      const active = metrics
        .getMetrics()
        .flatMap((batch) =>
          batch.scopeMetrics.flatMap((scope) => scope.metrics),
        )
        .find(
          (metric) => metric.descriptor.name === "http.server.active_requests",
        );
      expect(active?.dataPoints[0]?.value).toBe(1);
      metrics.reset();
      release.resolve(undefined);
      expect(await completed.promise).toBe(200);
      await telemetry.flush();
      expect(spans.getFinishedSpans()).toHaveLength(1);
      expect(spans.getFinishedSpans()[0]?.attributes).toMatchObject({
        "http.response.status_code": 200,
        "http.request.outcome": "completed",
      });
      const activeAfter = metrics
        .getMetrics()
        .flatMap((batch) =>
          batch.scopeMetrics.flatMap((scope) => scope.metrics),
        )
        .find(
          (metric) => metric.descriptor.name === "http.server.active_requests",
        );
      expect(activeAfter?.dataPoints[0]?.value).toBe(0);
    } finally {
      release.resolve(undefined);
      client?.destroy();
      await server.close();
      await telemetry.shutdown();
    }
  });

  it.each(["aborted", "timeout"] as const)(
    "counts a partial request ending with %s once without inventing a response status",
    async (outcome) => {
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
      // Real transport timeout triggers the lifecycle; the test awaits the terminal hook, never a pause.
      const CONNECTION_TIMEOUT_MS = 50;
      const server = Fastify();
      let client: ReturnType<typeof connect> | undefined;
      try {
        observeHttpRequests(server, "api", telemetry);
        const entered = deferred<Socket>();
        const aborted = deferred<undefined>();
        const timedOut = deferred<undefined>();
        server.addHook("onRequest", (request, _reply, done) => {
          entered.resolve(request.raw.socket);
          done();
        });
        server.addHook("onRequestAbort", (_request, done) => {
          aborted.resolve(undefined);
          done();
        });
        server.addHook("onTimeout", (_request, _reply, done) => {
          timedOut.resolve(undefined);
          done();
        });
        server.post("/items/:id", () => ({ ok: true }));
        await server.listen({ port: 0, host: "127.0.0.1" });
        const address = server.server.address();
        if (address === null || typeof address === "string")
          throw new Error("listener address unavailable");
        client = connect(address.port, "127.0.0.1");
        await once(client, "connect");
        client.write(
          "POST /items/sentinel-secret HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{",
        );
        const incomingSocket = await entered.promise;
        await telemetry.flush();
        const active = metrics
          .getMetrics()
          .flatMap((batch) =>
            batch.scopeMetrics.flatMap((scope) => scope.metrics),
          )
          .find(
            (metric) =>
              metric.descriptor.name === "http.server.active_requests",
          );
        expect(active?.dataPoints[0]?.value).toBe(1);
        metrics.reset();
        const clientClosed = once(client, "close");
        if (outcome === "aborted") client.destroy();
        else {
          incomingSocket.setTimeout(CONNECTION_TIMEOUT_MS);
          await timedOut.promise;
        }
        await clientClosed;
        await aborted.promise;
        await telemetry.flush();
        const finished = spans.getFinishedSpans();
        expect(finished).toHaveLength(1);
        expect(finished[0]?.attributes).toMatchObject({
          "http.route": "/items/:id",
          "http.request.outcome": outcome,
          "error.type": outcome,
        });
        expect(finished[0]?.attributes).not.toHaveProperty(
          "http.response.status_code",
        );
        const exported = metrics
          .getMetrics()
          .flatMap((batch) =>
            batch.scopeMetrics.flatMap((scope) => scope.metrics),
          );
        const counts = exported.find(
          (metric) => metric.descriptor.name === "http.server.request.count",
        );
        expect(counts?.dataPoints.map((point) => point.value)).toEqual([1]);
        expect(counts?.dataPoints[0]?.attributes).not.toHaveProperty(
          "http.response.status_code",
        );
        const activeAfter = exported.find(
          (metric) => metric.descriptor.name === "http.server.active_requests",
        );
        expect(activeAfter?.dataPoints[0]?.value).toBe(0);
        const duration = exported.find(
          (metric) => metric.descriptor.name === "http.server.request.duration",
        );
        expect(
          duration?.dataPoints[0]?.attributes["http.request.outcome"],
        ).toBe(outcome);
        expect(JSON.stringify(exported)).not.toContain("sentinel-secret");
      } finally {
        client?.destroy();
        await server.close();
        await telemetry.shutdown();
      }
    },
  );
});

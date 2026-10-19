import { z } from "zod";
import { writeLog } from "../../src/infrastructure/observability/log.js";
// deterministic-test-allow unit-io: owned Node HTTP lifecycle contract; server closed in finally.
import { createServer } from "node:http";
// deterministic-test-allow unit-io: owned partial/full body sockets; each socket destroyed in finally.
import { connect, type Socket } from "node:net";
import { once } from "node:events";
import { context, trace } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  InMemoryMetricExporter,
  AggregationTemporality,
} from "@opentelemetry/sdk-metrics";
import { describe, it, expect, vi } from "vitest";
import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";
import { observeNodeHttpRequest } from "../../src/infrastructure/observability/node-http-telemetry.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const SOCKET_INACTIVITY_TIMEOUT_MS = 50;

describe("Node HTTP telemetry lifecycle", () => {
  it.each(["completed", "aborted", "timeout"] as const)(
    "ends a real request with %s once and releases its socket observation",
    async (outcome) => {
      const spans = new InMemorySpanExporter();
      const metrics = new InMemoryMetricExporter(
        AggregationTemporality.CUMULATIVE,
      );
      const telemetry = createTechnicalTelemetry({
        enabled: true,
        service: "platform-mcp",
        environment: "test",
        release: "test",
        sampleRatio: 1,
        exporters: { spans, metrics },
      });
      const entered = deferred<{ socket: Socket; timeoutListeners: number }>();
      const bodyRead = deferred<{
        traceId: string | undefined;
        correlation: Readonly<Record<string, string | boolean>>;
      }>();
      const logs = vi
        .spyOn(console, "info")
        .mockImplementation(() => undefined);
      const terminal = deferred<undefined>();
      const release = deferred<undefined>();
      const server = createServer((request, response) => {
        const timeoutListeners = request.socket.listenerCount("timeout");
        const observation = observeNodeHttpRequest(
          request,
          response,
          telemetry,
          {
            process: "mcp",
            requestId: "owned-node-request",
            route: "/items/:id",
          },
        );
        observation.run(() => {
          request.resume();
          request.once("end", () => {
            writeLog("info", "node_body_read");
            bodyRead.resolve({
              traceId: trace.getSpan(context.active())?.spanContext().traceId,
              correlation: telemetry.correlation(),
            });
            void release.promise.then(() => response.end("ok"));
          });
          response.once("finish", () => terminal.resolve(undefined));
          response.once("close", () => terminal.resolve(undefined));
          entered.resolve({ socket: request.socket, timeoutListeners });
        });
      });
      let client: Socket | undefined;
      try {
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        if (address === null || typeof address === "string")
          throw new Error("listener address unavailable");
        client = connect(address.port, "127.0.0.1");
        await once(client, "connect");
        client.resume();
        client.write(
          `POST /items/sentinel-private HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: ${outcome === "completed" ? 2 : 100}\r\n\r\n${outcome === "completed" ? "{}" : "{"}`,
        );
        const observed = await entered.promise;
        await telemetry.flush();
        metrics.reset();
        if (outcome === "completed") {
          const body = await bodyRead.promise;
          expect(body.traceId).toBeDefined();
          expect(body.correlation["traceId"]).toBe(body.traceId);
          expect(
            z
              .object({
                requestId: z.literal("owned-node-request"),
                traceId: z.string(),
              })
              .parse(JSON.parse(String(logs.mock.calls[0]?.[0]))).traceId,
          ).toBe(body.traceId);
          release.resolve(undefined);
        } else if (outcome === "aborted") client.destroy();
        else {
          // deterministic-test-allow duration-wait: arm real owned socket inactivity only after entry; await response close.
          observed.socket.setTimeout(SOCKET_INACTIVITY_TIMEOUT_MS);
        }
        await terminal.promise;
        await telemetry.flush();
        const finished = spans.getFinishedSpans();
        expect(finished).toHaveLength(1);
        expect(finished[0]?.attributes["http.request.outcome"]).toBe(outcome);
        if (outcome === "completed")
          expect(finished[0]?.attributes["http.response.status_code"]).toBe(
            200,
          );
        else
          expect(finished[0]?.attributes).not.toHaveProperty(
            "http.response.status_code",
          );
        expect(observed.socket.listenerCount("timeout")).toBeLessThanOrEqual(
          observed.timeoutListeners,
        );
        const exported = metrics
          .getMetrics()
          .flatMap((batch) =>
            batch.scopeMetrics.flatMap((scope) => scope.metrics),
          );
        expect(
          exported
            .find(
              (metric) =>
                metric.descriptor.name === "http.server.request.count",
            )
            ?.dataPoints.map((point) => point.value),
        ).toEqual([1]);
        expect(
          exported.find(
            (metric) =>
              metric.descriptor.name === "http.server.active_requests",
          )?.dataPoints[0]?.value,
        ).toBe(0);
        expect(JSON.stringify(exported)).not.toContain("sentinel-");
      } finally {
        release.resolve(undefined);
        client?.destroy();
        await new Promise<void>((resolve, reject) =>
          server.close((error) =>
            error === undefined ? resolve() : reject(error),
          ),
        );
        await telemetry.shutdown();
        logs.mockRestore();
      }
    },
  );
});

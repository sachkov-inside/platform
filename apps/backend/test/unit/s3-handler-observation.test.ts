import { expect, test, vi } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";
import { SpanKind } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";
import { observeS3RequestHandler } from "../../src/infrastructure/object-storage/s3-request-observation.js";
import { createS3ObjectStorage } from "../../src/infrastructure/object-storage/s3-object-storage.js";

test("resolved S3 public handler forwards exact receiver/request/options and observes headers without consuming body", async () => {
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "proof",
    sampleRatio: 1,
    exporters: { spans, metrics },
  });
  const body = {
    get privateBody() {
      throw new Error("body must not be inspected");
    },
  };
  const result = {
    response: {
      statusCode: 503,
      headers: { "x-amz-request-id": "private-provider-id" },
      body,
    },
  };
  const original = vi
    .fn<S3Client["config"]["requestHandler"]["handle"]>()
    .mockResolvedValue(result);
  const destroy = vi.fn();
  const config = { privateAgent: "retained-agent" };
  const handler = {
    handle: original,
    destroy,
    metadata: { handlerProtocol: "http/1.1" },
    httpHandlerConfigs: () => config,
  };
  observeS3RequestHandler(handler);
  const request = {
    method: "GET",
    protocol: "http:",
    hostname: "private-host",
    path: "/private-bucket/private-key",
    headers: { authorization: "private-signature" },
  };
  const options = {
    abortSignal: new AbortController().signal,
    requestTimeout: 43,
  };
  const root = telemetry.startHttp({ method: "GET", route: "/pilot" });
  try {
    await expect(
      root.run(() => handler.handle(request, options)),
    ).resolves.toBe(result);
    root.finish(200, 1);
    await telemetry.flush();
    expect(original).toHaveBeenCalledExactlyOnceWith(request, options);
    expect(original.mock.contexts).toEqual([handler]);
    expect(handler.destroy).toBe(destroy);
    expect(handler.httpHandlerConfigs()).toBe(config);
    expect(handler.metadata).toEqual({ handlerProtocol: "http/1.1" });
    const attempt = spans
      .getFinishedSpans()
      .find((span) => span.name === "s3 http.GET");
    expect(attempt?.kind).toBe(SpanKind.CLIENT);
    expect(attempt?.attributes).toEqual({
      "dependency.name": "s3",
      "dependency.operation": "http.GET",
      "dependency.outcome": "failed",
      "http.request.method": "GET",
      "http.response.status_code": 503,
    });
    expect(attempt?.events).toEqual([]);
    expect(attempt?.parentSpanContext?.spanId).toBe(
      spans
        .getFinishedSpans()
        .find((span) => span.kind === SpanKind.SERVER)
        ?.spanContext().spanId,
    );
    expect(
      JSON.stringify(spans.getFinishedSpans().map((span) => span.attributes)),
    ).not.toContain("private-");
  } finally {
    await telemetry.shutdown();
  }
});

const storageConfig = {
  buckets: {
    public: "private-public-bucket",
    protected: "private-protected-bucket",
    quarantine: "private-quarantine-bucket",
  },
  credentials: {
    accessKeyId: "private-access-key",
    secretAccessKey: "private-secret-key",
  },
  endpoint: "http://127.0.0.1:1",
  forcePathStyle: true,
  region: "us-east-1",
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test("one public S3 loader owns body completion while cache waiters and hits add no fake HTTP or read operations", async () => {
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "proof",
    sampleRatio: 1,
    exporters: { spans, metrics },
  });
  const bodyStarted = deferred<undefined>();
  const body = deferred<Uint8Array>();
  const send = vi.fn().mockResolvedValue({
    Body: {
      transformToByteArray: () => {
        bodyStarted.resolve(undefined);
        return body.promise;
      },
    },
    ContentLength: 3,
    ContentType: "image/webp",
    Metadata: { sha256: "private-checksum" },
  });
  const storage = createS3ObjectStorage(storageConfig, { send });
  const root = telemetry.startHttp({ method: "GET", route: "/pilot" });
  try {
    const first = root.run(() => storage.read("public", "private-object"));
    await bodyStarted.promise;
    const waiter = root.run(() => storage.read("public", "private-object"));
    await telemetry.flush();
    expect(
      spans
        .getFinishedSpans()
        .filter((span) => span.name === "s3 getObject.read"),
    ).toHaveLength(0);
    body.resolve(new Uint8Array([1, 2, 3]));
    await expect(first).resolves.toMatchObject({
      contentLength: 3,
      checksumSha256: "private-checksum",
    });
    await expect(waiter).resolves.toMatchObject({ contentLength: 3 });
    await root.run(() => storage.read("public", "private-object"));
    root.finish(200, 1);
    await telemetry.flush();
    expect(send).toHaveBeenCalledTimes(1);
    const reads = spans
      .getFinishedSpans()
      .filter((span) => span.name === "s3 getObject.read");
    expect(reads).toHaveLength(1);
    expect(reads[0]?.kind).toBe(SpanKind.INTERNAL);
    expect(reads[0]?.attributes).toEqual({
      "dependency.name": "s3",
      "dependency.operation": "getObject.read",
      "dependency.outcome": "completed",
    });
    expect(
      spans.getFinishedSpans().filter((span) => span.kind === SpanKind.CLIENT),
    ).toHaveLength(0);
    expect(
      JSON.stringify(spans.getFinishedSpans().map((span) => span.attributes)),
    ).not.toContain("private-");
  } finally {
    body.resolve(new Uint8Array());
    await telemetry.shutdown();
  }
});

test("S3 keeps exact errors and unsupported methods outside its closed operation registry", async () => {
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "proof",
    sampleRatio: 0,
    exporters: { spans, metrics },
  });
  const error = new Error("private-original-error");
  const original = vi
    .fn<S3Client["config"]["requestHandler"]["handle"]>()
    .mockRejectedValue(error);
  const handler = { handle: original };
  observeS3RequestHandler(handler);
  const storage = createS3ObjectStorage(storageConfig, {
    send: () => Promise.reject(error),
  });
  const root = telemetry.startHttp({ method: "GET", route: "/pilot" });
  try {
    await expect(
      handler.handle({
        method: "GET",
        protocol: "http:",
        hostname: "private-host",
        path: "/private-key",
        headers: {},
      }),
    ).rejects.toBe(error);
    for (const method of ["GET", "HEAD", "private-method"]) {
      const request = {
        method,
        protocol: "http:",
        hostname: "private-host",
        path: "/private-key",
        headers: {},
      };
      await expect(root.run(() => handler.handle(request))).rejects.toBe(error);
      expect(original.mock.lastCall?.[0]).toBe(request);
    }
    await expect(
      root.run(() => storage.read("protected", "private-key")),
    ).rejects.toBe(error);
    root.finish(500, 1);
    await telemetry.flush();
    expect(spans.getFinishedSpans()).toHaveLength(0);
    const wire = JSON.stringify(metrics.getMetrics());
    expect(wire).toContain('"operation":"http.GET"');
    expect(wire).toContain('"operation":"getObject.read"');
    expect(wire).not.toContain("HEAD");
    expect(wire).not.toContain("private-");
    expect(wire).toContain('"outcome":"failed"');
    const counts = metrics
      .getMetrics()
      .flatMap((snapshot) =>
        snapshot.scopeMetrics.flatMap((scope) => scope.metrics),
      )
      .filter(
        (metric) => metric.descriptor.name === "inside.dependency.operations",
      )
      .flatMap((metric) =>
        metric.dataPointType === DataPointType.SUM ? metric.dataPoints : [],
      );
    expect(counts.map((point) => [point.attributes, point.value])).toEqual([
      [{ dependency: "s3", operation: "http.GET", outcome: "failed" }, 1],
      [{ dependency: "s3", operation: "getObject.read", outcome: "failed" }, 1],
    ]);
  } finally {
    await telemetry.shutdown();
  }
});

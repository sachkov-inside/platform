// deterministic-test-allow unit-io: native S3 SDK/OTLP loopback; owned listeners/sockets and clients close in test cleanup.
import { Agent, createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import type { TestContext } from "vitest";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SpanKind } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";
import { technicalTelemetryFromEnvironment } from "../../src/infrastructure/observability/technical-telemetry-runtime.js";
import { observeS3RequestHandler } from "../../src/infrastructure/object-storage/s3-request-observation.js";
import {
  createS3ObjectStorage,
  ensureS3Buckets,
} from "../../src/infrastructure/object-storage/s3-object-storage.js";

async function listen(owner: TestContext, handler: RequestListener) {
  const server = createServer(handler);
  owner.onTestFinished(async () => {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
    expect(server.listening).toBe(false);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("owned S3 listener unavailable");
  return `http://127.0.0.1:${address.port}`;
}
function config(endpoint: string) {
  return {
    endpoint,
    buckets: {
      public: "private-public-bucket",
      protected: "private-protected-bucket",
      quarantine: "private-quarantine-bucket",
    },
    credentials: {
      accessKeyId: "private-access-key",
      secretAccessKey: "private-secret-key",
    },
    region: "us-east-1",
    forcePathStyle: true,
  };
}
function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
function telemetry(owner: TestContext, enabled = true) {
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const sdk = createTechnicalTelemetry({
    enabled,
    service: "platform-api",
    environment: "test",
    release: "proof",
    sampleRatio: 1,
    exporters: { spans, metrics },
  });
  owner.onTestFinished(() => sdk.shutdown());
  return { sdk, spans, metrics };
}
function objectHeaders() {
  return {
    "content-type": "image/webp",
    "content-length": "3",
    "x-amz-meta-sha256": "private-checksum",
    "x-amz-request-id": "private-provider-id",
  };
}

test("native resolved S3 handler records every existing SDK retry through headers and retains agent/config/destroy ownership", async (owner) => {
  let requests = 0;
  let exhausted = false;
  const endpoint = await listen(owner, (request, response) => {
    requests++;
    expect(request.headers["traceparent"]).toBeUndefined();
    expect(request.headers.authorization).toContain("private-access-key");
    request.resume();
    if (exhausted || requests < 3)
      response
        .writeHead(503, { "content-type": "application/xml" })
        .end(
          "<Error><Code>ServiceUnavailable</Code><Message>private-provider-error</Message></Error>",
        );
    else response.writeHead(200, objectHeaders()).end(Buffer.from([1, 2, 3]));
  });
  const { sdk, spans, metrics } = telemetry(owner);
  // This owned test sets three attempts; production keeps its existing configured providers.
  const agent = new Agent({ keepAlive: true, maxSockets: 3 });
  const client = new S3Client({
    ...config(endpoint),
    maxAttempts: 3,
    requestHandler: { httpAgent: agent },
  });
  owner.onTestFinished(async () => {
    const sockets = [
      ...Object.values(agent.sockets),
      ...Object.values(agent.freeSockets),
    ].flatMap((group) => group ?? []);
    const closed = sockets.map((socket) =>
      socket.closed ? Promise.resolve() : once(socket, "close"),
    );
    client.destroy();
    await Promise.all(closed);
    expect(
      Object.values(agent.sockets).flatMap((group) => group ?? []),
    ).toHaveLength(0);
    expect(
      Object.values(agent.freeSockets).flatMap((group) => group ?? []),
    ).toHaveLength(0);
  });
  const handler = client.config.requestHandler;
  const destroy = handler.destroy;
  const metadata = handler.metadata;
  if (
    !("httpHandlerConfigs" in handler) ||
    typeof handler.httpHandlerConfigs !== "function" ||
    !("updateHttpClientConfig" in handler)
  )
    throw new Error("pinned public node handler shape unavailable");
  const configs: unknown = Reflect.get(handler, "httpHandlerConfigs");
  if (typeof configs !== "function")
    throw new Error("public handler config unavailable");
  const update: unknown = Reflect.get(handler, "updateHttpClientConfig");
  const retryProvider = client.config.maxAttempts;
  observeS3RequestHandler(handler);
  expect(handler.destroy).toBe(destroy);
  expect(handler.metadata).toBe(metadata);
  expect(Reflect.get(handler, "httpHandlerConfigs")).toBe(configs);
  expect(Reflect.get(handler, "updateHttpClientConfig")).toBe(update);
  expect(client.config.maxAttempts).toBe(retryProvider);
  const root = sdk.startHttp({ method: "GET", route: "/pilot" });
  const first = await root.run(() =>
    client.send(
      new GetObjectCommand({ Bucket: "private-bucket", Key: "private-key" }),
    ),
  );
  expect(await first.Body?.transformToByteArray()).toEqual(
    new Uint8Array([1, 2, 3]),
  );
  exhausted = true;
  await expect(
    root.run(() =>
      client.send(
        new GetObjectCommand({ Bucket: "private-bucket", Key: "private-key" }),
      ),
    ),
  ).rejects.toMatchObject({
    name: "ServiceUnavailable",
    $metadata: { attempts: 3 },
  });
  root.finish(200, 1);
  await sdk.flush();
  expect(requests).toBe(6);
  const actualConfig: unknown = configs.call(handler);
  expect(
    actualConfig !== null &&
      typeof actualConfig === "object" &&
      "httpAgent" in actualConfig
      ? actualConfig.httpAgent
      : undefined,
  ).toBe(agent);
  const attempts = spans
    .getFinishedSpans()
    .filter((span) => span.name === "s3 http.GET");
  expect(attempts).toHaveLength(6);
  expect(attempts.map((span) => span.attributes["dependency.outcome"])).toEqual(
    ["failed", "failed", "completed", "failed", "failed", "failed"],
  );
  expect(
    attempts.every(
      (span) =>
        span.kind === SpanKind.CLIENT &&
        span.parentSpanContext?.spanId ===
          spans
            .getFinishedSpans()
            .find((candidate) => candidate.kind === SpanKind.SERVER)
            ?.spanContext().spanId,
    ),
  ).toBe(true);
  expect(
    JSON.stringify(
      attempts.map((span) => ({
        attributes: span.attributes,
        events: span.events,
        status: span.status,
      })),
    ),
  ).not.toContain("private-");
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
  expect(counts.reduce((total, point) => total + point.value, 0)).toBe(6);
}, 15_000);

test("native public cache coalesces across contexts and deletion prevents an in-flight read from repopulating", async (owner) => {
  const started = deferred<undefined>();
  const release = deferred<undefined>();
  owner.onTestFinished(() => release.resolve(undefined));
  let gets = 0;
  let deletes = 0;
  const endpoint = await listen(owner, (request, response) => {
    request.resume();
    if (request.method === "DELETE") {
      deletes++;
      response.writeHead(204).end();
      return;
    }
    gets++;
    if (gets === 1) {
      started.resolve(undefined);
      void release.promise.then(() =>
        response.writeHead(200, objectHeaders()).end(Buffer.from([1, 2, 3])),
      );
    } else response.writeHead(200, objectHeaders()).end(Buffer.from([1, 2, 3]));
  });
  const { sdk, spans } = telemetry(owner);
  const storage = createS3ObjectStorage(config(endpoint));
  const firstRoot = sdk.startHttp({ method: "GET", route: "/pilot" });
  const secondRoot = sdk.startHttp({ method: "GET", route: "/pilot" });
  const first = firstRoot.run(() =>
    storage.read("public", "private-shared-image"),
  );
  await started.promise;
  const waiter = secondRoot.run(() =>
    storage.read("public", "private-shared-image"),
  );
  await secondRoot.run(() => storage.delete("public", "private-shared-image"));
  release.resolve(undefined);
  await Promise.all([first, waiter]);
  await secondRoot.run(() => storage.read("public", "private-shared-image"));
  await secondRoot.run(() => storage.read("protected", "private-shared-image"));
  await secondRoot.run(() => storage.read("protected", "private-shared-image"));
  firstRoot.finish(200, 1);
  secondRoot.finish(200, 1);
  await sdk.flush();
  expect(gets).toBe(4);
  expect(deletes).toBe(1);
  const reads = spans
    .getFinishedSpans()
    .filter((span) => span.name === "s3 getObject.read");
  expect(reads).toHaveLength(4);
  expect(reads[0]?.spanContext().traceId).not.toBe(
    reads[1]?.spanContext().traceId,
  );
  expect(
    reads
      .slice(1)
      .every(
        (read) =>
          read.spanContext().traceId === reads[1]?.spanContext().traceId,
      ),
  ).toBe(true);
  expect(
    spans.getFinishedSpans().filter((span) => span.kind === SpanKind.CLIENT),
  ).toHaveLength(5);
});

test("native conditional puts and bucket bootstrap keep existing refusal semantics without synthetic read operations", async (owner) => {
  let status = 409;
  let requests = 0;
  const endpoint = await listen(owner, (request, response) => {
    requests++;
    request.resume();
    expect(request.method).toBe("PUT");
    response
      .writeHead(status, { "content-type": "application/xml" })
      .end(
        status === 200
          ? ""
          : `<Error><Code>${status === 412 ? "PreconditionFailed" : "BucketAlreadyOwnedByYou"}</Code><Message>private-provider-error</Message></Error>`,
      );
  });
  const { sdk, spans } = telemetry(owner);
  const storage = createS3ObjectStorage(config(endpoint));
  const root = sdk.startHttp({ method: "PUT", route: "/pilot" });
  for (status of [409, 412])
    await expect(
      root.run(() =>
        storage.putImmutable({
          namespace: "public",
          key: "private-image",
          body: new Uint8Array([1, 2, 3]),
          checksumSha256: "private-checksum",
          contentType: "image/webp",
        }),
      ),
    ).resolves.toEqual({ ok: false, error: { code: "object_already_exists" } });
  status = 409;
  await root.run(() => ensureS3Buckets(config(endpoint)));
  status = 200;
  await root.run(() =>
    storage.putImmutable({
      namespace: "quarantine",
      key: "private-image",
      body: new Uint8Array([1, 2, 3]),
      checksumSha256: "private-checksum",
      contentType: "image/webp",
    }),
  );
  root.finish(200, 1);
  await sdk.flush();
  expect(requests).toBe(6);
  const attempts = spans
    .getFinishedSpans()
    .filter((span) => span.name === "s3 http.PUT");
  expect(attempts).toHaveLength(6);
  expect(attempts.map((span) => span.attributes["dependency.outcome"])).toEqual(
    ["failed", "failed", "failed", "failed", "failed", "completed"],
  );
  expect(
    spans
      .getFinishedSpans()
      .filter((span) => span.name === "s3 getObject.read"),
  ).toHaveLength(0);
});

for (const enabled of [false, true])
  test(`native S3 keeps delivery and private wire boundaries with telemetry ${enabled ? "exporter503" : "OFF"}`, async (owner) => {
    let requests = 0;
    const endpoint = await listen(owner, (request, response) => {
      requests++;
      request.resume();
      response.writeHead(200, objectHeaders()).end(Buffer.from([1, 2, 3]));
    });
    const exported: string[] = [];
    let bytes = 0;
    const exporter = await listen(owner, (request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 1_048_576 || exported.length >= 32) request.destroy();
        else body += chunk;
      });
      request.on("end", () => {
        exported.push(body);
        response.writeHead(503).end("private-export-error");
      });
    });
    for (const key of Object.keys(process.env))
      if (key.startsWith("OTEL_EXPORTER_OTLP")) vi.stubEnv(key, undefined);
    owner.onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    owner.onTestFinished(() => warning.mockRestore());
    const sdk = technicalTelemetryFromEnvironment({
      environment: {
        INSIDE_OTEL_ENABLED: String(enabled),
        INSIDE_OTEL_ENDPOINT: exporter,
      },
      service: "platform-api",
      mode: "test",
      identity: { release: "proof", sourceSha: "a".repeat(40) },
    });
    owner.onTestFinished(() => sdk.shutdown());
    const storage = createS3ObjectStorage(config(endpoint));
    const root = sdk.startHttp({ method: "GET", route: "/pilot" });
    await expect(
      root.run(() => storage.read("protected", "private-export-key")),
    ).resolves.toMatchObject({ body: new Uint8Array([1, 2, 3]) });
    root.finish(200, 1);
    await sdk.flush();
    expect(requests).toBe(1);
    if (enabled) {
      expect(exported.length).toBeGreaterThan(0);
      expect(exported.some((body) => body.includes('"s3 http.GET"'))).toBe(
        true,
      );
      expect(
        exported.some((body) => body.includes('"s3 getObject.read"')),
      ).toBe(true);
      expect(
        exported.some((body) =>
          body.includes('"inside.dependency.operations"'),
        ),
      ).toBe(true);
      expect(sdk.diagnostics().failedTraceExports).toBeGreaterThan(0);
      expect(sdk.diagnostics().failedMetricExports).toBeGreaterThan(0);
      const attribute = z.object({
        key: z.string(),
        value: z.record(z.string(), z.unknown()),
      });
      const spanSchema = z.object({
        traceId: z.string().regex(/^[0-9a-f]{32}$/),
        spanId: z.string().regex(/^[0-9a-f]{16}$/),
        parentSpanId: z.string().optional(),
        name: z.string(),
        attributes: z.array(attribute),
        events: z.array(z.unknown()).optional(),
      });
      const envelope = z.union([
        z
          .object({
            resourceSpans: z.array(
              z.object({
                scopeSpans: z.array(z.object({ spans: z.array(spanSchema) })),
              }),
            ),
          })
          .strict(),
        z
          .object({
            resourceMetrics: z.array(
              z.object({
                scopeMetrics: z.array(
                  z.object({
                    metrics: z.array(z.object({ name: z.string() })),
                  }),
                ),
              }),
            ),
          })
          .strict(),
      ]);
      const traces = new Map<string, z.infer<typeof spanSchema>>();
      for (const body of exported) {
        const frame = envelope.parse(JSON.parse(body));
        if ("resourceSpans" in frame)
          for (const resource of frame.resourceSpans)
            for (const scope of resource.scopeSpans)
              for (const span of scope.spans) {
                expect([
                  "GET /pilot",
                  "s3 http.GET",
                  "s3 getObject.read",
                ]).toContain(span.name);
                expect(span.events ?? []).toEqual([]);
                const allowed =
                  span.name === "GET /pilot"
                    ? [
                        "http.request.method",
                        "http.route",
                        "http.response.status_code",
                        "http.request.outcome",
                      ]
                    : span.name === "s3 http.GET"
                      ? [
                          "dependency.name",
                          "dependency.operation",
                          "dependency.outcome",
                          "http.request.method",
                          "http.response.status_code",
                        ]
                      : [
                          "dependency.name",
                          "dependency.operation",
                          "dependency.outcome",
                        ];
                expect(
                  span.attributes.every((entry) => allowed.includes(entry.key)),
                ).toBe(true);
                if (traces.has(span.spanId))
                  expect(span).toEqual(traces.get(span.spanId));
                traces.set(span.spanId, span);
              }
        else
          for (const resource of frame.resourceMetrics)
            for (const scope of resource.scopeMetrics)
              for (const metric of scope.metrics)
                expect([
                  "http.server.request.count",
                  "http.server.request.duration",
                  "http.server.active_requests",
                  "telemetry.trace.dropped",
                  "telemetry.trace.export.failures",
                  "telemetry.metric.export.failures",
                  "telemetry.trace.sampling.ratio",
                  "inside.dependency.operations",
                  "inside.dependency.duration",
                  "inside.postgresql.pool.registry_overflow",
                  "inside.postgresql.pool.available",
                  "inside.postgresql.pool.total",
                  "inside.postgresql.pool.idle",
                  "inside.postgresql.pool.waiting",
                ]).toContain(metric.name);
      }
      expect(traces.size).toBe(3);
      const rootSpan = [...traces.values()].find(
        (span) => span.name === "GET /pilot",
      );
      const read = [...traces.values()].find(
        (span) => span.name === "s3 getObject.read",
      );
      const attempt = [...traces.values()].find(
        (span) => span.name === "s3 http.GET",
      );
      expect(read?.parentSpanId).toBe(rootSpan?.spanId);
      expect(attempt?.parentSpanId).toBe(read?.spanId);
      expect(
        new Set([...traces.values()].map((span) => span.traceId)).size,
      ).toBe(1);
    } else expect(exported).toHaveLength(0);
    expect(bytes).toBeLessThanOrEqual(1_048_576);
    expect(exported.length).toBeLessThanOrEqual(32);
    const observed = exported.join("\n") + JSON.stringify(warning.mock.calls);
    for (const secret of [
      "private-",
      endpoint,
      "X-Amz-Signature",
      "authorization",
      "x-amz-meta-sha256",
      "x-amz-request-id",
    ])
      expect(observed).not.toContain(secret);
  }, 15_000);

test("native default storage separates full read/metadata/stream failures, mapped misses and zero-I/O public cache/signing", async (owner) => {
  let requests = 0;
  let mode: "ok" | "metadata" | "stream" | "missing" = "ok";
  const endpoint = await listen(owner, (request, response) => {
    requests++;
    request.resume();
    expect(request.headers["traceparent"]).toBeUndefined();
    if (mode === "missing")
      response
        .writeHead(404, { "content-type": "application/xml" })
        .end(
          "<Error><Code>NoSuchKey</Code><Message>private-missing</Message></Error>",
        );
    else if (mode === "metadata")
      response
        .writeHead(200, { "content-type": "image/webp", "content-length": "3" })
        .end(Buffer.from([1, 2, 3]));
    else if (mode === "stream") {
      const socket = response.socket;
      response.writeHead(200, { ...objectHeaders(), "content-length": "9" });
      response.flushHeaders();
      response.once("finish", () => socket?.destroy());
      response.end(Buffer.from([1, 2, 3]));
    } else response.writeHead(200, objectHeaders()).end(Buffer.from([1, 2, 3]));
  });
  const { sdk, spans } = telemetry(owner);
  const storage = createS3ObjectStorage(config(endpoint));
  const root = sdk.startHttp({ method: "GET", route: "/pilot" });
  await expect(
    root.run(() => storage.read("public", "private-image")),
  ).resolves.toMatchObject({ body: new Uint8Array([1, 2, 3]) });
  await root.run(() => storage.read("public", "private-image"));
  expect(requests).toBe(1);
  const signed = await root.run(() =>
    storage.signGet({
      namespace: "protected",
      key: "private-signed-key",
      ttlSeconds: 30,
    }),
  );
  expect(signed).toContain("X-Amz-Signature");
  expect(requests).toBe(1);
  mode = "metadata";
  await expect(
    root.run(() => storage.read("protected", "private-metadata")),
  ).rejects.toThrow("Stored object metadata is incomplete");
  mode = "stream";
  await expect(
    root.run(() => storage.read("quarantine", "private-stream")),
  ).rejects.toThrow();
  mode = "missing";
  await expect(
    root.run(() => storage.read("protected", "private-missing")),
  ).resolves.toBeNull();
  root.finish(200, 1);
  await sdk.flush();
  expect(requests).toBe(4);
  const attempts = spans
    .getFinishedSpans()
    .filter((span) => span.name === "s3 http.GET");
  const reads = spans
    .getFinishedSpans()
    .filter((span) => span.name === "s3 getObject.read");
  expect(attempts.map((span) => span.attributes["dependency.outcome"])).toEqual(
    ["completed", "completed", "completed", "failed"],
  );
  expect(reads.map((span) => span.attributes["dependency.outcome"])).toEqual([
    "completed",
    "failed",
    "failed",
    "completed",
  ]);
  expect(reads.every((span) => span.kind === SpanKind.INTERNAL)).toBe(true);
  expect(
    attempts.every((span) =>
      reads.some(
        (read) => read.spanContext().spanId === span.parentSpanContext?.spanId,
      ),
    ),
  ).toBe(true);
  expect(
    JSON.stringify(
      spans.getFinishedSpans().map((span) => ({
        attributes: span.attributes,
        events: span.events,
        status: span.status,
      })),
    ),
  ).not.toContain("private-");
}, 15_000);

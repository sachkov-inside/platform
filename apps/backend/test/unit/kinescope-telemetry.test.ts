import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  context,
  createContextKey,
  ROOT_CONTEXT,
  SpanKind,
} from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { expect, test, vi } from "vitest";
import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";
import { createKinescopeVideoProvider } from "../../src/modules/videos/adapters/kinescope/kinescope-video-provider.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const config = {
  apiBaseUrl: "https://api.kinescope.io/private-url-sentinel",
  uploaderBaseUrl: "https://uploader.kinescope.io",
  apiToken: "private-token-sentinel",
};

test("Kinescope deletion records one full adapter operation without provider identity or request propagation", async () => {
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
  try {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { data: { success: true } },
          { headers: { "x-request-id": "private-provider-request-sentinel" } },
        ),
      );
    const provider = createKinescopeVideoProvider({
      ...config,
      fetch: request,
    });
    const root = telemetry.startHttp({
      method: "POST",
      route: "/authoring/videos/:videoId/deletion-retries",
    });
    await expect(
      root.run(() => provider.delete({ id: "private-video-sentinel" })),
    ).resolves.toEqual({
      kind: "deleted",
      providerRequestId: "private-provider-request-sentinel",
    });
    root.finish(200, 1);
    await telemetry.flush();
    const operation = spans
      .getFinishedSpans()
      .find((span) => span.kind === SpanKind.CLIENT);
    expect(operation?.name).toBe("kinescope delete");
    expect(operation?.attributes).toEqual({
      "dependency.name": "kinescope",
      "dependency.operation": "delete",
      "http.request.method": "DELETE",
      "http.response.status_code": 200,
      "dependency.outcome": "completed",
    });
    expect(operation?.parentSpanContext?.spanId).toBe(
      spans
        .getFinishedSpans()
        .find((span) => span.kind === SpanKind.SERVER)
        ?.spanContext().spanId,
    );
    expect(
      spans.getFinishedSpans().filter((span) => span.kind === SpanKind.CLIENT),
    ).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]?.headers).toEqual({
      authorization: "Bearer private-token-sentinel",
    });
    const emitted = JSON.stringify({
      attributes: operation?.attributes,
      name: operation?.name,
      events: operation?.events,
      metrics: metrics.getMetrics(),
    });
    expect(emitted).not.toContain("private-");
    const count = metrics
      .getMetrics()
      .flatMap((resource) =>
        resource.scopeMetrics.flatMap((scope) => scope.metrics),
      )
      .find(
        (metric) => metric.descriptor.name === "inside.dependency.operations",
      );
    expect(count?.dataPoints).toMatchObject([
      {
        attributes: {
          dependency: "kinescope",
          operation: "delete",
          outcome: "completed",
        },
        value: 1,
      },
    ]);
  } finally {
    await telemetry.shutdown();
  }
});

test("concurrent operations finish after existing body validation and restore their parents", async () => {
  const spans = new InMemorySpanExporter();
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "proof",
    sampleRatio: 1,
    exporters: {
      spans,
      metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    },
  });
  try {
    const body = deferred<string>();
    const readStarted = deferred<undefined>();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          readStarted.resolve(undefined);
          controller.enqueue(new TextEncoder().encode(await body.promise));
          controller.close();
        },
      }),
    );
    const provider = createKinescopeVideoProvider({
      ...config,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
    });
    const first = telemetry.startHttp({ method: "POST", route: "/first" });
    const second = telemetry.startHttp({ method: "POST", route: "/second" });
    const firstParent = first.run(() => telemetry.correlation()["spanId"]);
    const secondParent = second.run(() => telemetry.correlation()["spanId"]);
    const pending = first.run(async () => {
      const result = await provider.delete({ id: "private-first-sentinel" });
      expect(telemetry.correlation()["spanId"]).toBe(firstParent);
      return result;
    });
    await readStarted.promise;
    await telemetry.flush();
    expect(spans.getFinishedSpans()).toHaveLength(0);
    const other = createKinescopeVideoProvider({
      ...config,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 404 })),
    });
    await second.run(async () => {
      expect(
        await other.find({
          id: "private-second-sentinel",
          projectId: "private-project-sentinel",
        }),
      ).toBeNull();
      expect(telemetry.correlation()["spanId"]).toBe(secondParent);
    });
    body.resolve('{"data":{"success":true}}');
    await expect(pending).resolves.toEqual({ kind: "deleted" });
    first.finish(200, 1);
    second.finish(200, 1);
    await telemetry.flush();
    const clients = spans
      .getFinishedSpans()
      .filter((span) => span.kind === SpanKind.CLIENT);
    expect(
      clients.map((span) => [span.name, span.parentSpanContext?.spanId]),
    ).toEqual([
      ["kinescope find", secondParent],
      ["kinescope delete", firstParent],
    ]);
    expect(telemetry.correlation()).toEqual({});
  } finally {
    await telemetry.shutdown();
  }
});

test("mapped failures, original thrown objects and early unread bodies retain their contracts", async () => {
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
  try {
    for (const status of [404, 429, 503]) {
      const response = new Response("private-unread-body-sentinel", { status });
      const provider = createKinescopeVideoProvider({
        ...config,
        fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
      });
      await telemetry.runJob(() =>
        provider.delete({ id: "private-video-sentinel" }),
      );
      expect(response.bodyUsed).toBe(false);
    }
    const original = new Error("private-error-sentinel", {
      cause: "private-cause-sentinel",
    });
    const provider = createKinescopeVideoProvider({
      ...config,
      fetch: vi.fn<typeof fetch>().mockRejectedValue(original),
    });
    await expect(
      telemetry.runJob(() =>
        provider.find({
          id: "private-video-sentinel",
          projectId: "private-project-sentinel",
        }),
      ),
    ).rejects.toBe(original);
    expect(telemetry.correlation()).toEqual({});
    await telemetry.flush();
    const clients = spans.getFinishedSpans();
    expect(
      clients.map((span) => [
        span.attributes["http.response.status_code"],
        span.attributes["dependency.outcome"],
      ]),
    ).toEqual([
      [404, "completed"],
      [429, "failed"],
      [503, "failed"],
      [undefined, "failed"],
    ]);
    expect(
      JSON.stringify(
        clients.map((span) => ({
          attributes: span.attributes,
          events: span.events,
          status: span.status,
        })),
      ),
    ).not.toContain("private-");
    expect(clients.every((span) => span.events.length === 0)).toBe(true);
  } finally {
    await telemetry.shutdown();
  }
});

test("OFF nested in another runtime suppresses dependency capture and zero sampling retains completion counts", async () => {
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
  const off = createTechnicalTelemetry({ enabled: false });
  try {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 404 })),
      );
    const provider = createKinescopeVideoProvider({
      ...config,
      fetch: request,
    });
    await telemetry.runJob(() =>
      off.runJob(() =>
        provider.find({
          id: "private-off-sentinel",
          projectId: "private-project-sentinel",
        }),
      ),
    );
    await telemetry.flush();
    expect(
      metrics
        .getMetrics()
        .flatMap((resource) =>
          resource.scopeMetrics.flatMap((scope) => scope.metrics),
        )
        .some(
          (metric) => metric.descriptor.name === "inside.dependency.operations",
        ),
    ).toBe(false);
    await telemetry.runJob(() =>
      provider.find({
        id: "private-on-sentinel",
        projectId: "private-project-sentinel",
      }),
    );
    await telemetry.flush();
    expect(spans.getFinishedSpans()).toEqual([]);
    const count = metrics
      .getMetrics()
      .flatMap((resource) =>
        resource.scopeMetrics.flatMap((scope) => scope.metrics),
      )
      .find(
        (metric) => metric.descriptor.name === "inside.dependency.operations",
      );
    expect(count?.dataPoints).toMatchObject([
      {
        attributes: {
          dependency: "kinescope",
          operation: "find",
          outcome: "completed",
        },
        value: 1,
      },
    ]);
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    await off.shutdown();
    await telemetry.shutdown();
  }
});

test("a refused dependency runtime preserves the foreign context manager", async () => {
  const foreign = new AsyncLocalStorageContextManager().enable();
  let registered = false;
  let runtime: ReturnType<typeof createTechnicalTelemetry> | undefined;
  try {
    registered = context.setGlobalContextManager(foreign);
    expect(registered).toBe(true);
    const spans = new InMemorySpanExporter();
    runtime = createTechnicalTelemetry({
      enabled: true,
      service: "platform-api",
      environment: "test",
      release: "proof",
      sampleRatio: 1,
      exporters: {
        spans,
        metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
      },
    });
    const provider = createKinescopeVideoProvider({
      ...config,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 404 })),
    });
    const marker = createContextKey("kinescope foreign owner");
    const refused = runtime;
    await foreign.with(ROOT_CONTEXT.setValue(marker, "preserved"), () =>
      refused.runJob(async () => {
        expect(
          await provider.find({
            id: "private-video-sentinel",
            projectId: "private-project-sentinel",
          }),
        ).toBeNull();
        expect(context.active().getValue(marker)).toBe("preserved");
      }),
    );
    await runtime.flush();
    expect(spans.getFinishedSpans()).toEqual([]);
    await runtime.shutdown();
    foreign.with(ROOT_CONTEXT.setValue(marker, "preserved"), () =>
      expect(context.active().getValue(marker)).toBe("preserved"),
    );
  } finally {
    await runtime?.shutdown();
    if (registered) context.disable();
    else foreign.disable();
  }
});

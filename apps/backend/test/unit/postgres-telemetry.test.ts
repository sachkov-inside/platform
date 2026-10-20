import { SpanKind } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { expect, test } from "vitest";
import {
  beginPostgresObservation,
  createTechnicalTelemetry,
} from "../../src/infrastructure/observability/technical-telemetry.js";

test("PostgreSQL observations distinguish acquisition and execution without retaining query or error content", async () => {
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
    const root = telemetry.startHttp({ method: "GET", route: "/proof" });
    const original = new Error("private-query-parameter-error-sentinel");
    root.run(() => {
      const acquire = beginPostgresObservation("acquire");
      acquire.run(() =>
        acquire.complete(false, () => {
          const query = beginPostgresObservation("query");
          expect(() =>
            query.run(() => {
              throw original;
            }),
          ).toThrow(original);
          query.complete(true, () => undefined);
          query.complete(true, () => undefined);
        }),
      );
    });
    root.finish(200, 1);
    await telemetry.flush();
    const clients = spans
      .getFinishedSpans()
      .filter((span) => span.kind === SpanKind.CLIENT);
    expect(clients.map((span) => span.name)).toEqual([
      "postgresql acquire",
      "postgresql query",
    ]);
    expect(clients[0]?.parentSpanContext?.spanId).toBe(
      clients[1]?.parentSpanContext?.spanId,
    );
    expect(clients[1]?.attributes).toEqual({
      "dependency.name": "postgresql",
      "dependency.operation": "query",
      "dependency.outcome": "failed",
    });
    expect(
      JSON.stringify({
        spans: clients.map((span) => ({
          name: span.name,
          attributes: span.attributes,
          events: span.events,
          status: span.status,
        })),
        metrics: metrics.getMetrics(),
      }),
    ).not.toContain("private-");
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
          dependency: "postgresql",
          operation: "acquire",
          outcome: "completed",
        },
        value: 1,
      },
      {
        attributes: {
          dependency: "postgresql",
          operation: "query",
          outcome: "failed",
        },
        value: 1,
      },
    ]);
  } finally {
    await telemetry.shutdown();
  }
});

test("registered slug lock measures its own wait without inventing an extra SQL completion", async () => {
  const { lockMaterialSlugAllocation } =
    await import("../../src/infrastructure/prisma/transaction-locks.js");
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
    const root = telemetry.startHttp({ method: "POST", route: "/proof" });
    const failure = new Error("private-lock-key-sentinel");
    await expect(
      root.run(() =>
        lockMaterialSlugAllocation({
          $executeRaw: () => Promise.reject(failure),
        }),
      ),
    ).rejects.toBe(failure);
    root.finish(500, 1);
    await telemetry.flush();
    const locks = spans
      .getFinishedSpans()
      .filter((span) => span.kind === SpanKind.INTERNAL);
    expect(locks).toHaveLength(1);
    expect(locks[0]?.name).toBe("postgresql material-slug-lock");
    expect(locks[0]?.attributes).toEqual({
      "dependency.name": "postgresql",
      "dependency.operation": "material-slug-lock",
      "dependency.outcome": "failed",
    });
    expect(
      spans.getFinishedSpans().filter((span) => span.kind === SpanKind.CLIENT),
    ).toHaveLength(0);
    expect(
      JSON.stringify(
        locks.map((span) => ({
          attributes: span.attributes,
          events: span.events,
          status: span.status,
        })),
      ),
    ).not.toContain("private-");
  } finally {
    await telemetry.shutdown();
  }
});

test("the actual Prisma adapter observes acquisition failure and recreates its owned pool after disposal", async () => {
  const { createPrismaPgAdapter } =
    await import("../../src/infrastructure/prisma/prisma-adapter.js");
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
  const factory = createPrismaPgAdapter(
    "postgresql://private-user:private-password@invalid.invalid/private-db",
  );
  const adapter = await factory.connect();
  try {
    expect(adapter.underlyingDriver().options.max).toBe(10);
    expect(adapter.underlyingDriver().options.connectionTimeoutMillis).toBe(
      5_000,
    );
    await adapter.dispose();
    const root = telemetry.startHttp({ method: "GET", route: "/proof" });
    // The ended pool refuses synchronously scheduled acquisition, without opening a network connection.
    await expect(
      root.run(() =>
        adapter.queryRaw({
          sql: "SELECT 'private-query-sentinel'",
          args: [],
          argTypes: [],
        }),
      ),
    ).rejects.toThrow();
    root.finish(500, 1);
    await telemetry.flush();
    expect(
      spans
        .getFinishedSpans()
        .filter((span) => span.kind === SpanKind.CLIENT)
        .map((span) => ({ name: span.name, attributes: span.attributes })),
    ).toEqual([
      {
        name: "postgresql acquire",
        attributes: {
          "dependency.name": "postgresql",
          "dependency.operation": "acquire",
          "dependency.outcome": "failed",
        },
      },
    ]);
    const reconnected = await factory.connect();
    try {
      expect(reconnected.underlyingDriver()).not.toBe(
        adapter.underlyingDriver(),
      );
      expect(reconnected.underlyingDriver().ending).toBe(false);
    } finally {
      await reconnected.dispose();
    }
    expect(
      JSON.stringify(spans.getFinishedSpans().map((span) => span.attributes)),
    ).not.toContain("private-");
  } finally {
    await telemetry.shutdown();
  }
});

test("pool readings expose current unavailability instead of treating a disposed pool as healthy zero", async () => {
  const { observePostgresPool } =
    await import("../../src/infrastructure/observability/technical-telemetry.js");
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "proof",
    sampleRatio: 1,
    exporters: { spans: new InMemorySpanExporter(), metrics },
  });
  let available = true;
  try {
    const root = telemetry.startHttp({ method: "GET", route: "/proof" });
    root.run(() =>
      observePostgresPool({}, () => ({
        available,
        total: 2,
        idle: 1,
        waiting: 3,
      })),
    );
    root.finish(200, 1);
    await telemetry.flush();
    const latest = () =>
      metrics
        .getMetrics()
        .at(-1)
        ?.scopeMetrics.flatMap((scope) => scope.metrics)
        .filter((metric) =>
          metric.descriptor.name.startsWith("inside.postgresql.pool."),
        );
    expect(
      latest()?.map((metric) => [metric.descriptor.name, metric.dataPoints]),
    ).toEqual([
      [
        "inside.postgresql.pool.registry_overflow",
        [expect.objectContaining({ attributes: {}, value: 0 })],
      ],
      [
        "inside.postgresql.pool.available",
        [expect.objectContaining({ attributes: {}, value: 1 })],
      ],
      [
        "inside.postgresql.pool.total",
        [expect.objectContaining({ attributes: {}, value: 2 })],
      ],
      [
        "inside.postgresql.pool.idle",
        [expect.objectContaining({ attributes: {}, value: 1 })],
      ],
      [
        "inside.postgresql.pool.waiting",
        [expect.objectContaining({ attributes: {}, value: 3 })],
      ],
    ]);
    available = false;
    await telemetry.flush();
    expect(
      latest()?.map((metric) => [metric.descriptor.name, metric.dataPoints]),
    ).toEqual([
      [
        "inside.postgresql.pool.registry_overflow",
        [expect.objectContaining({ attributes: {}, value: 0 })],
      ],
      [
        "inside.postgresql.pool.available",
        [expect.objectContaining({ attributes: {}, value: 0 })],
      ],
      [
        "inside.postgresql.pool.total",
        [expect.objectContaining({ attributes: {}, value: 0 })],
      ],
      [
        "inside.postgresql.pool.idle",
        [expect.objectContaining({ attributes: {}, value: 0 })],
      ],
      [
        "inside.postgresql.pool.waiting",
        [expect.objectContaining({ attributes: {}, value: 0 })],
      ],
    ]);
  } finally {
    await telemetry.shutdown();
  }
});

for (const enabled of [false, true]) {
  test(`PostgreSQL completions preserve errors and application context with sampling zero, enabled ${String(enabled)}`, async () => {
    const spans = new InMemorySpanExporter();
    const metrics = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    const telemetry = createTechnicalTelemetry({
      enabled,
      service: "platform-api",
      environment: "test",
      release: "proof",
      sampleRatio: 0,
      exporters: { spans, metrics },
    });
    try {
      const root = telemetry.startHttp({ method: "GET", route: "/proof" });
      const failure = new Error("private-error-sentinel");
      await expect(
        root.run(async () => {
          const before = telemetry.correlation();
          const observation = beginPostgresObservation("query");
          try {
            return await observation.run(() => Promise.reject(failure));
          } finally {
            observation.complete(true, () => undefined);
            expect(telemetry.correlation()).toEqual(before);
          }
        }),
      ).rejects.toBe(failure);
      root.finish(500, 1);
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
      expect(count?.dataPoints ?? []).toEqual(
        enabled
          ? [
              expect.objectContaining({
                value: 1,
                attributes: {
                  dependency: "postgresql",
                  operation: "query",
                  outcome: "failed",
                },
              }),
            ]
          : [],
      );
    } finally {
      await telemetry.shutdown();
    }
  });
}

for (const overflow of [false, true]) {
  test(`pool registry bounds retained owners and prunes disposed pools, overflow ${String(overflow)}`, async () => {
    const { observePostgresPool } =
      await import("../../src/infrastructure/observability/technical-telemetry.js");
    const metrics = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    const telemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-api",
      environment: "test",
      release: "proof",
      sampleRatio: 1,
      exporters: { spans: new InMemorySpanExporter(), metrics },
    });
    try {
      const root = telemetry.startHttp({ method: "GET", route: "/proof" });
      let previous: { available: boolean } | undefined;
      root.run(() => {
        for (let index = 0; index < 20; index++) {
          if (!overflow && previous !== undefined) previous.available = false;
          const state = { available: true };
          previous = state;
          observePostgresPool(state, () => ({
            available: state.available,
            total: 1,
            idle: 1,
            waiting: 0,
          }));
        }
      });
      root.finish(200, 1);
      await telemetry.flush();
      const values = Object.fromEntries(
        metrics
          .getMetrics()
          .at(-1)
          ?.scopeMetrics.flatMap((scope) => scope.metrics)
          .filter((metric) =>
            metric.descriptor.name.startsWith("inside.postgresql.pool."),
          )
          .map((metric) => [
            metric.descriptor.name,
            metric.dataPoints[0]?.value,
          ]) ?? [],
      );
      expect(values).toEqual({
        "inside.postgresql.pool.registry_overflow": overflow ? 1 : 0,
        "inside.postgresql.pool.available": overflow ? 0 : 1,
        "inside.postgresql.pool.total": overflow ? 0 : 1,
        "inside.postgresql.pool.idle": overflow ? 0 : 1,
        "inside.postgresql.pool.waiting": 0,
      });
    } finally {
      await telemetry.shutdown();
    }
  });
}

test("pool sources belong to their active runtime, including worker scope, and shutdown stops registration", async () => {
  const { observePostgresPool } =
    await import("../../src/infrastructure/observability/technical-telemetry.js");
  const firstMetrics = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  const secondMetrics = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  const first = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "proof",
    sampleRatio: 1,
    exporters: { spans: new InMemorySpanExporter(), metrics: firstMetrics },
  });
  const second = createTechnicalTelemetry({
    enabled: true,
    service: "platform-notifications-worker",
    environment: "test",
    release: "proof",
    sampleRatio: 1,
    exporters: { spans: new InMemorySpanExporter(), metrics: secondMetrics },
  });
  const disabled = createTechnicalTelemetry({ enabled: false });
  let reads = 0;
  try {
    first.runJob(() =>
      observePostgresPool({}, () => {
        reads++;
        return { available: true, total: 2, idle: 1, waiting: 0 };
      }),
    );
    second.runJob(() =>
      observePostgresPool({}, () => ({
        available: true,
        total: 3,
        idle: 1,
        waiting: 1,
      })),
    );
    first.runJob(() =>
      disabled.runJob(() => {
        observePostgresPool({}, () => ({
          available: true,
          total: 100,
          idle: 100,
          waiting: 100,
        }));
        const operation = beginPostgresObservation("query");
        operation.run(() => operation.complete(false, () => undefined));
      }),
    );
    await Promise.all([first.flush(), second.flush()]);
    const total = (metrics: InMemoryMetricExporter) =>
      metrics
        .getMetrics()
        .at(-1)
        ?.scopeMetrics.flatMap((scope) => scope.metrics)
        .find(
          (metric) => metric.descriptor.name === "inside.postgresql.pool.total",
        )?.dataPoints[0]?.value;
    expect(total(firstMetrics)).toBe(2);
    expect(total(secondMetrics)).toBe(3);
    await first.shutdown();
    const stoppedReads = reads;
    first.runJob(() =>
      observePostgresPool({}, () => ({
        available: true,
        total: 4,
        idle: 4,
        waiting: 0,
      })),
    );
    expect(reads).toBe(stoppedReads);
    await second.flush();
    expect(total(secondMetrics)).toBe(3);
  } finally {
    await Promise.all([
      first.shutdown(),
      second.shutdown(),
      disabled.shutdown(),
    ]);
  }
});

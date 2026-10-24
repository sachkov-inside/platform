import { SpanKind } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { afterAll, beforeAll, expect, test, type TestContext } from "vitest";
import type { PoolClient } from "pg";
import { z } from "zod";
import { Prisma } from "../../src/infrastructure/prisma/generated/client.js";
import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";
import { createPrismaPgAdapter } from "../../src/infrastructure/prisma/prisma-adapter.js";
import { createPrismaClient } from "../../src/infrastructure/prisma/create-prisma-client.js";
import { PrismaClientProvider } from "../../src/infrastructure/prisma/prisma.module.js";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { lockMaterialSlugAllocation } from "../../src/infrastructure/prisma/transaction-locks.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { eventually } from "./setup/eventually.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await createMigratedTestDatabase();
});
afterAll(async () => database.dispose());

function proof(context: TestContext, enabled = true) {
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const telemetry = createTechnicalTelemetry({
    enabled,
    service: "platform-api",
    environment: "test",
    release: "proof",
    sampleRatio: 1,
    exporters: { spans, metrics },
  });
  context.onTestFinished(() => telemetry.shutdown());
  return { spans, metrics, telemetry };
}

function sql(text: string) {
  return { sql: text, args: [], argTypes: [] };
}

test("actual adapter statements include transaction control and savepoints exactly once", async (context) => {
  const { spans, telemetry } = proof(context);
  const adapter = await createPrismaPgAdapter(database.url).connect();
  context.onTestFinished(async () => {
    if (!adapter.underlyingDriver().ending) await adapter.dispose();
  });
  const root = telemetry.startHttp({ method: "POST", route: "/proof" });
  await root.run(async () => {
    expect((await adapter.queryRaw(sql("SELECT 7"))).rows).toEqual([[7]]);
    const transaction = await adapter.startTransaction("SERIALIZABLE");
    try {
      if (
        transaction.createSavepoint === undefined ||
        transaction.rollbackToSavepoint === undefined ||
        transaction.releaseSavepoint === undefined
      )
        throw new Error("Pinned adapter must support savepoints");
      expect((await transaction.queryRaw(sql("SELECT 8"))).rows).toEqual([[8]]);
      await transaction.createSavepoint("proof");
      expect((await transaction.queryRaw(sql("SELECT 9"))).rows).toEqual([[9]]);
      await transaction.rollbackToSavepoint("proof");
      await transaction.releaseSavepoint("proof");
      await transaction.executeRaw(sql("COMMIT"));
    } finally {
      await transaction.commit();
    }
  });
  root.finish(200, 1);
  await telemetry.flush();
  expect(
    spans.getFinishedSpans().filter((span) => span.name === "postgresql query"),
  ).toHaveLength(9);
  expect(
    spans
      .getFinishedSpans()
      .filter((span) => span.name === "postgresql acquire"),
  ).toHaveLength(2);
  const rootId = spans
    .getFinishedSpans()
    .find((span) => span.kind === SpanKind.SERVER)
    ?.spanContext().spanId;
  expect(
    spans
      .getFinishedSpans()
      .filter((span) => span.kind === SpanKind.CLIENT)
      .every((span) => span.parentSpanContext?.spanId === rootId),
  ).toBe(true);
});

test("the bounded production pool queues acquisition and preserves acquire/client/release identity", async (context) => {
  const { spans, metrics, telemetry } = proof(context);
  const adapter = await createPrismaPgAdapter(database.url).connect();
  const pool = adapter.underlyingDriver();
  context.onTestFinished(async () => {
    if (!pool.ending) await adapter.dispose();
  });
  const held: PoolClient[] = [];
  let queued: Promise<PoolClient> | undefined;
  let resumed: PoolClient | undefined;
  let lastAcquired: PoolClient | undefined;
  let releases = 0;
  pool.on("acquire", (client) => {
    lastAcquired = client;
  });
  pool.on("release", () => {
    releases++;
  });
  try {
    for (let index = 0; index < 10; index++) held.push(await pool.connect());
    const root = telemetry.startHttp({ method: "GET", route: "/proof" });
    queued = root.run(() => pool.connect());
    await eventually(() => {
      expect(pool.waitingCount).toBe(1);
      return Promise.resolve();
    }, 5_000);
    await telemetry.flush();
    const waiting = metrics
      .getMetrics()
      .at(-1)
      ?.scopeMetrics.flatMap((scope) => scope.metrics)
      .find(
        (metric) => metric.descriptor.name === "inside.postgresql.pool.waiting",
      );
    expect(waiting?.dataPoints).toMatchObject([{ attributes: {}, value: 1 }]);
    held.pop()?.release();
    resumed = await queued;
    expect(resumed).toBe(lastAcquired);
    expect(pool.waitingCount).toBe(0);
    const client = resumed;
    let queryReturn: unknown;
    const callbackRows = new Promise<unknown>((resolve, reject) => {
      queryReturn = root.run(() =>
        client.query("SELECT 12", (error: Error | null, result) => {
          if (error !== null) reject(error);
          else resolve(result.rows);
        }),
      );
    });
    expect(queryReturn).toBeUndefined();
    expect(await callbackRows).toEqual([{ "?column?": 12 }]);
    expect((await root.run(() => client.query("SELECT 13"))).rows).toEqual([
      { "?column?": 13 },
    ]);
    resumed.release();
    resumed = undefined;
    queued = undefined;
    root.finish(200, 1);
    await telemetry.flush();
    expect(
      spans
        .getFinishedSpans()
        .filter((span) => span.name === "postgresql acquire"),
    ).toHaveLength(1);
    expect(
      spans
        .getFinishedSpans()
        .filter((span) => span.name === "postgresql query"),
    ).toHaveLength(2);
  } finally {
    for (const client of held.splice(0)) client.release();
    if (resumed === undefined && queued !== undefined)
      resumed = await queued.catch(() => undefined);
    resumed?.release();
    await adapter.dispose();
  }
  expect(releases).toBe(11);
  await telemetry.flush();
  const available = metrics
    .getMetrics()
    .at(-1)
    ?.scopeMetrics.flatMap((scope) => scope.metrics)
    .find(
      (metric) => metric.descriptor.name === "inside.postgresql.pool.available",
    );
  expect(available?.dataPoints).toMatchObject([{ value: 0 }]);
});

test("production acquisition timeout remains a failed acquisition without a fictitious SQL execution", async (context) => {
  const { spans, telemetry } = proof(context);
  const adapter = await createPrismaPgAdapter(database.url).connect();
  const pool = adapter.underlyingDriver();
  context.onTestFinished(async () => {
    if (!pool.ending) await adapter.dispose();
  });
  const held: PoolClient[] = [];
  try {
    for (let index = 0; index < 10; index++) held.push(await pool.connect());
    const root = telemetry.startHttp({ method: "GET", route: "/proof" });
    const pending = root.run(() => pool.connect());
    const rejected = expect(pending).rejects.toThrow(
      "timeout exceeded when trying to connect",
    );
    await eventually(() => {
      expect(pool.waitingCount).toBe(1);
      return Promise.resolve();
    }, 5_000);
    await rejected;
    root.finish(500, 1);
    await telemetry.flush();
    expect(
      spans
        .getFinishedSpans()
        .filter((span) => span.kind === SpanKind.CLIENT)
        .map((span) => span.attributes),
    ).toEqual([
      {
        "dependency.name": "postgresql",
        "dependency.operation": "acquire",
        "dependency.outcome": "failed",
      },
    ]);
  } finally {
    for (const client of held) client.release();
    await adapter.dispose();
  }
});

for (const owner of ["factory", "nest"] as const) {
  test(`generated Prisma ${owner} preserves commit, rollback and observed reconnect`, async (context) => {
    const { spans, telemetry } = proof(context);
    const prisma =
      owner === "factory"
        ? createPrismaClient(database.url)
        : new PrismaClientProvider(
            parsePlatformConfig({
              NODE_ENV: "test",
              DATABASE_URL: database.url,
            }),
          );
    context.onTestFinished(() => prisma.$disconnect());
    const id =
      owner === "factory"
        ? "10000000-0000-4000-8000-000000000001"
        : "10000000-0000-4000-8000-000000000002";
    const failure = new Error("private-rollback-sentinel");
    const root = telemetry.startHttp({ method: "POST", route: "/proof" });
    await root.run(async () => {
      await prisma.account.create({
        data: {
          id,
          logtoIssuer: "https://private-issuer.invalid",
          logtoSubject: "private-subject-" + owner,
        },
      });
      await expect(
        prisma.$transaction(async (transaction) => {
          await lockMaterialSlugAllocation(transaction);
          await transaction.account.update({
            where: { id },
            data: { logtoSubject: "private-rolled-back" },
          });
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(
        (await prisma.account.findUniqueOrThrow({ where: { id } }))
          .logtoSubject,
      ).toBe("private-subject-" + owner);
      await prisma.$disconnect();
      expect(
        (await prisma.account.findUniqueOrThrow({ where: { id } }))
          .logtoSubject,
      ).toBe("private-subject-" + owner);
    });
    root.finish(200, 1);
    await telemetry.flush();
    expect(
      spans
        .getFinishedSpans()
        .filter((span) => span.name === "postgresql material-slug-lock"),
    ).toHaveLength(1);
    expect(
      spans
        .getFinishedSpans()
        .filter((span) => span.name === "postgresql query").length,
    ).toBeGreaterThan(4);
    expect(
      JSON.stringify(
        spans.getFinishedSpans().map((span) => ({
          attributes: span.attributes,
          events: span.events,
          status: span.status,
        })),
      ),
    ).not.toContain("private-");
  });
}

test("the registered slug lock reports an actual PostgreSQL advisory wait and preserves serialization", async (context) => {
  const { z } = await import("zod");
  const { Prisma } =
    await import("../../src/infrastructure/prisma/generated/client.js");
  const { spans, telemetry } = proof(context);
  const prisma = createPrismaClient(database.url);
  context.onTestFinished(() => prisma.$disconnect());
  let release!: () => void;
  let acquired!: () => void;
  let announcePid!: (pid: number) => void;
  const held = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const canCommit = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiterPid = new Promise<number>((resolve) => {
    announcePid = resolve;
  });
  const order: string[] = [];
  const root = telemetry.startHttp({ method: "POST", route: "/proof" });
  const first = root.run(() =>
    prisma.$transaction(async (transaction) => {
      await lockMaterialSlugAllocation(transaction);
      acquired();
      await canCommit;
      order.push("holder");
    }),
  );
  let second: Promise<void> | undefined;
  try {
    await Promise.race([
      held,
      first.then(() => {
        throw new Error("Holder ended before the lock barrier");
      }),
    ]);
    second = root.run(() =>
      prisma.$transaction(async (transaction) => {
        const rows = z
          .array(z.strictObject({ pid: z.number().int() }))
          .length(1)
          .parse(
            await transaction.$queryRaw(
              Prisma.sql`SELECT pg_backend_pid() AS pid`,
            ),
          );
        const [row] = rows;
        if (row === undefined) throw new Error("Missing own backend PID");
        announcePid(row.pid);
        await lockMaterialSlugAllocation(transaction);
        order.push("waiter");
      }),
    );
    const pid = await Promise.race([
      waiterPid,
      second.then(() => {
        throw new Error("Waiter ended before the PID barrier");
      }),
    ]);
    await eventually(async () => {
      const rows = z
        .array(z.strictObject({ waiting: z.boolean() }))
        .length(1)
        .parse(
          await database.prisma.$queryRaw(Prisma.sql`
        SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity WHERE pid = ${pid}
          AND wait_event_type = 'Lock' AND wait_event = 'advisory') AS waiting
      `),
        );
      expect(rows).toEqual([{ waiting: true }]);
    }, 2_000);
    expect(order).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["holder", "waiter"]);
  } finally {
    release();
    await Promise.allSettled(second === undefined ? [first] : [first, second]);
  }
  root.finish(200, 1);
  await telemetry.flush();
  const locks = spans
    .getFinishedSpans()
    .filter((span) => span.name === "postgresql material-slug-lock");
  expect(locks).toHaveLength(2);
  expect(locks.every((span) => span.kind === SpanKind.INTERNAL)).toBe(true);
  for (const lock of locks) {
    expect(
      spans
        .getFinishedSpans()
        .filter(
          (span) =>
            span.name === "postgresql query" &&
            span.parentSpanContext?.spanId === lock.spanContext().spanId,
        ),
    ).toHaveLength(1);
  }
});

async function ownedAdapter(context: TestContext) {
  const factory = createPrismaPgAdapter(database.url);
  const adapter = await factory.connect();
  const pool = adapter.underlyingDriver();
  context.onTestFinished(async () => {
    if (!pool.ending) await adapter.dispose();
  });
  return { factory, adapter, pool };
}

function nativeCode(error: unknown): string {
  expect(error).toBeInstanceOf(Error);
  return z.object({ code: z.string() }).parse(error).code;
}

test("native PostgreSQL Promise and callback failures retain their contract and private input stays out of telemetry", async (context) => {
  const { spans, telemetry } = proof(context);
  const { pool } = await ownedAdapter(context);
  const root = telemetry.startHttp({ method: "POST", route: "/proof" });
  const client = await root.run(() => pool.connect());
  try {
    const promiseFailure: unknown = await root
      .run(() =>
        client.query("SELECT $1::integer", [
          "private-invalid-integer-sentinel",
        ]),
      )
      .catch((error: unknown) => error);
    expect(nativeCode(promiseFailure)).toBe("22P02");
    let callbackReturn: unknown;
    const callbackFailure = new Promise<unknown>((resolve) => {
      callbackReturn = root.run(() =>
        client.query(
          "SELECT $1::integer",
          ["private-invalid-integer-sentinel"],
          (error: Error | null) => resolve(error),
        ),
      );
    });
    expect(callbackReturn).toBeUndefined();
    expect(nativeCode(await callbackFailure)).toBe("22P02");
    expect((await root.run(() => client.query("SELECT 11"))).rows).toEqual([
      { "?column?": 11 },
    ]);
  } finally {
    client.release();
  }
  root.finish(200, 1);
  await telemetry.flush();
  const queries = spans
    .getFinishedSpans()
    .filter((span) => span.name === "postgresql query");
  expect(queries).toHaveLength(3);
  expect(queries.map((span) => span.attributes["dependency.outcome"])).toEqual([
    "failed",
    "failed",
    "completed",
  ]);
  expect(
    JSON.stringify(
      spans.getFinishedSpans().map((span) => ({
        attributes: span.attributes,
        events: span.events,
        status: span.status,
      })),
    ),
  ).not.toContain("private-");
});

test("terminating the exact waiting backend fails its query once and a subsequent explicit operation acquires a fresh connection", async (context) => {
  const { spans, telemetry } = proof(context);
  const { pool, adapter } = await ownedAdapter(context);
  const root = telemetry.startHttp({ method: "POST", route: "/proof" });
  const client = await root.run(() => pool.connect());
  // PostgreSQL can report socket closure after its FATAL query result. This owned listener prevents an unhandled EventEmitter error.
  client.on("error", () => undefined);
  let released = false;
  let pending: Promise<unknown> | undefined;
  let failure: unknown;
  let releases = 0;
  pool.on("release", () => {
    releases++;
  });
  try {
    const result = await root.run(() =>
      client.query("SELECT pg_backend_pid() AS pid"),
    );
    const [row] = z
      .array(z.strictObject({ pid: z.number().int() }))
      .length(1)
      .parse(result.rows);
    if (row === undefined) throw new Error("Missing own backend PID");
    // The query deliberately blocks at a PostgreSQL wait; elapsed duration is not a readiness signal.
    pending = root
      .run(() => client.query("SELECT pg_sleep(30)"))
      .catch((error: unknown) => {
        failure = error;
        return undefined;
      });
    await eventually(async () => {
      const rows = z
        .array(z.strictObject({ waiting: z.boolean() }))
        .length(1)
        .parse(
          await database.prisma.$queryRaw(Prisma.sql`
        SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity WHERE pid=${row.pid}
          AND state='active' AND wait_event='PgSleep') AS waiting
      `),
        );
      expect(rows).toEqual([{ waiting: true }]);
    }, 2_000);
    const terminated = z
      .array(z.strictObject({ terminated: z.boolean() }))
      .length(1)
      .parse(
        await database.prisma.$queryRaw(
          Prisma.sql`SELECT pg_terminate_backend(${row.pid}) AS terminated`,
        ),
      );
    expect(terminated).toEqual([{ terminated: true }]);
    await pending;
    expect(nativeCode(failure)).toBe("57P01");
    client.release(failure instanceof Error ? failure : undefined);
    released = true;
    expect(
      (await root.run(() => adapter.queryRaw(sql("SELECT 42")))).rows,
    ).toEqual([[42]]);
  } finally {
    if (!released) {
      // An assertion before termination must not leave the deliberate sleep alive.
      client.release(true);
      released = true;
    }
    await pending;
  }
  expect(releases).toBe(2);
  root.finish(200, 1);
  await telemetry.flush();
  const queries = spans
    .getFinishedSpans()
    .filter((span) => span.name === "postgresql query");
  expect(queries).toHaveLength(3);
  expect(queries.map((span) => span.attributes["dependency.outcome"])).toEqual([
    "completed",
    "failed",
    "completed",
  ]);
  expect(
    spans
      .getFinishedSpans()
      .filter((span) => span.name === "postgresql acquire"),
  ).toHaveLength(2);
});

test("a real row deadlock has one native victim and commits exactly the winner's two writes without a retry", async (context) => {
  const { spans, telemetry } = proof(context);
  const { pool } = await ownedAdapter(context);
  const ids = [
    "20000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000002",
  ] as const;
  await database.prisma.account.createMany({
    data: ids.map((id, index) => ({
      id,
      logtoIssuer: "https://private-deadlock.invalid",
      logtoSubject: `private-initial-${index}`,
    })),
  });
  const root = telemetry.startHttp({ method: "POST", route: "/proof" });
  const clients: PoolClient[] = [];
  const finished = new Set<PoolClient>();
  let leftOutcome:
    Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
  let rightOutcome:
    Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
  let releases = 0;
  pool.on("release", () => {
    releases++;
  });
  const finish = (
    client: PoolClient,
    operation: Promise<unknown>,
    done: () => void,
  ) =>
    operation.then(
      async () => {
        await root.run(() => client.query("COMMIT"));
        done();
        return { ok: true } as const;
      },
      async (error: unknown) => {
        await root.run(() => client.query("ROLLBACK"));
        done();
        return { ok: false, error } as const;
      },
    );
  try {
    const left = await root.run(() => pool.connect());
    clients.push(left);
    const right = await root.run(() => pool.connect());
    clients.push(right);
    await root.run(() => left.query("BEGIN"));
    await root.run(() => right.query("BEGIN"));
    const [backend] = z
      .array(z.strictObject({ pid: z.number().int() }))
      .length(1)
      .parse(
        (await root.run(() => left.query("SELECT pg_backend_pid() AS pid")))
          .rows,
      );
    if (backend === undefined) throw new Error("Missing own backend PID");
    await root.run(() =>
      left.query("UPDATE accounts.accounts SET logto_subject=$1 WHERE id=$2", [
        "private-left-a",
        ids[0],
      ]),
    );
    await root.run(() =>
      right.query("UPDATE accounts.accounts SET logto_subject=$1 WHERE id=$2", [
        "private-right-b",
        ids[1],
      ]),
    );
    leftOutcome = finish(
      left,
      root.run(() =>
        left.query(
          "UPDATE accounts.accounts SET logto_subject=$1 WHERE id=$2",
          ["private-left-b", ids[1]],
        ),
      ),
      () => {
        finished.add(left);
      },
    );
    await eventually(async () => {
      const rows = z
        .array(z.strictObject({ waiting: z.boolean() }))
        .length(1)
        .parse(
          await database.prisma.$queryRaw(Prisma.sql`
        SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity WHERE pid=${backend.pid}
          AND wait_event_type='Lock') AS waiting
      `),
        );
      expect(rows).toEqual([{ waiting: true }]);
    }, 2_000);
    rightOutcome = finish(
      right,
      root.run(() =>
        right.query(
          "UPDATE accounts.accounts SET logto_subject=$1 WHERE id=$2",
          ["private-right-a", ids[0]],
        ),
      ),
      () => {
        finished.add(right);
      },
    );
    const outcomes = await Promise.all([leftOutcome, rightOutcome]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    const failures = outcomes.filter((outcome) => !outcome.ok);
    expect(failures).toHaveLength(1);
    for (const outcome of failures)
      expect(nativeCode(outcome.error)).toBe("40P01");
    const rows = await database.prisma.account.findMany({
      where: { id: { in: [...ids] } },
      orderBy: { id: "asc" },
      select: { logtoSubject: true },
    });
    expect(rows.map((row) => row.logtoSubject)).toEqual(
      outcomes[0].ok
        ? ["private-left-a", "private-left-b"]
        : ["private-right-a", "private-right-b"],
    );
  } finally {
    // Right owns the row that can block left before the cycle is formed. Release that owner first on a barrier failure.
    const [left, right] = clients;
    if (right !== undefined && !finished.has(right))
      await right.query("ROLLBACK").catch(() => undefined);
    await Promise.allSettled([leftOutcome, rightOutcome]);
    if (left !== undefined && !finished.has(left))
      await left.query("ROLLBACK").catch(() => undefined);
    for (const client of clients) client.release();
  }
  expect(releases).toBe(2);
  root.finish(200, 1);
  await telemetry.flush();
  const queries = spans
    .getFinishedSpans()
    .filter((span) => span.name === "postgresql query");
  expect(queries).toHaveLength(9);
  expect(
    queries.filter(
      (span) => span.attributes["dependency.outcome"] === "failed",
    ),
  ).toHaveLength(1);
  expect(
    JSON.stringify(
      queries.map((span) => ({
        attributes: span.attributes,
        events: span.events,
        status: span.status,
      })),
    ),
  ).not.toContain("private-");
});

function poolReadings(metrics: InMemoryMetricExporter) {
  return new Map(
    metrics
      .getMetrics()
      .at(-1)
      ?.scopeMetrics.flatMap((scope) => scope.metrics)
      .filter((metric) =>
        metric.descriptor.name.startsWith("inside.postgresql.pool."),
      )
      .map((metric) => [metric.descriptor.name, metric.dataPoints[0]?.value]) ??
      [],
  );
}

function expectPool(
  metrics: InMemoryMetricExporter,
  expected: Readonly<{
    available: number;
    total: number;
    idle: number;
    waiting: number;
    registry_overflow: number;
  }>,
) {
  const readings = poolReadings(metrics);
  for (const key of [
    "available",
    "total",
    "idle",
    "waiting",
    "registry_overflow",
  ] as const)
    expect(readings.get("inside.postgresql.pool." + key)).toBe(expected[key]);
}

test("real pools aggregate only in their runtime and disposal, reconnect and SDK restart have fresh gauges", async (context) => {
  const { metrics, telemetry } = proof(context);
  const first = await ownedAdapter(context),
    second = await ownedAdapter(context);
  const root = telemetry.startHttp({ method: "GET", route: "/proof" });
  const held = new Set<PoolClient>();
  let reconnected:
    Awaited<ReturnType<typeof first.factory.connect>> | undefined;
  const release = (client: PoolClient) => {
    if (held.delete(client)) client.release();
  };
  try {
    await telemetry.flush();
    expectPool(metrics, {
      available: 0,
      total: 0,
      idle: 0,
      waiting: 0,
      registry_overflow: 0,
    });
    const one = await root.run(() => first.pool.connect());
    held.add(one);
    const two = await root.run(() => second.pool.connect());
    held.add(two);
    await telemetry.flush();
    expectPool(metrics, {
      available: 1,
      total: 2,
      idle: 0,
      waiting: 0,
      registry_overflow: 0,
    });
    release(one);
    await first.adapter.dispose();
    await telemetry.flush();
    expectPool(metrics, {
      available: 1,
      total: 1,
      idle: 0,
      waiting: 0,
      registry_overflow: 0,
    });
    reconnected = await first.factory.connect();
    expect(reconnected.underlyingDriver()).not.toBe(first.pool);
    const three = await root.run(() =>
      reconnected?.underlyingDriver().connect(),
    );
    if (three === undefined) throw new Error("Missing reconnected client");
    held.add(three);
    await telemetry.flush();
    expectPool(metrics, {
      available: 1,
      total: 2,
      idle: 0,
      waiting: 0,
      registry_overflow: 0,
    });
    root.finish(200, 1);
    await telemetry.shutdown();
    const next = proof(context);
    await next.telemetry.flush();
    expectPool(next.metrics, {
      available: 0,
      total: 0,
      idle: 0,
      waiting: 0,
      registry_overflow: 0,
    });
    release(three);
    const again = await next.telemetry.runJob(() =>
      reconnected?.underlyingDriver().connect(),
    );
    if (again === undefined) throw new Error("Missing reconnected client");
    held.add(again);
    await next.telemetry.flush();
    expectPool(next.metrics, {
      available: 1,
      total: 1,
      idle: 0,
      waiting: 0,
      registry_overflow: 0,
    });
    release(again);
    await reconnected.dispose();
    await next.telemetry.flush();
    expectPool(next.metrics, {
      available: 0,
      total: 0,
      idle: 0,
      waiting: 0,
      registry_overflow: 0,
    });
  } finally {
    for (const client of held) release(client);
    if (reconnected !== undefined && !reconnected.underlyingDriver().ending)
      await reconnected.dispose();
    if (!first.pool.ending) await first.adapter.dispose();
    if (!second.pool.ending) await second.adapter.dispose();
  }
});

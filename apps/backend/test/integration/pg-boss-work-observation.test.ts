import { eventually } from "./setup/eventually.js";
import { PgBoss, systemClock, type ClockTimer } from "pg-boss";
import { Client } from "pg";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { migrateRuntimeDatabase } from "../../src/migrations/migrate.js";
import { jobQueues } from "../../src/infrastructure/job-queues.js";
import { PgBossQueueDiagnostics } from "../../src/infrastructure/pg-boss-queue-diagnostics.js";
import { PgBossWorkObservation } from "../../src/infrastructure/pg-boss-work-observation.js";
import { observeJob } from "../../src/infrastructure/observability/process-log.js";
import { acquireWorkerGenerationLease } from "../../src/infrastructure/worker-runtime.js";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const queue = jobQueues.paymentRecovery;
const identity = { release: "v1566", sourceSha: "a".repeat(40) };
let database: TestDatabase;
let boss: PgBoss;
const sources = new Set<PgBossWorkObservation>();
beforeEach(async () => {
  database = await createMigratedTestDatabase();
  await migrateRuntimeDatabase(database.url);
  boss = new PgBoss({
    connectionString: database.url,
    schema: "pgboss",
    createSchema: false,
    migrate: false,
    schedule: false,
    supervise: false,
  });
  await boss.start();
  await boss.createQueue(queue, {
    retryLimit: 2,
    retryDelay: 0,
    retryBackoff: false,
    deleteAfterSeconds: 60,
  });
  await database.prisma.$executeRaw(
    Prisma.sql`create table public.queue_work_fixture(id text primary key)`,
  );
});
afterEach(async () => {
  try {
    await boss.stop({ close: true, graceful: true });
  } finally {
    for (const work of sources) await work.close();
    sources.clear();
    await database.dispose();
  }
});

async function activeJob() {
  const job = (await boss.fetch(queue, { includeMetadata: true }))[0];
  if (job === undefined) throw new Error("Expected an actual fetched job");
  return job;
}
async function observation() {
  for (const work of sources) await work.flush();
  const report = await new PgBossQueueDiagnostics(database.prisma).read();
  if (!report.ok)
    throw new Error("Expected available queue observation source");
  const row = report.value.queues.find((item) => item.name === queue);
  if (row === undefined) throw new Error("Expected fixed queue");
  expect(JSON.stringify(report)).not.toContain("private-");
  return row.lastSuccessfulWork;
}
function source() {
  const work = new PgBossWorkObservation(
    database.prisma,
    identity,
    "billing-worker",
  );
  sources.add(work);
  return work;
}
async function record(
  work: PgBossWorkObservation,
  ...args: Parameters<PgBossWorkObservation["completed"]>
) {
  work.completed(...args);
  await work.flush();
}

it("commits handler proof before ACK and retains it across native history deletion and process reconnection", async () => {
  expect(await observation()).toMatchObject({
    status: "unknown",
    reason: "no_history",
  });
  await boss.send(queue, { private: "private-job-payload" });
  const job = await activeJob();
  const result = { ok: true, private: "private-output" };
  const handler = observeJob(
    "billing-worker",
    queue,
    async () => {
      await database.prisma.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`insert into public.queue_work_fixture(id) values('once') on conflict do nothing`,
        );
      });
      return result;
    },
    undefined,
    source(),
  );
  expect(await handler([job])).toBe(result);
  const work = await observation();
  expect(work).toMatchObject({
    status: "known",
    meaning: "handler_result_committed",
    release: identity,
    nativeAck: "not_proven",
    externalEffect: "not_proven",
  });
  expect((await boss.findJobs(queue, { id: job.id }))[0]?.state).toBe("active");
  await boss.complete(queue, job, result);
  await boss.deleteJob(queue, job.id);
  expect(await boss.findJobs(queue, { id: job.id })).toEqual([]);
  await boss.stop({ close: true, graceful: true });
  await database.prisma.$disconnect();
  expect(await observation()).toMatchObject({
    status: "known",
    at: work.at,
    release: identity,
  });
});

it("failed work and health reads create no history; an unacknowledged success may retry without falsifying external success", async () => {
  const lines = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await boss.send(queue, {});
    const first = await activeJob();
    const failed = observeJob(
      "billing-worker",
      queue,
      () => Promise.reject(new Error("fixture_failed")),
      undefined,
      source(),
    );
    await expect(failed([first])).rejects.toThrow("fixture_failed");
    await new PgBossQueueDiagnostics(database.prisma).read();
    expect(await observation()).toMatchObject({ status: "unknown" });
    await boss.fail(queue, first, {});
    await record(source(), queue, [first]);
    expect(await observation()).toMatchObject({ status: "unknown" });
    const retry = await activeJob();
    expect(retry.retryCount).toBeGreaterThan(first.retryCount);
    const success = observeJob(
      "billing-worker",
      queue,
      async () => {
        await database.prisma.$executeRaw(
          Prisma.sql`insert into public.queue_work_fixture(id) values('once') on conflict do nothing`,
        );
      },
      undefined,
      source(),
    );
    await success([retry]);
    const receipt = await observation();
    expect(receipt).toMatchObject({ status: "known", nativeAck: "not_proven" });
    // Model a lost ACK after actual handler/observer commit. Native recovery retries it.
    await boss.fail(queue, retry, {});
    const recovered = await activeJob();
    await record(source(), queue, [retry]); // Old attempt is no longer active.
    expect((await observation()).at).toBe(receipt.at);
    await success([recovered]);
    await boss.complete(queue, recovered);
    expect(
      await database.prisma.$queryRaw(
        Prisma.sql`select count(*)::integer as count from public.queue_work_fixture`,
      ),
    ).toEqual([{ count: 1 }]);
    expect(await observation()).toMatchObject({
      status: "known",
      nativeAck: "not_proven",
      externalEffect: "not_proven",
    });
  } finally {
    lines.mockRestore();
  }
});

it("duplicate completion observations are idempotent and concurrent jobs retain one latest queue row", async () => {
  await boss.send(queue, {});
  await boss.send(queue, {});
  const first = await activeJob();
  const second = await activeJob();
  const work = source();
  await record(work, queue, [first]);
  const initial = await observation();
  const duplicate = new PgBossWorkObservation(
    database.prisma,
    { release: "v1567", sourceSha: "b".repeat(40) },
    "billing-worker",
  );
  sources.add(duplicate);
  await record(duplicate, queue, [first]);
  expect(await observation()).toMatchObject({
    at: initial.at,
    release: identity,
  });
  work.completed(queue, [first]);
  expect(() => work.completed(queue, [second])).toThrow(
    "queue_work_buffer_full",
  );
  await work.flush();
  await record(work, queue, [second]);
  expect(await database.prisma.queueWorkObservation.count()).toBe(1);
  await boss.complete(queue, first);
  await boss.complete(queue, second);
  expect(await observation()).toMatchObject({ status: "known" });
});

it("keeps old handler work explicitly stale and preserves UNKNOWN when an observer write fails", async () => {
  await boss.send(queue, {});
  const first = await activeJob();
  await database.prisma.$executeRaw(
    Prisma.sql`alter table queue_observation.last_successful_handler rename to temporarily_unavailable`,
  );
  const lines = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const handler = observeJob(
      "billing-worker",
      queue,
      () => Promise.resolve("business_result"),
      undefined,
      source(),
    );
    expect(await handler([first])).toBe("business_result");
    for (const work of sources) await work.flush();
  } finally {
    lines.mockRestore();
    await database.prisma.$executeRaw(
      Prisma.sql`alter table queue_observation.temporarily_unavailable rename to last_successful_handler`,
    );
  }
  expect(await observation()).toMatchObject({ status: "unknown" });
  await record(source(), queue, [first]);
  await database.prisma.$executeRaw(
    Prisma.sql`update queue_observation.last_successful_handler set handler_returned_at=clock_timestamp()-interval '301 seconds',recorded_at=clock_timestamp()-interval '300 seconds'`,
  );
  expect(await observation()).toMatchObject({
    status: "known",
    freshness: "stale",
  });
});

it("uses the existing generation lease and refuses wrong owners or non-current attempts", async () => {
  const lease = await acquireWorkerGenerationLease(
    database.url,
    "billing-worker",
  );
  try {
    await expect(
      acquireWorkerGenerationLease(database.url, "billing-worker"),
    ).rejects.toThrow("Another billing-worker generation");
    await boss.send(queue, {});
    const job = await activeJob();
    expect(() =>
      new PgBossWorkObservation(
        database.prisma,
        identity,
        "material-assets-worker",
      ).completed(queue, [job]),
    ).toThrow("queue_work_owner");
    expect(() => source().completed(queue, [job, job])).toThrow();
    await record(source(), queue, [{ ...job, retryCount: job.retryCount + 1 }]);
    expect(await observation()).toMatchObject({ status: "unknown" });
    await record(source(), queue, [job]);
  } finally {
    await lease.release();
  }
  const next = await acquireWorkerGenerationLease(
    database.url,
    "billing-worker",
  );
  try {
    expect(await observation()).toMatchObject({
      status: "known",
      release: identity,
    });
  } finally {
    await next.release();
  }
});

it("keeps the durable source finite and rejects foreign queues and future facts instead of exporting partial success", async () => {
  await boss.send(queue, {});
  const job = await activeJob();
  await record(source(), queue, [job]);
  const count = await database.prisma.queueWorkObservation.count();
  const client = new Client({ connectionString: database.url });
  await client.connect();
  try {
    await expect(
      client.query(
        `insert into queue_observation.last_successful_handler(queue_name,worker_name,handler_returned_at,recorded_at,release,source_sha,attempt_key)
       values($1,$2,clock_timestamp(),clock_timestamp(),$3,$4,$5)`,
        [
          "foreign-private-queue",
          "billing-worker",
          identity.release,
          identity.sourceSha,
          "b".repeat(64),
        ],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "queue_work_name",
    });
  } finally {
    await client.end();
  }
  expect(await database.prisma.queueWorkObservation.count()).toBe(count);
  await database.prisma.$executeRaw(
    Prisma.sql`update queue_observation.last_successful_handler set recorded_at=clock_timestamp()+interval '1 hour'`,
  );
  const lines = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(await new PgBossQueueDiagnostics(database.prisma).read()).toEqual({
      ok: false,
      coverage: "unknown",
      error: { code: "source_unavailable" },
    });
  } finally {
    lines.mockRestore();
  }
});

it("actual native work ACK is not held behind a blocked diagnostic writer at the original handler deadline", async () => {
  await boss.stop({ close: true, graceful: true });
  const expirations = new Map<ClockTimer, () => void>();
  boss = new PgBoss({
    connectionString: database.url,
    schema: "pgboss",
    createSchema: false,
    migrate: false,
    schedule: false,
    supervise: false,
    clock: {
      ...systemClock,
      setTimeout(fn, ms) {
        if (ms !== 1000) return systemClock.setTimeout(fn, ms);
        const handle = {};
        expirations.set(handle, fn);
        return handle;
      },
      clearTimeout(handle) {
        if (!expirations.delete(handle)) systemClock.clearTimeout(handle);
      },
    },
  });
  boss.on("error", () => undefined);
  await boss.start();
  await boss.updateQueue(queue, { expireInSeconds: 1 });
  const lock = new Client({ connectionString: database.url });
  await lock.connect();
  const lines = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await lock.query("begin");
    await lock.query(
      "lock table queue_observation.last_successful_handler in access exclusive mode",
    );
    const id = await boss.send(queue, {});
    if (id === null) throw new Error("Expected owned job");
    let businessSucceeded = false;
    await boss.work(
      queue,
      { pollingIntervalSeconds: 0.5 },
      observeJob(
        "billing-worker",
        queue,
        async () => {
          await database.prisma.$executeRaw(
            Prisma.sql`insert into public.queue_work_fixture(id) values('native-work')`,
          );
          businessSucceeded = true;
          return "business_result";
        },
        undefined,
        source(),
      ),
    );
    // PostgreSQL is real. Only the public native timer port is controlled: expire it while
    // the observer is actually blocked, after the business transaction already committed.
    await eventually(async () => {
      await lock.query("select pg_stat_clear_snapshot()");
      const pending = await lock.query<{
        n: number;
      }>(`select count(*)::integer as n from pg_stat_activity
        where datname=current_database() and wait_event_type='Lock'
        and query like '%insert into queue_observation.last_successful_handler%'`);
      expect(pending.rows[0]).toEqual({ n: 1 });
    }, 30000);
    expect(businessSucceeded).toBe(true);
    for (const fire of [...expirations.values()]) fire();
    let state: string | undefined;
    await eventually(async () => {
      state = (await boss.findJobs(queue, { id }))[0]?.state;
      expect(state).not.toBe("active");
    }, 30000);
    expect(state).toBe("completed");
  } finally {
    await lock.query("rollback");
    await lock.end();
    lines.mockRestore();
  }
  expect(await observation()).toMatchObject({
    status: "known",
    clock: "process_wall_clock",
    nativeAck: "not_proven",
  });
});

it("shutdown owns its bounded observation task, discards unrecorded work and stops admission", async () => {
  await boss.send(queue, {});
  const job = await activeJob();
  const work = source();
  work.completed(queue, [job]);
  expect(() => work.completed(queue, [job])).toThrow("queue_work_buffer_full");
  await work.close();
  expect(() => work.completed(queue, [job])).toThrow("queue_work_closed");
  expect(await observation()).toMatchObject({
    status: "unknown",
    reason: "no_history",
  });
  expect((await boss.findJobs(queue, { id: job.id }))[0]?.state).toBe("active");
});

it("the diagnostic writer never locks native ACK behind its own receipt row", async () => {
  await boss.send(queue, {});
  const previous = await activeJob();
  await record(source(), queue, [previous]);
  await boss.complete(queue, previous);
  await boss.send(queue, {});
  const current = await activeJob();
  const lock = new Client({ connectionString: database.url });
  await lock.connect();
  const lines = vi.spyOn(console, "error").mockImplementation(() => undefined);
  async function waiting() {
    await lock.query("select pg_stat_clear_snapshot()");
    const result = await lock.query<{
      n: number;
    }>(`select count(*)::integer as n from pg_stat_activity
      where datname=current_database() and wait_event_type='Lock'
      and query like '%insert into queue_observation.last_successful_handler%'`);
    return result.rows[0];
  }
  try {
    await lock.query("begin");
    await lock.query(
      "select queue_name from queue_observation.last_successful_handler for update",
    );
    source().completed(queue, [current]);
    await eventually(async () => {
      expect(await waiting()).toEqual({ n: 1 });
    }, 30000);
    expect(await boss.complete(queue, current)).toMatchObject({ affected: 1 });
    // ACK completed while the diagnostic write is still waiting on only its own row.
    expect(await waiting()).toEqual({ n: 1 });
  } finally {
    await lock.query("rollback");
    await lock.end();
    lines.mockRestore();
  }
  expect(await observation()).toMatchObject({
    status: "known",
    nativeAck: "not_proven",
  });
});

it("background observation cannot create PostgreSQL children after its business span ended", async () => {
  const { InMemorySpanExporter } =
    await import("@opentelemetry/sdk-trace-base");
  const { InMemoryMetricExporter, AggregationTemporality } =
    await import("@opentelemetry/sdk-metrics");
  const { createTechnicalTelemetry } =
    await import("../../src/infrastructure/observability/technical-telemetry.js");
  const spans = new InMemorySpanExporter();
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-billing-worker",
    environment: "test",
    release: identity.sourceSha,
    sampleRatio: 1,
    exporters: {
      spans,
      metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    },
  });
  try {
    await boss.send(queue, {});
    const job = await activeJob();
    const root = telemetry.startHttp({ method: "GET", route: "/pilot" });
    const handler = observeJob(
      "billing-worker",
      queue,
      async () => {
        await database.prisma.$executeRaw(
          Prisma.sql`insert into public.queue_work_fixture(id) values('business-span')`,
        );
      },
      undefined,
      source(),
    );
    await root.run(() => handler([job]));
    root.finish(200, 1);
    for (const work of sources) await work.flush();
    await telemetry.flush();
    // Exactly the business SQL belongs to this ended operation. Observation SQL is outside it.
    expect(
      spans
        .getFinishedSpans()
        .filter((span) => span.name === "postgresql query"),
    ).toHaveLength(1);
    expect(await observation()).toMatchObject({ status: "known" });
  } finally {
    await telemetry.shutdown();
  }
});

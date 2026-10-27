import { PgBoss } from "pg-boss";
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
    await database.dispose();
  }
});

async function activeJob() {
  const job = (await boss.fetch(queue, { includeMetadata: true }))[0];
  if (job === undefined) throw new Error("Expected an actual fetched job");
  return job;
}
async function observation() {
  const report = await new PgBossQueueDiagnostics(database.prisma).read();
  if (!report.ok)
    throw new Error("Expected available queue observation source");
  const row = report.value.queues.find((item) => item.name === queue);
  if (row === undefined) throw new Error("Expected fixed queue");
  expect(JSON.stringify(report)).not.toContain("private-");
  return row.lastSuccessfulWork;
}
function source() {
  return new PgBossWorkObservation(database.prisma, identity, "billing-worker");
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
    await source().completed(queue, [first]);
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
    await source().completed(queue, [retry]); // Old attempt is no longer active.
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
  await work.completed(queue, [first]);
  const initial = await observation();
  await new PgBossWorkObservation(
    database.prisma,
    { release: "v1567", sourceSha: "b".repeat(40) },
    "billing-worker",
  ).completed(queue, [first]);
  expect(await observation()).toMatchObject({
    at: initial.at,
    release: identity,
  });
  await Promise.all([
    work.completed(queue, [first]),
    work.completed(queue, [second]),
  ]);
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
  } finally {
    lines.mockRestore();
    await database.prisma.$executeRaw(
      Prisma.sql`alter table queue_observation.temporarily_unavailable rename to last_successful_handler`,
    );
  }
  expect(await observation()).toMatchObject({ status: "unknown" });
  await source().completed(queue, [first]);
  await database.prisma.$executeRaw(
    Prisma.sql`update queue_observation.last_successful_handler set recorded_at=clock_timestamp()-interval '301 seconds'`,
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
    await expect(
      new PgBossWorkObservation(
        database.prisma,
        identity,
        "material-assets-worker",
      ).completed(queue, [job]),
    ).rejects.toThrow("queue_work_owner");
    await expect(source().completed(queue, [job, job])).rejects.toThrow();
    await source().completed(queue, [
      { ...job, retryCount: job.retryCount + 1 },
    ]);
    expect(await observation()).toMatchObject({ status: "unknown" });
    await source().completed(queue, [job]);
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
  await source().completed(queue, [job]);
  const count = await database.prisma.queueWorkObservation.count();
  const client = new Client({ connectionString: database.url });
  await client.connect();
  try {
    await expect(
      client.query(
        `insert into queue_observation.last_successful_handler(queue_name,worker_name,recorded_at,release,source_sha,attempt_key)
       values($1,$2,clock_timestamp(),$3,$4,$5)`,
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

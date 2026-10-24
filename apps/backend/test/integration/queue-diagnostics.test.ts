import { QueueDiagnostics } from "../../src/entrypoints/mcp/queue-diagnostics.js";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { vi } from "vitest";
import { afterEach, beforeEach, expect, it } from "vitest";
import { migrateRuntimeDatabase } from "../../src/migrations/migrate.js";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { PgBossQueueDiagnostics } from "../../src/infrastructure/pg-boss-queue-diagnostics.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

let database: TestDatabase;
beforeEach(async () => {
  database = await createMigratedTestDatabase();
  await migrateRuntimeDatabase(database.url);
});
afterEach(async () => {
  await database.dispose();
});

it("distinguishes an absent queue from a registered empty queue without starting pg-boss", async () => {
  const diagnostics = new PgBossQueueDiagnostics(database.prisma);
  const report = await diagnostics.read();
  expect(report).toMatchObject({
    ok: true,
    value: { workerFreshness: "not_proven", lastSuccessfulWorkAt: null },
  });
  if (!report.ok) throw new Error("Expected available fixture source");
  expect(report.value.queues).toHaveLength(10);
  expect(
    report.value.queues.find((row) => row.name === "material-assets.cleanup"),
  ).toEqual({
    name: "material-assets.cleanup",
    status: "unknown",
    reason: "queue_not_registered",
  });
  await database.prisma.$executeRaw(Prisma.sql`
    insert into pgboss.queue (name, policy, retry_limit, retry_delay, retry_backoff, expire_seconds, retention_seconds, deletion_seconds, partition, table_name)
    values ('material-assets.cleanup', 'standard', 5, 30, true, 300, 86400, 86400, false, 'job_common')
  `);
  const empty = await diagnostics.read();
  if (!empty.ok) throw new Error("Expected available fixture source");
  expect(
    empty.value.queues.find((row) => row.name === "material-assets.cleanup"),
  ).toEqual({
    name: "material-assets.cleanup",
    status: "known",
    states: {
      created: 0,
      retry: 0,
      active: 0,
      completed: 0,
      cancelled: 0,
      failed: 0,
    },
    backlog: 0,
    ready: 0,
    scheduled: 0,
    blocked: 0,
    retrying: 0,
    retainedRetryAttempts: 0,
    oldestBacklogAgeSeconds: null,
  });
});

it("reports retained states, delayed/blocked backlog and retries without payloads", async () => {
  await database.prisma.$executeRaw(Prisma.sql`
    insert into pgboss.queue (name, policy, retry_limit, retry_delay, retry_backoff, expire_seconds, retention_seconds, deletion_seconds, partition, table_name)
    values ('material-assets.cleanup', 'standard', 5, 30, true, 300, 86400, 86400, false, 'job_common')
  `);
  await database.prisma.$executeRaw(Prisma.sql`
    insert into pgboss.job (name,state,retry_count,created_on,start_after,blocked,data,output)
    values
      ('material-assets.cleanup','created',0,'2020-01-02T00:00:00Z','2020-01-02T00:00:00Z',false,'{"private":"secret-payload"}','{"private":"secret-output"}'),
      ('material-assets.cleanup','created',0,'2020-01-02T00:00:00Z','9999-01-01T00:00:00Z',false,null,null),
      ('material-assets.cleanup','created',0,'2020-01-01T00:00:00Z','2020-01-01T00:00:00Z',true,null,null),
      ('material-assets.cleanup','retry',2,'2020-01-02T00:00:00Z','2020-01-02T00:00:00Z',false,null,null),
      ('material-assets.cleanup','active',1,'2020-01-02T00:00:00Z','2020-01-02T00:00:00Z',false,null,null),
      ('material-assets.cleanup','completed',3,'2020-01-02T00:00:00Z','2020-01-02T00:00:00Z',false,null,null),
      ('material-assets.cleanup','cancelled',0,'2020-01-02T00:00:00Z','2020-01-02T00:00:00Z',false,null,null),
      ('material-assets.cleanup','failed',4,'2020-01-02T00:00:00Z','2020-01-02T00:00:00Z',false,null,null)
  `);
  const report = await new PgBossQueueDiagnostics(database.prisma).read();
  if (!report.ok) throw new Error("Expected available fixture source");
  const queue = report.value.queues.find(
    (row) => row.name === "material-assets.cleanup",
  );
  if (queue?.status !== "known")
    throw new Error("Expected registered fixture queue");
  expect(queue).toMatchObject({
    name: "material-assets.cleanup",
    status: "known",
    states: {
      created: 3,
      retry: 1,
      active: 1,
      completed: 1,
      cancelled: 1,
      failed: 1,
    },
    backlog: 4,
    ready: 2,
    scheduled: 1,
    blocked: 1,
    retrying: 2,
    retainedRetryAttempts: 10,
  });
  expect(queue.oldestBacklogAgeSeconds).toBeCloseTo(
    (Date.parse(report.value.asOf) - Date.parse("2020-01-01T00:00:00Z")) / 1000,
    2,
  );
  expect(JSON.stringify(report)).not.toContain("secret-");
});

it("refuses incompatible schema instead of interpreting rows with an unverified contract", async () => {
  await database.prisma.$executeRaw(
    Prisma.sql`update pgboss.version set version = -1`,
  );
  expect(await new PgBossQueueDiagnostics(database.prisma).read()).toEqual({
    ok: false,
    coverage: "unknown",
    error: { code: "schema_mismatch" },
  });
});

it("reports a missing source as unknown and never creates a queue schema", async () => {
  await database.prisma.$executeRaw(Prisma.sql`drop schema pgboss cascade`);
  expect(await new PgBossQueueDiagnostics(database.prisma).read()).toEqual({
    ok: false,
    coverage: "unknown",
    error: { code: "source_unavailable" },
  });
  expect(
    await database.prisma.$queryRaw(
      Prisma.sql`select to_regnamespace('pgboss')::text as name`,
    ),
  ).toEqual([{ name: null }]);
});

it("returns unknown when a queue metadata read exceeds the statement budget", async () => {
  let signalLocked!: () => void;
  let releaseLock!: () => void;
  const locked = new Promise<void>((resolve) => {
    signalLocked = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const locker = database.run(() =>
    database.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(
        Prisma.sql`lock table pgboss.queue in access exclusive mode`,
      );
      signalLocked();
      await release;
    }),
  );
  try {
    await locked;
    expect(await new PgBossQueueDiagnostics(database.prisma).read()).toEqual({
      ok: false,
      coverage: "unknown",
      error: { code: "source_unavailable" },
    });
  } finally {
    releaseLock();
    await locker;
  }
});

it("checks durable platform:admin permission and revocation before accessing private source", async () => {
  const actor = "10000000-0000-4000-8000-000000000001";
  await database.prisma.account.create({
    data: {
      id: actor,
      logtoIssuer: "https://queues.example.test",
      logtoSubject: actor,
    },
  });
  const accounts = assembleAccounts({
    prisma: database.prisma,
    emailFingerprintKey: "synthetic-queue-diagnostic-fingerprint",
  });
  const source = new PgBossQueueDiagnostics(database.prisma);
  const read = vi.spyOn(source, "read");
  const diagnostics = new QueueDiagnostics(accounts, source);
  expect(await diagnostics.read(actor, {})).toEqual({
    ok: false,
    error: { code: "forbidden" },
  });
  expect(read).not.toHaveBeenCalled();
  await database.prisma.accountPermission.create({
    data: { accountId: actor, permission: "platform:admin" },
  });
  expect(await diagnostics.read(actor, {})).toMatchObject({ ok: true });
  expect(read).toHaveBeenCalledTimes(1);
  await database.prisma.accountPermission.deleteMany({
    where: { accountId: actor },
  });
  expect(await diagnostics.read(actor, {})).toEqual({
    ok: false,
    error: { code: "forbidden" },
  });
  expect(read).toHaveBeenCalledTimes(1);
});

import { registerFixedClock } from "../support/fixed-clock.js";
import { z } from "zod";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  Prisma,
  type ReadingActivityPrismaClient,
  type BookmarksPrismaClient,
} from "../../src/infrastructure/prisma/index.js";
import { ReadingActivityRetention } from "../../src/modules/reading-activity/index.js";
import { BookmarkActivityRetention } from "../../src/modules/bookmarks/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
registerFixedClock();
let database: TestDatabase;
beforeEach(async () => {
  database = await createMigratedTestDatabase();
});
afterEach(async () => {
  await database.dispose();
});
it("deletes one bounded batch per owner and reports a real remaining oldest expired row", async () => {
  await database.prisma.$executeRaw(
    Prisma.sql`insert into reading_activity.learning_started_events(event_id,account_id,product_id,command_id,occurred_at) select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),transaction_timestamp()-interval '366 days' from generate_series(1,1001)`,
  );
  await database.prisma.$executeRaw(
    Prisma.sql`insert into bookmarks.activity_events(event_id,account_id,material_id,event_type,occurred_at) select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'bookmark_added',transaction_timestamp()-interval '366 days' from generate_series(1,1001)`,
  );
  for (const owner of [
    new ReadingActivityRetention(database.prisma),
    new BookmarkActivityRetention(database.prisma),
  ]) {
    const first = await owner.clean();
    expect(first).toMatchObject({
      ok: true,
      value: {
        status: "known",
        removed: 1000,
        hasMore: true,
      },
    });
    if (!first.ok) throw new Error(first.error.code);
    expect(first.value.lagSeconds).toBeGreaterThan(0);
    expect(await owner.clean()).toMatchObject({
      ok: true,
      value: {
        removed: 1,
        hasMore: false,
        oldestExpiredAt: null,
        lagSeconds: null,
      },
    });
    expect(await owner.clean()).toMatchObject({
      ok: true,
      value: { removed: 0, hasMore: false },
    });
    expect(await owner.status()).toMatchObject({
      ok: true,
      value: { status: "known", hasMore: false },
    });
  }
});
it("uses the exact PostgreSQL transaction cutoff, preserving equality including microseconds", async () => {
  const reading: Pick<ReadingActivityPrismaClient, "$transaction"> = {
    $transaction: (operation, options) =>
      database.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw(
          Prisma.sql`insert into reading_activity.learning_started_events(event_id,account_id,product_id,command_id,occurred_at) select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),transaction_timestamp()-interval '31536000 seconds'+delta from unnest(array[interval '-1 microsecond',interval '0 seconds',interval '1 microsecond']) delta`,
        );
        return operation(transaction);
      }, options),
  };
  const bookmarks: Pick<BookmarksPrismaClient, "$transaction"> = {
    $transaction: (operation, options) =>
      database.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw(
          Prisma.sql`insert into bookmarks.activity_events(event_id,account_id,material_id,event_type,occurred_at) select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'bookmark_added',transaction_timestamp()-interval '31536000 seconds'+delta from unnest(array[interval '-1 microsecond',interval '0 seconds',interval '1 microsecond']) delta`,
        );
        return operation(transaction);
      }, options),
  };
  for (const owner of [
    new ReadingActivityRetention(reading),
    new BookmarkActivityRetention(bookmarks),
  ])
    expect(await owner.clean()).toMatchObject({
      ok: true,
      value: { removed: 1, hasMore: false },
    });
  expect(
    await database.prisma.$queryRaw(
      Prisma.sql`select count(*)::int as retained from reading_activity.learning_started_events`,
    ),
  ).toEqual([{ retained: 2 }]);
  expect(
    await database.prisma.$queryRaw(
      Prisma.sql`select count(*)::int as retained from bookmarks.activity_events`,
    ),
  ).toEqual([{ retained: 2 }]);
});
it("concurrent batches conserve rows and a failed transaction rolls back before the next pass", async () => {
  await database.prisma.$executeRaw(
    Prisma.sql`insert into bookmarks.activity_events(event_id,account_id,material_id,event_type,occurred_at) select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'bookmark_added',transaction_timestamp()-interval '366 days' from generate_series(1,1500)`,
  );
  const owner = new BookmarkActivityRetention(database.prisma);
  const results = await Promise.all([owner.clean(), owner.clean()]);
  let removed = 0;
  for (const result of results) {
    if (!result.ok) throw new Error(result.error.code);
    removed += result.value.removed ?? 0;
    expect(result.value.removed).toBeLessThanOrEqual(1000);
  }
  expect(removed).toBe(1500);
  expect(await owner.status()).toMatchObject({
    ok: true,
    value: { hasMore: false },
  });
  await database.prisma.$executeRaw(
    Prisma.sql`insert into bookmarks.activity_events(event_id,account_id,material_id,event_type,occurred_at) values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'bookmark_removed',transaction_timestamp()-interval '366 days')`,
  );
  const failing: Pick<BookmarksPrismaClient, "$transaction"> = {
    $transaction: (operation, options) =>
      database.prisma.$transaction(async (transaction) => {
        await operation(transaction);
        throw new Error("owned precommit failure");
      }, options),
  };
  expect(await new BookmarkActivityRetention(failing).clean()).toMatchObject({
    ok: false,
    status: "unknown",
  });
  expect(await owner.status()).toMatchObject({
    ok: true,
    value: { hasMore: true },
  });
  expect(await owner.clean()).toMatchObject({
    ok: true,
    value: { removed: 1, hasMore: false },
  });
});
it("reports unknown on a real statement deadline and releases ownership before recovery", async () => {
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
        Prisma.sql`lock table bookmarks.activity_events in access exclusive mode`,
      );
      signalLocked();
      await release;
    }),
  );
  const owner = new BookmarkActivityRetention(database.prisma);
  try {
    await locked;
    expect(await owner.clean()).toMatchObject({
      ok: false,
      status: "unknown",
      error: { code: "source_unavailable" },
    });
  } finally {
    releaseLock();
    await locker;
  }
  expect(await owner.status()).toMatchObject({
    ok: true,
    value: { hasMore: false },
  });
});

it("uses database time despite application-clock skew and keeps a current copy", async () => {
  const clock = z.array(z.object({ at: z.iso.datetime() })).length(1);
  const before = clock.parse(
    await database.prisma.$queryRaw(
      Prisma.sql`select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at`,
    ),
  )[0];
  if (before === undefined) throw new Error("DB clock absent");
  await database.prisma.$executeRaw(
    Prisma.sql`insert into bookmarks.activity_events(event_id,account_id,material_id,event_type,occurred_at) values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'bookmark_added',transaction_timestamp())`,
  );
  vi.setSystemTime(new Date("2099-01-01T00:00:00Z"));
  const result = await new BookmarkActivityRetention(database.prisma).clean();
  if (!result.ok) throw new Error(result.error.code);
  const after = clock.parse(
    await database.prisma.$queryRaw(
      Prisma.sql`select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at`,
    ),
  )[0];
  if (after === undefined) throw new Error("DB clock absent");
  expect(result.value.removed).toBe(0);
  expect(result.value.asOf >= before.at && result.value.asOf <= after.at).toBe(
    true,
  );
  expect(
    await database.prisma.$queryRaw(
      Prisma.sql`select count(*)::int as retained from bookmarks.activity_events`,
    ),
  ).toEqual([{ retained: 1 }]);
});
it("persists a real PgBoss partial failure, projects only its report, and continues idempotently", async () => {
  const { PgBoss } = await import("pg-boss");
  const { migrateRuntimeDatabase } =
    await import("../../src/migrations/migrate.js");
  const { PgBossQueueDiagnostics } =
    await import("../../src/infrastructure/pg-boss-queue-diagnostics.js");
  const { runActivityRetentionJob } =
    await import("../../src/entrypoints/billing-worker/jobs.js");
  await migrateRuntimeDatabase(database.url);
  const queue = "membership-activity.retention";
  const jobs = new PgBoss({
    connectionString: database.url,
    openTelemetry: { enabled: false },
    createSchema: false,
    migrate: false,
    schema: "pgboss",
  });
  let renamed = false;
  try {
    await jobs.start();
    await jobs.createQueue(queue, {
      retryLimit: 0,
      deleteAfterSeconds: 86400,
      expireInSeconds: 300,
    });
    const diagnostics = new PgBossQueueDiagnostics(database.prisma);
    expect(await diagnostics.readActivityRetentionLastPass()).toMatchObject({
      ok: false,
      error: { code: "no_retained_pass" },
    });
    await database.prisma.$executeRaw(
      Prisma.sql`insert into reading_activity.learning_started_events(event_id,account_id,product_id,command_id,occurred_at) values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),transaction_timestamp()-interval '366 days')`,
    );
    await database.prisma.$executeRaw(
      Prisma.sql`insert into bookmarks.activity_events(event_id,account_id,material_id,event_type,occurred_at) values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'bookmark_added',transaction_timestamp()-interval '366 days')`,
    );
    await database.prisma.$executeRaw(
      Prisma.sql`alter table bookmarks.activity_events rename to unavailable_activity_events`,
    );
    renamed = true;
    const reading = new ReadingActivityRetention(database.prisma),
      bookmarks = new BookmarkActivityRetention(database.prisma);
    await jobs.send(queue, {});
    const first = (await jobs.fetch(queue, { includeMetadata: true }))[0];
    if (first === undefined) throw new Error("Expected first owned job");
    let failure: unknown;
    try {
      await runActivityRetentionJob(reading, bookmarks);
    } catch (error) {
      failure = error;
    }
    if (!(failure instanceof Error))
      throw new Error("Expected partial failure");
    await jobs.fail(queue, first, failure);
    const partial = await diagnostics.readActivityRetentionLastPass();
    expect(partial).toMatchObject({
      ok: true,
      value: {
        state: "failed",
        report: {
          outcome: "failed",
          sources: [
            { result: { ok: true, value: { removed: 1 } } },
            { result: { ok: false, status: "unknown" } },
          ],
        },
      },
    });
    expect(
      await database.prisma.$queryRaw(
        Prisma.sql`select count(*)::int as remaining from reading_activity.learning_started_events`,
      ),
    ).toEqual([{ remaining: 0 }]);
    expect(JSON.stringify(partial)).not.toContain(first.id);
    expect(JSON.stringify(partial)).not.toContain("stack");
    expect(JSON.stringify(partial)).not.toContain("message");
    await database.prisma.$executeRaw(
      Prisma.sql`alter table bookmarks.unavailable_activity_events rename to activity_events`,
    );
    renamed = false;
    await jobs.send(queue, {});
    const second = (await jobs.fetch(queue, { includeMetadata: true }))[0];
    if (second === undefined) throw new Error("Expected continuation job");
    await jobs.complete(
      queue,
      second,
      await runActivityRetentionJob(reading, bookmarks),
    );
    expect(await diagnostics.readActivityRetentionLastPass()).toMatchObject({
      ok: true,
      value: {
        state: "completed",
        report: {
          outcome: "completed",
          sources: [
            { result: { ok: true, value: { removed: 0 } } },
            { result: { ok: true, value: { removed: 1 } } },
          ],
        },
      },
    });
    await database.prisma.$executeRaw(
      Prisma.sql`update pgboss.job set completed_on=transaction_timestamp()-interval '60 seconds' where name=${queue}`,
    );
    await database.prisma.$executeRaw(
      Prisma.sql`insert into pgboss.job(name,state,completed_on,data,output) values(${queue},'failed',transaction_timestamp(),'{}','{"private":"unrelated-job-sentinel","activityRetention":{"unexpected":"bad"}}')`,
    );
    const invalid = await diagnostics.readActivityRetentionLastPass();
    expect(invalid).toMatchObject({
      ok: false,
      error: { code: "invalid_report" },
    });
    expect(JSON.stringify(invalid)).not.toContain("unrelated-job-sentinel");
    await database.prisma.$executeRaw(
      Prisma.sql`update pgboss.job set output=jsonb_build_object('activityRetention',jsonb_build_object('padding',repeat('x',5000))) where name=${queue} and output->>'private'='unrelated-job-sentinel'`,
    );
    expect(await diagnostics.readActivityRetentionLastPass()).toMatchObject({
      ok: false,
      error: { code: "oversized_report" },
    });
    await database.prisma.$executeRaw(
      Prisma.sql`update pgboss.job set output='{}'::jsonb where name=${queue} and state='failed'`,
    );
    expect(await diagnostics.readActivityRetentionLastPass()).toMatchObject({
      ok: false,
      error: { code: "missing_report" },
    });
    await database.prisma.$executeRaw(
      Prisma.sql`insert into pgboss.job(name,state,completed_on,output) values(${queue},'failed',null,'{}')`,
    );
    expect(await diagnostics.readActivityRetentionLastPass()).toMatchObject({
      ok: false,
      error: { code: "invalid_receipt" },
    });
    await database.prisma.$executeRaw(
      Prisma.sql`insert into pgboss.job(name,state,data) select ${queue},'created','{}'::jsonb from generate_series(1,2001)`,
    );
    expect(await diagnostics.readActivityRetentionLastPass()).toMatchObject({
      ok: false,
      error: { code: "receipt_budget_exceeded" },
    });
  } finally {
    await jobs.stop({ close: true, graceful: false });
    if (renamed)
      await database.prisma.$executeRaw(
        Prisma.sql`alter table bookmarks.unavailable_activity_events rename to activity_events`,
      );
  }
});

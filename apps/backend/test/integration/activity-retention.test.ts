import { afterEach, beforeEach, expect, it } from "vitest";
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

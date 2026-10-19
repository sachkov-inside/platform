import { activityTestClock } from "./setup/activity-test-clock.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import { platformMigrations } from "../../src/migrations/index.js";
import { runMigrationsToLatest } from "../../src/infrastructure/postgres/migrate-to-latest.js";
import { createTestDatabase } from "./setup/test-database.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { BookmarkActivityFacts } from "../../src/modules/bookmarks/index.js";
import { ReadingActivityFacts } from "../../src/modules/reading-activity/index.js";
import { TaskSubmissionFacts } from "../../src/modules/product-tasks/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();
const DAY_MILLISECONDS = 86_400_000;
const RETENTION_DAYS = 365;
const CLOCK_SKEW_DAYS = RETENTION_DAYS * 2;
let database: TestDatabase;
let clock: Awaited<ReturnType<typeof activityTestClock>>;
beforeEach(async () => {
  database = await createMigratedTestDatabase();
  clock = await activityTestClock(database.prisma);
});
afterEach(async () => {
  await database.dispose();
});

it("bounds relevant Account/kind groups without truncating event counts; ignores unrelated historical candidates", async () => {
  await database.prisma.$executeRaw(Prisma.sql`
    insert into bookmarks.activity_events(event_id, account_id, material_id, event_type, occurred_at)
    select gen_random_uuid(), '10000000-0000-4000-8000-000000000001'::uuid, gen_random_uuid(), 'bookmark_added', ${clock.at}
    from generate_series(1,2100)
  `);
  const reader = new BookmarkActivityFacts(database.prisma);
  const result = await reader.read(clock.window);
  if (!result.ok) throw new Error(result.error.code);
  expect(result.value.rows).toEqual([
    {
      accountId: "10000000-0000-4000-8000-000000000001",
      kind: "bookmark_added",
      eventCount: 2100,
      firstOccurredAt: clock.at.toISOString(),
      lastOccurredAt: clock.at.toISOString(),
    },
  ]);
  await database.prisma.$executeRaw(Prisma.sql`
    insert into bookmarks.activity_events(event_id, account_id, material_id, event_type, occurred_at)
    select gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'bookmark_added', ${new Date(clock.at.getTime() - (RETENTION_DAYS + 1) * DAY_MILLISECONDS)}
    from generate_series(1,2100)
  `);
  expect(await reader.read(clock.window)).toMatchObject({ ok: true });
  await database.prisma.$executeRaw(Prisma.sql`
    insert into bookmarks.activity_events(event_id, account_id, material_id, event_type, occurred_at)
    select gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'bookmark_added', ${clock.at}
    from generate_series(1,2000)
  `);
  expect(await reader.read(clock.window)).toEqual({
    ok: false,
    coverage: "unknown",
    error: { code: "source_budget_exceeded" },
  });
});

it("uses the DB 365-day horizon despite application clock skew and rejects malformed or unbounded requests in every owner", async () => {
  const readers = [
    new BookmarkActivityFacts(database.prisma),
    new ReadingActivityFacts(database.prisma),
    new TaskSubmissionFacts(database.prisma),
  ];
  for (const reader of readers) {
    const appAhead = clock.at.getTime() + CLOCK_SKEW_DAYS * DAY_MILLISECONDS;
    vi.setSystemTime(appAhead);
    const current = await reader.read(clock.window);
    if (!current.ok) throw new Error(current.error.code);
    expect(Date.parse(current.value.asOf)).toBeLessThan(
      appAhead - RETENTION_DAYS * DAY_MILLISECONDS,
    );
    expect(
      Date.parse(current.value.asOf) -
        Date.parse(current.value.coverage.retentionFrom),
    ).toBe(RETENTION_DAYS * DAY_MILLISECONDS);
    vi.setSystemTime(clock.at.getTime() - CLOCK_SKEW_DAYS * DAY_MILLISECONDS);
    expect(
      await reader.read({
        from: new Date(
          clock.at.getTime() - (RETENTION_DAYS + 1) * DAY_MILLISECONDS,
        ).toISOString(),
        to: new Date(
          clock.at.getTime() - RETENTION_DAYS * DAY_MILLISECONDS,
        ).toISOString(),
      }),
    ).toEqual({
      ok: false,
      coverage: "unknown",
      error: { code: "outside_retention" },
    });
    expect(await reader.read({ ...clock.window, limit: 100000 })).toEqual({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(
      await reader.read({
        from: clock.window.from,
        to: new Date(clock.at.getTime() + 32 * DAY_MILLISECONDS).toISOString(),
      }),
    ).toEqual({ ok: false, error: { code: "invalid_request" } });
    expect(
      await reader.read({
        from: new Date(
          clock.at.getTime() - (RETENTION_DAYS - 1) * DAY_MILLISECONDS,
        ).toISOString(),
        to: new Date(
          clock.at.getTime() - (RETENTION_DAYS - 2) * DAY_MILLISECONDS,
        ).toISOString(),
      }),
    ).toMatchObject({
      ok: true,
      value: {
        coverage: {
          status: "partial",
          collectionStartedAt: null,
          continuity: "not_proven",
        },
        rows: [],
      },
    });
  }
});

it("returns unknown for unavailable owner journals rather than claiming an empty complete period", async () => {
  await database.prisma.$executeRaw(
    Prisma.sql`drop table bookmarks.activity_events`,
  );
  expect(
    await new BookmarkActivityFacts(database.prisma).read(clock.window),
  ).toEqual({
    ok: false,
    coverage: "unknown",
    error: { code: "source_unavailable" },
  });
});

it("upgrades a genuine pre-journal database without manufacturing activity from existing mutable or backfilled facts", async () => {
  const legacy = await createTestDatabase();
  try {
    const firstNew = platformMigrations.findIndex(
      (migration) => migration.name === "0105_learning_activity_provenance",
    );
    await runMigrationsToLatest(
      legacy.url,
      platformMigrations.slice(0, firstNew),
    );
    await legacy.prisma.bookmarkedMaterial.create({
      data: {
        accountId: "10000000-0000-4000-8000-000000000001",
        materialId: "20000000-0000-4000-8000-000000000001",
        bookmarkedAt: clock.at,
      },
    });
    await legacy.prisma.productLearningStarted.create({
      data: {
        accountId: "10000000-0000-4000-8000-000000000001",
        productId: "30000000-0000-4000-8000-000000000001",
        startedAt: clock.at,
      },
    });
    await runMigrationsToLatest(legacy.url, platformMigrations);
    expect(
      await new BookmarkActivityFacts(legacy.prisma).read(clock.window),
    ).toMatchObject({
      ok: true,
      value: {
        rows: [],
        coverage: { status: "partial", collectionStartedAt: null },
      },
    });
    expect(
      await new ReadingActivityFacts(legacy.prisma).read(clock.window),
    ).toMatchObject({
      ok: true,
      value: {
        rows: [],
        coverage: { status: "partial", collectionStartedAt: null },
      },
    });
  } finally {
    await legacy.dispose();
  }
});

it("returns unknown when the owner event query exhausts its bounded statement budget", async () => {
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
  try {
    await locked;
    expect(
      await new BookmarkActivityFacts(database.prisma).read(clock.window),
    ).toEqual({
      ok: false,
      coverage: "unknown",
      error: { code: "source_unavailable" },
    });
  } finally {
    releaseLock();
    await locker;
  }
});

import { platformMigrations } from "../../src/migrations/index.js";
import { runMigrationsToLatest } from "../../src/infrastructure/postgres/migrate-to-latest.js";
import { createTestDatabase } from "./setup/test-database.js";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { BookmarkActivityFacts } from "../../src/modules/bookmarks/index.js";
import { ReadingActivityFacts } from "../../src/modules/reading-activity/index.js";
import { TaskSubmissionFacts } from "../../src/modules/product-tasks/index.js";
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
const window = { from: "2026-10-01T00:00:00Z", to: "2026-10-31T00:00:00Z" };

it("bounds relevant Account/kind groups without truncating event counts; ignores unrelated historical candidates", async () => {
  await database.prisma.$executeRaw(Prisma.sql`
    insert into bookmarks.activity_events(event_id, account_id, material_id, event_type, occurred_at)
    select gen_random_uuid(), '10000000-0000-4000-8000-000000000001'::uuid, gen_random_uuid(), 'bookmark_added', '2026-10-07T00:00:00Z'::timestamptz
    from generate_series(1,2100)
  `);
  const reader = new BookmarkActivityFacts(database.prisma);
  const result = await reader.read(window);
  if (!result.ok) throw new Error(result.error.code);
  expect(result.value.rows).toEqual([
    {
      accountId: "10000000-0000-4000-8000-000000000001",
      kind: "bookmark_added",
      eventCount: 2100,
      firstOccurredAt: "2026-10-07T00:00:00.000Z",
      lastOccurredAt: "2026-10-07T00:00:00.000Z",
    },
  ]);
  await database.prisma.$executeRaw(Prisma.sql`
    insert into bookmarks.activity_events(event_id, account_id, material_id, event_type, occurred_at)
    select gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'bookmark_added', '2020-01-01T00:00:00Z'::timestamptz
    from generate_series(1,2100)
  `);
  expect(await reader.read(window)).toMatchObject({ ok: true });
  await database.prisma.$executeRaw(Prisma.sql`
    insert into bookmarks.activity_events(event_id, account_id, material_id, event_type, occurred_at)
    select gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'bookmark_added', '2026-10-07T00:00:00Z'::timestamptz
    from generate_series(1,2000)
  `);
  expect(await reader.read(window)).toEqual({
    ok: false,
    coverage: "unknown",
    error: { code: "source_budget_exceeded" },
  });
});

it("refuses windows before the 365-day horizon and malformed or unbounded requests in every owner", async () => {
  const readers = [
    new BookmarkActivityFacts(database.prisma),
    new ReadingActivityFacts(database.prisma),
    new TaskSubmissionFacts(database.prisma),
  ];
  for (const reader of readers) {
    expect(
      await reader.read({
        from: "2020-01-01T00:00:00Z",
        to: "2020-01-02T00:00:00Z",
      }),
    ).toEqual({
      ok: false,
      coverage: "unknown",
      error: { code: "outside_retention" },
    });
    expect(await reader.read({ ...window, limit: 100000 })).toEqual({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(
      await reader.read({ from: window.from, to: "2027-01-01T00:00:00Z" }),
    ).toEqual({ ok: false, error: { code: "invalid_request" } });
    expect(await reader.read(window)).toMatchObject({
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
  expect(await new BookmarkActivityFacts(database.prisma).read(window)).toEqual(
    { ok: false, coverage: "unknown", error: { code: "source_unavailable" } },
  );
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
        bookmarkedAt: new Date("2026-10-07T00:00:00Z"),
      },
    });
    await legacy.prisma.productLearningStarted.create({
      data: {
        accountId: "10000000-0000-4000-8000-000000000001",
        productId: "30000000-0000-4000-8000-000000000001",
        startedAt: new Date("2026-10-07T00:00:00Z"),
      },
    });
    await runMigrationsToLatest(legacy.url, platformMigrations);
    expect(
      await new BookmarkActivityFacts(legacy.prisma).read(window),
    ).toMatchObject({
      ok: true,
      value: {
        rows: [],
        coverage: { status: "partial", collectionStartedAt: null },
      },
    });
    expect(
      await new ReadingActivityFacts(legacy.prisma).read(window),
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
      await new BookmarkActivityFacts(database.prisma).read(window),
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

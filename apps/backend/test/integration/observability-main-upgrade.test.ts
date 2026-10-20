import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import {
  platformMigrations,
  migrateToLatest,
} from "../../src/migrations/index.js";
import {
  migrationChecksum,
  parseAppliedMigrations,
  runMigrationsToLatest,
} from "../../src/infrastructure/postgres/migrate-to-latest.js";
import { createTestDatabase } from "./setup/test-database.js";

// Frozen from the exact canonical registry at trusted main67e3495e, not the candidate registry.
const mainCount = 101;
const mainDigest =
  "00d864f15c5f7ea9668c2242d0fe418f7c02756c0361d372fdb8b4122d44cb9b";
const appendedNames = [
  "0101_waitlist_confirmations",
  "0101_funnel_diagnostic_candidates",
  "0102_billing_funnel_diagnostic_sources",
  "0103_reading_funnel_diagnostic_sources",
  "0104_telegram_funnel_diagnostic_identities",
  "0105_funnel_diagnostic_current_products",
  "0106_learning_activity_provenance",
  "0107_bookmark_activity_provenance",
  "0108_submission_activity_period",
  "0109_materials_notification_trace_context",
  "0110_notifications_notification_trace_context",
  "0111_notifications_email_trace_context",
  "0112_communications_tracking_trace_context",
];

// Frozen from canonical main2f530002, including its committed waitlist migration.
const currentMainCount = 102;
const currentMainDigest =
  "6e88fc6f9aac093fa2deb0da67dcf20c9502339d23d271a2d28d9c881c8199e7";

it("upgrades exact current main0101 to all 114 migrations without changing its ledger prefix", async () => {
  const mainRegistry = platformMigrations.slice(0, currentMainCount);
  expect(
    createHash("sha256").update(JSON.stringify(mainRegistry)).digest("hex"),
  ).toBe(currentMainDigest);
  expect(mainRegistry.at(-1)?.name).toBe("0101_waitlist_confirmations");
  expect(platformMigrations).toHaveLength(114);
  expect(new Set(platformMigrations.map(({ name }) => name)).size).toBe(114);
  const database = await createTestDatabase();
  const ledger = async () =>
    parseAppliedMigrations(
      await database.prisma.$queryRaw(Prisma.sql`
        select name, checksum, position from public.platform_migrations order by position
      `),
    );
  try {
    await runMigrationsToLatest(database.url, mainRegistry);
    const before = await ledger();
    expect(before).toEqual(
      mainRegistry.map((migration, index) => ({
        name: migration.name,
        checksum: migrationChecksum(migration.statement),
        position: index + 1,
      })),
    );
    expect(await migrateToLatest(database.url)).toEqual({
      appliedMigrations: appendedNames.slice(1),
    });
    const after = await ledger();
    expect(after.slice(0, currentMainCount)).toEqual(before);
    expect(after.slice(currentMainCount)).toEqual(
      platformMigrations.slice(currentMainCount).map((migration, index) => ({
        name: migration.name,
        checksum: migrationChecksum(migration.statement),
        position: currentMainCount + index + 1,
      })),
    );
    expect(await migrateToLatest(database.url)).toEqual({
      appliedMigrations: [],
    });
    expect(await ledger()).toEqual(after);
  } finally {
    await database.dispose();
  }
});

it("upgrades exact main0100 without changing canonical SQL/checksums/positions and retains a compatible rollback registry", async () => {
  const mainRegistry = platformMigrations.slice(0, mainCount);
  expect(
    createHash("sha256").update(JSON.stringify(mainRegistry)).digest("hex"),
  ).toBe(mainDigest);
  expect(mainRegistry.at(-1)?.name).toBe("0100_product_waitlists");
  expect(platformMigrations.slice(mainCount).map(({ name }) => name)).toEqual(
    appendedNames,
  );
  const database = await createTestDatabase();
  const ledger = async () =>
    parseAppliedMigrations(
      await database.prisma.$queryRaw(Prisma.sql`
    select name, checksum, position from public.platform_migrations order by position
  `),
    );
  try {
    await runMigrationsToLatest(database.url, mainRegistry);
    const before = await ledger();
    expect(before).toEqual(
      mainRegistry.map((migration, index) => ({
        name: migration.name,
        checksum: migrationChecksum(migration.statement),
        position: index + 1,
      })),
    );
    // The old, never-deployed observability allocation really collides with canonical main0100.
    const oldRegistry = [
      ...mainRegistry.slice(0, -1),
      ...platformMigrations.slice(mainCount).map((migration, index) => ({
        ...migration,
        name: `${String(100 + index).padStart(4, "0")}${migration.name.slice(4)}`,
      })),
    ];
    await expect(
      runMigrationsToLatest(database.url, oldRegistry),
    ).rejects.toThrow(
      "Migration ledger is not an exact registry prefix at position 101",
    );
    expect(await migrateToLatest(database.url)).toEqual({
      appliedMigrations: appendedNames,
    });
    const after = await ledger();
    expect(after.slice(0, mainCount)).toEqual(before);
    expect(after.slice(mainCount)).toEqual(
      platformMigrations.slice(mainCount).map((migration, index) => ({
        name: migration.name,
        checksum: migrationChecksum(migration.statement),
        position: mainCount + index + 1,
      })),
    );
    expect(await migrateToLatest(database.url)).toEqual({
      appliedMigrations: [],
    });
    await expect(
      runMigrationsToLatest(database.url, mainRegistry),
    ).rejects.toThrow("Migration ledger is not an exact registry prefix");
    // A rollback of application behavior keeps all registry entries and exact SQL.
    expect(
      await runMigrationsToLatest(database.url, [...platformMigrations]),
    ).toEqual({ appliedMigrations: [] });
    const changedSql = platformMigrations.map((migration) =>
      migration.name === "0101_funnel_diagnostic_candidates"
        ? { ...migration, statement: migration.statement + "\n-- changed" }
        : migration,
    );
    await expect(
      runMigrationsToLatest(database.url, changedSql),
    ).rejects.toThrow(
      "Migration checksum mismatch: 0101_funnel_diagnostic_candidates",
    );
    expect(await ledger()).toEqual(after);
  } finally {
    await database.dispose();
  }
});

// Frozen from prepared root4da87e1d before adding the two carrier migrations.
const preparedRootCount = 109;
const preparedRootDigest =
  "9ec856bf4e1f555c648028ed80fd2d8715835376746b8eb3b42166b23a5b3872";
const carrierChecksums = [
  "ee7ee354bfe652213c914e47368f9e115ac14bbca2a994aa418a581dfeafac2b",
  "d8f7fbb29735fd290bcf6fbcd0f2c8b79a6e469749f590e9a2764867f08da28c",
  "fb4ac34965f919b5086aa562637f11bafc8ec366950091e17e195f004d0fb679",
];
it("retains the frozen historical root0108 upgrade and rejects its divergent ledger against current main", async () => {
  const preparedRegistry = platformMigrations.filter(
    ({ name }) =>
      name !== "0101_waitlist_confirmations" &&
      name !== "0112_communications_tracking_trace_context",
  );
  const rootRegistry = preparedRegistry.slice(0, preparedRootCount);
  expect(
    createHash("sha256").update(JSON.stringify(rootRegistry)).digest("hex"),
  ).toBe(preparedRootDigest);
  expect(rootRegistry.at(-1)?.name).toBe("0108_submission_activity_period");
  expect(
    preparedRegistry
      .slice(preparedRootCount)
      .map(({ statement }) => migrationChecksum(statement)),
  ).toEqual(carrierChecksums);
  const database = await createTestDatabase();
  const ledger = async () =>
    parseAppliedMigrations(
      await database.prisma.$queryRaw(Prisma.sql`
    select name, checksum, position from public.platform_migrations order by position
  `),
    );
  try {
    await runMigrationsToLatest(database.url, rootRegistry);
    const before = await ledger();
    await expect(migrateToLatest(database.url)).rejects.toThrow(
      "not an exact registry prefix at position 102",
    );
    expect(await ledger()).toEqual(before);
    expect(await runMigrationsToLatest(database.url, preparedRegistry)).toEqual(
      {
        appliedMigrations: [
          "0109_materials_notification_trace_context",
          "0110_notifications_notification_trace_context",
          "0111_notifications_email_trace_context",
        ],
      },
    );
    const after = await ledger();
    expect(after.slice(0, preparedRootCount)).toEqual(before);
    expect(after.slice(preparedRootCount)).toEqual([
      {
        name: "0109_materials_notification_trace_context",
        checksum: carrierChecksums[0],
        position: 110,
      },
      {
        name: "0110_notifications_notification_trace_context",
        checksum: carrierChecksums[1],
        position: 111,
      },
      {
        name: "0111_notifications_email_trace_context",
        checksum: carrierChecksums[2],
        position: 112,
      },
    ]);
    expect(await runMigrationsToLatest(database.url, preparedRegistry)).toEqual(
      {
        appliedMigrations: [],
      },
    );
    await expect(
      runMigrationsToLatest(database.url, rootRegistry),
    ).rejects.toThrow("not an exact registry prefix at position 110");
    const oldAllocation = [
      ...rootRegistry,
      ...preparedRegistry.slice(preparedRootCount).map((migration, index) => ({
        ...migration,
        name:
          index === 0
            ? "0108_materials_notification_trace_context"
            : index === 1
              ? "0109_notifications_notification_trace_context"
              : migration.name,
      })),
      ...platformMigrations.filter(
        ({ name }) => name === "0101_waitlist_confirmations",
      ),
    ];
    expect(oldAllocation).toHaveLength(113);
    expect(oldAllocation.map(({ name }) => name).slice(-4)).toEqual([
      "0108_materials_notification_trace_context",
      "0109_notifications_notification_trace_context",
      "0111_notifications_email_trace_context",
      "0101_waitlist_confirmations",
    ]);
    expect(new Set(oldAllocation.map(({ name }) => name)).size).toBe(
      oldAllocation.length,
    );
    await expect(
      runMigrationsToLatest(database.url, oldAllocation),
    ).rejects.toThrow("not an exact registry prefix at position 110");
    const changedCarrier = preparedRegistry.map((migration, index) =>
      index === preparedRootCount
        ? { ...migration, statement: migration.statement + "\n-- changed" }
        : migration,
    );
    await expect(
      runMigrationsToLatest(database.url, changedCarrier),
    ).rejects.toThrow(
      "Migration checksum mismatch: 0109_materials_notification_trace_context",
    );
    expect(
      await runMigrationsToLatest(database.url, [...preparedRegistry]),
    ).toEqual({ appliedMigrations: [] });
    await expect(migrateToLatest(database.url)).rejects.toThrow(
      "not an exact registry prefix at position 102",
    );
    expect(await ledger()).toEqual(after);
  } finally {
    await database.dispose();
  }
});

// Frozen from the exact prepared registry at root88301c77, before the nullable tracking carrier.
it("appends nullable tracking context after the exact 113-entry ledger without changing historical hits", async () => {
  const prefix = platformMigrations.slice(0, 113);
  expect(
    createHash("sha256").update(JSON.stringify(prefix)).digest("hex"),
  ).toBe("e3176346cb0b8c9d7509554dc5f04fc6f614489051faeaed750006c49d2c38e8");
  const database = await createTestDatabase();
  try {
    await runMigrationsToLatest(database.url, prefix);
    await database.prisma.$executeRaw(Prisma.sql`
      insert into communications.tracking_hits (event_id, token, occurred_at, traffic, available_at)
      values ('9f30cb17-16d4-4683-92f7-425003956a10'::uuid, 'historical-tracking-token-0000000000000000',
        '2026-10-07T09:00:00Z'::timestamptz, 'unknown', '2026-10-07T09:00:00Z'::timestamptz)
    `);
    const before = parseAppliedMigrations(
      await database.prisma.$queryRaw(Prisma.sql`
      select name, checksum, position from public.platform_migrations order by position
    `),
    );
    expect(await migrateToLatest(database.url)).toEqual({
      appliedMigrations: ["0112_communications_tracking_trace_context"],
    });
    const after = parseAppliedMigrations(
      await database.prisma.$queryRaw(Prisma.sql`
      select name, checksum, position from public.platform_migrations order by position
    `),
    );
    expect(after.slice(0, 113)).toEqual(before);
    expect(after).toHaveLength(114);
    const hit =
      await database.prisma.communicationTrackingHit.findUniqueOrThrow({
        where: { eventId: "9f30cb17-16d4-4683-92f7-425003956a10" },
      });
    expect(hit.traceparent).toBeNull();
    expect(hit.token).toBe("historical-tracking-token-0000000000000000");
    expect(hit.availableAt.toISOString()).toBe("2026-10-07T09:00:00.000Z");
    expect(hit.claimId).toBeNull();
    expect(hit.deliveredAt).toBeNull();
    // An old writer names only its original columns; the new nullable carrier does not require a value.
    expect(
      await database.prisma.$executeRaw(Prisma.sql`
      update communications.tracking_hits set claim_id = null
      where event_id = '9f30cb17-16d4-4683-92f7-425003956a10'::uuid
    `),
    ).toBe(1);
    expect(await migrateToLatest(database.url)).toEqual({
      appliedMigrations: [],
    });
    await expect(runMigrationsToLatest(database.url, prefix)).rejects.toThrow(
      "not an exact registry prefix at position 114",
    );
  } finally {
    await database.dispose();
  }
});

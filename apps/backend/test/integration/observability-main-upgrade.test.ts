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
  "0101_funnel_diagnostic_candidates",
  "0102_billing_funnel_diagnostic_sources",
  "0103_reading_funnel_diagnostic_sources",
  "0104_telegram_funnel_diagnostic_identities",
  "0105_funnel_diagnostic_current_products",
  "0106_learning_activity_provenance",
  "0107_bookmark_activity_provenance",
  "0108_submission_activity_period",
];

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
    const changedSql = platformMigrations.map((migration, index) =>
      index === mainCount
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

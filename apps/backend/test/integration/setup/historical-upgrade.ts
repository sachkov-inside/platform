import { expect } from "vitest";
import { z } from "zod";

import {
  runMigrationsToLatest,
  type Migration,
} from "../../../src/infrastructure/postgres/migrate-to-latest.js";
import { Prisma } from "../../../src/infrastructure/prisma/index.js";
import { platformMigrations } from "../../../src/migrations/index.js";
import type { TestDatabase } from "./test-database.js";

type UpgradedDatabase = Pick<TestDatabase, "prisma" | "url">;

const ledgerTableRowsSchema = z
  .array(z.strictObject({ present: z.boolean() }))
  .length(1);
const ledgerRowsSchema = z.array(
  z.strictObject({ name: z.string(), position: z.number().int() }),
);

/**
 * Upgrades a database from a historical point of a migration registry. A test stops the ledger
 * before or at a named migration, seeds the rows that point allows, and upgrades to the latest
 * registry. The applied tail is derived from the registry, so a new migration at its end never
 * edits the test. Every upgrade asserts that the ledger is an exact prefix of the registry
 * (ADR 0005) and that a replay applies nothing.
 */
export function historicalUpgrade<const Registry extends readonly Migration[]>(
  registry: Registry,
) {
  type MigrationName = Registry[number]["name"];

  function positionOf(name: MigrationName): number {
    const index = registry.findIndex((migration) => migration.name === name);
    if (index < 0) throw new Error(`Migration ${name} is not in the registry`);
    return index;
  }

  return {
    /** Applies the registry up to, but not including, `name`. */
    migrateBefore: async (
      database: UpgradedDatabase,
      name: MigrationName,
    ): Promise<void> => {
      await runMigrationsToLatest(
        database.url,
        registry.slice(0, positionOf(name)),
      );
    },

    /** Applies the registry up to and including `name`; returns the migrations it applied. */
    migrateThrough: async (
      database: UpgradedDatabase,
      name: MigrationName,
    ): Promise<readonly string[]> => {
      const outcome = await runMigrationsToLatest(
        database.url,
        registry.slice(0, positionOf(name) + 1),
      );
      return outcome.appliedMigrations;
    },

    /** Upgrades to the latest registry and returns the migrations the upgrade applied. */
    upgradeToLatest: async (
      database: UpgradedDatabase,
    ): Promise<readonly string[]> => {
      const before = await readLedger(database);
      const outcome = await runMigrationsToLatest(database.url, registry);
      const names = registry.map((migration) => migration.name);
      expect(outcome.appliedMigrations).toEqual(names.slice(before.length));
      expect(await readLedger(database)).toEqual(
        names.map((name, index) => ({ name, position: index + 1 })),
      );
      expect(await runMigrationsToLatest(database.url, registry)).toEqual({
        appliedMigrations: [],
      });
      return outcome.appliedMigrations;
    },
  };
}

async function readLedger(database: UpgradedDatabase) {
  const [table] = ledgerTableRowsSchema.parse(
    await database.prisma.$queryRaw(
      Prisma.sql`select to_regclass('public.platform_migrations') is not null as present`,
    ),
  );
  if (table?.present !== true) return [];
  return ledgerRowsSchema.parse(
    await database.prisma.$queryRaw(Prisma.sql`
      select name, position
      from public.platform_migrations
      order by position
    `),
  );
}

export const { migrateBefore, migrateThrough, upgradeToLatest } =
  historicalUpgrade(platformMigrations);

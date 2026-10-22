import { expect, test } from "vitest";

import { migrationRegistryIdentity } from "../../src/infrastructure/postgres/migrate-to-latest.js";
import { platformMigrations } from "../../src/migrations/index.js";
import { historicalUpgrade } from "./setup/historical-upgrade.js";
import { createTestDatabase } from "./setup/test-database.js";

test("derives the upgrade tail from a registry that gained a migration after the historical point", async () => {
  const appended = {
    name: "9999_appended_fixture",
    statement: "create table public.appended_fixture (id integer primary key)",
  } as const;
  const latest = platformMigrations.at(-1);
  if (latest === undefined) throw new Error("The registry is empty");
  const registry = [...platformMigrations, appended] as const;
  const upgrade = historicalUpgrade(registry);
  const database = await createTestDatabase();
  try {
    await upgrade.migrateBefore(database, latest.name);
    expect(await upgrade.upgradeToLatest(database)).toEqual([
      latest.name,
      appended.name,
    ]);
  } finally {
    await database.dispose();
  }
});

test("keeps every historical migration in place: the registry only grows at its end", () => {
  // The registry as of 22.10.2026. Appending a migration leaves this prefix and its identity intact;
  // removing, renaming, reordering or editing an earlier migration changes them.
  const historicalLength = 103;
  expect(platformMigrations.length).toBeGreaterThanOrEqual(historicalLength);
  expect(
    migrationRegistryIdentity(platformMigrations.slice(0, historicalLength)),
  ).toBe(
    "sha256:4202eac8e733fe5f60198130a06eb9a4b4b46aafa05c7f2ebf642c78cf8e4468",
  );
});

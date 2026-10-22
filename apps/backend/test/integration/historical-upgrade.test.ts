import { expect, test } from "vitest";

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

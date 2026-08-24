import { Migrator, type MigrationProvider } from "kysely/migration";

import type { PlatformDatabase } from "./platform-database.js";

export interface MigrationOutcome {
  readonly appliedMigrations: readonly string[];
}

export async function runMigrationsToLatest(
  database: PlatformDatabase,
  migrationProvider: MigrationProvider,
): Promise<MigrationOutcome> {
  const result = await new Migrator({ db: database, provider: migrationProvider }).migrateToLatest();
  if (result.error !== undefined) {
    // Kysely exposes this as unknown; migration callers must receive the original failure value.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw result.error;
  }
  return {
    appliedMigrations: (result.results ?? [])
      .filter(({ status }) => status === "Success")
      .map(({ migrationName }) => migrationName),
  };
}

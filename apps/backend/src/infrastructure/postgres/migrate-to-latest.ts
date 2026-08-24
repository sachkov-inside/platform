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
    if (result.error instanceof Error) {
      throw result.error;
    }
    throw new Error("Database migration failed", { cause: result.error });
  }
  return {
    appliedMigrations: (result.results ?? [])
      .filter(({ status }) => status === "Success")
      .map(({ migrationName }) => migrationName),
  };
}

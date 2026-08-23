import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";

import type { PlatformDatabase } from "./platform-database.js";
import * as contentAuthoringMigration from "./migrations/0001_content_authoring.js";

const migrations: Record<string, Migration> = {
  "0001_content_authoring": contentAuthoringMigration,
};

const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};

export interface MigrationOutcome {
  readonly appliedMigrations: readonly string[];
}

export async function migrateToLatest(
  database: PlatformDatabase,
): Promise<MigrationOutcome> {
  const result = await new Migrator({ db: database, provider: migrationProvider }).migrateToLatest();
  if (result.error !== undefined) {
    throw result.error;
  }
  return {
    appliedMigrations: (result.results ?? [])
      .filter(({ status }) => status === "Success")
      .map(({ migrationName }) => migrationName),
  };
}

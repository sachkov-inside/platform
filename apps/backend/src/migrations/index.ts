import type { Migration, MigrationProvider } from "kysely/migration";

import {
  runMigrationsToLatest,
  type MigrationOutcome,
} from "../infrastructure/postgres/migrate-to-latest.js";
import type { PlatformDatabase } from "../infrastructure/postgres/platform-database.js";
import * as materialAuthoringMigration from "../modules/materials/infrastructure/postgres/migrations/0001_content_authoring.js";

const migrations: Record<string, Migration> = {
  "0001_content_authoring": materialAuthoringMigration,
};

const platformMigrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};

export function migrateToLatest(
  database: PlatformDatabase,
): Promise<MigrationOutcome> {
  return runMigrationsToLatest(database, platformMigrationProvider);
}

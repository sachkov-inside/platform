import type { Migration, MigrationProvider } from "kysely/migration";

import {
  runMigrationsToLatest,
  type MigrationOutcome,
} from "../infrastructure/postgres/migrate-to-latest.js";
import type { PlatformDatabase } from "../infrastructure/postgres/platform-database.js";
import * as materialAuthoringMigration from "../modules/materials/infrastructure/postgres/migrations/0001_content_authoring.js";
import * as materialLifecycleMigration from "../modules/materials/infrastructure/postgres/migrations/0002_material_lifecycle.js";
import * as identityPrincipalsMigration from "../modules/identity-principals/infrastructure/postgres/migrations/0003_identity_principals.js";

const migrations: Record<string, Migration> = {
  "0001_content_authoring": materialAuthoringMigration,
  "0002_material_lifecycle": materialLifecycleMigration,
  "0003_identity_principals": identityPrincipalsMigration,
};

const platformMigrationProvider: MigrationProvider = {
  getMigrations() {
    return Promise.resolve(migrations);
  },
};

export function migrateToLatest(
  database: PlatformDatabase,
): Promise<MigrationOutcome> {
  return runMigrationsToLatest(database, platformMigrationProvider);
}

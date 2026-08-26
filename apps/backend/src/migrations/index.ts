import {
  runMigrationsToLatest,
  type MigrationOutcome,
} from "../infrastructure/postgres/migrate-to-latest.js";
import {
  name as identityPrincipalsMigrationName,
  statement as identityPrincipalsMigrationStatement,
} from "../modules/identity-principals/infrastructure/postgres/migrations/0002_identity_principals.js";
import {
  name as accountsMigrationName,
  statement as accountsMigrationStatement,
} from "../modules/accounts/infrastructure/postgres/migrations/0004_accounts.js";
import {
  name as materialsMigrationName,
  statement as materialsMigrationStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0001_materials.js";
import {
  name as publishedMaterialsCursorIndexMigrationName,
  statement as publishedMaterialsCursorIndexMigrationStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0003_published_materials_cursor_index.js";

const migrations = [
  {
    name: materialsMigrationName,
    statement: materialsMigrationStatement,
  },
  {
    name: identityPrincipalsMigrationName,
    statement: identityPrincipalsMigrationStatement,
  },
  {
    name: publishedMaterialsCursorIndexMigrationName,
    statement: publishedMaterialsCursorIndexMigrationStatement,
  },
  {
    name: accountsMigrationName,
    statement: accountsMigrationStatement,
  },
] as const;

export function migrateToLatest(
  connectionString: string,
): Promise<MigrationOutcome> {
  return runMigrationsToLatest(connectionString, migrations);
}

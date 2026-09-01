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
import {
  name as mutableMaterialsMigrationName,
  statement as mutableMaterialsMigrationStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0005_mutable_materials.js";
import {
  name as removeMaterialAccessAuditMigrationName,
  statement as removeMaterialAccessAuditMigrationStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0007-remove-material-access-audit.js";
import {
  name as materialRelatedPinsMigrationName,
  statement as materialRelatedPinsMigrationStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0010-material-related-pins.js";
import {
  name as membershipEntitlementsMigrationName,
  statement as membershipEntitlementsMigrationStatement,
} from "../modules/membership-entitlements/infrastructure/postgres/migrations/0006_membership-entitlements.js";
import {
  name as memberProfilesMigrationName,
  statement as memberProfilesMigrationStatement,
} from "../modules/member-profiles/infrastructure/postgres/migrations/0008_member_profiles.js";
import {
  name as removeMemberProfileReportsMigrationName,
  statement as removeMemberProfileReportsMigrationStatement,
} from "../modules/member-profiles/infrastructure/postgres/migrations/0012-remove-member-profile-reports.js";
import {
  name as publishedMaterialSearchMigrationName,
  statement as publishedMaterialSearchMigrationStatement,
} from "../modules/materials/infrastructure/postgres/migrations/0009-published-material-search.js";
import {
  name as telegramMembershipMigrationName,
  statement as telegramMembershipMigrationStatement,
} from "../modules/telegram-membership/infrastructure/postgres/migrations/0011-telegram-membership.js";
import {
  name as materialAssetsMigrationName,
  statement as materialAssetsMigrationStatement,
} from "../modules/assets/infrastructure/postgres/migrations/0013-material-assets.js";
import {
  name as materialAssetReferenceStateMigrationName,
  statement as materialAssetReferenceStateMigrationStatement,
} from "../modules/assets/infrastructure/postgres/migrations/0014-material-asset-reference-state.js";

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
  {
    name: mutableMaterialsMigrationName,
    statement: mutableMaterialsMigrationStatement,
  },
  {
    name: membershipEntitlementsMigrationName,
    statement: membershipEntitlementsMigrationStatement,
  },
  {
    name: removeMaterialAccessAuditMigrationName,
    statement: removeMaterialAccessAuditMigrationStatement,
  },
  {
    name: memberProfilesMigrationName,
    statement: memberProfilesMigrationStatement,
  },
  {
    name: publishedMaterialSearchMigrationName,
    statement: publishedMaterialSearchMigrationStatement,
  },
  {
    name: materialRelatedPinsMigrationName,
    statement: materialRelatedPinsMigrationStatement,
  },
  {
    name: telegramMembershipMigrationName,
    statement: telegramMembershipMigrationStatement,
  },
  {
    name: removeMemberProfileReportsMigrationName,
    statement: removeMemberProfileReportsMigrationStatement,
  },
  {
    name: materialAssetsMigrationName,
    statement: materialAssetsMigrationStatement,
  },
  {
    name: materialAssetReferenceStateMigrationName,
    statement: materialAssetReferenceStateMigrationStatement,
  },
] as const;

export function migrateToLatest(
  connectionString: string,
): Promise<MigrationOutcome> {
  return runMigrationsToLatest(connectionString, migrations);
}

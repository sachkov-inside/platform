import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, expect, it } from "vitest";

import { createDatabase } from "../../src/database/create-database.js";
import type { Database } from "../../src/database/database.js";
import { migrateTo, migrateToLatest } from "../../src/database/migrator.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import { withMigrationDatabase } from "../support/migration-database.js";
import { required } from "../support/required.js";

registerFixedClock();

const databaseUrl = required(process.env["DATABASE_URL"]);
let preparation: Promise<void> | undefined;
let preparationSettled = false;
let migrationStep = "setup";
let membershipRemoved: boolean;
let identityRemoved: boolean;
let identityRestored: boolean;
let failure: unknown;
let failedDatabaseRemoved: boolean;
let publicIdentityPreserved: boolean;

async function tableExists(database: Database, name: string): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    select exists (
      select 1 from information_schema.tables
      where table_schema = current_schema() and table_name = ${name}
    ) as exists
  `.execute(database);
  return required(result.rows[0]).exists;
}

beforeAll(async () => {
  // Migrate and rebuild before the case budget starts. The hook remains bounded by Vitest.
  // Keep its promise so cleanup joins work even when Vitest stops waiting for the hook.
  preparation = (async () => {
    await withMigrationDatabase(
      databaseUrl,
      `identity_migration_${randomUUID().replaceAll("-", "")}`,
      async (database) => {
        migrationStep = "prepare latest";
        await migrateToLatest(database);
        migrationStep = "rollback to identity linking";
        await migrateTo(database, "002-identity-linking");
        membershipRemoved = !(await tableExists(
          database,
          "membership_evidence_outbox",
        ));
        migrationStep = "rollback to ordinary start";
        await migrateTo(database, "001-ordinary-start");
        identityRemoved = !(await tableExists(database, "link_transactions"));
        migrationStep = "restore latest";
        await migrateToLatest(database);
        identityRestored = await tableExists(database, "link_transactions");
      },
    );

    migrationStep = "intentional rollback failure and cleanup";
    const failedDatabase = `identity_migration_${randomUUID().replaceAll("-", "")}`;
    const expected = new Error("intentional migration fixture failure");
    try {
      await withMigrationDatabase(
        databaseUrl,
        failedDatabase,
        async (database) => {
          await migrateToLatest(database);
          await migrateTo(database, "001-ordinary-start");
          // Preserve the real PostgreSQL diagnostic from a fixture left rolled back.
          await sql`select * from identity_link_recoveries`.execute(database);
        },
      );
    } catch (error) {
      failure = error;
    }
    const database = createDatabase(databaseUrl);
    try {
      const result = await sql<{ exists: boolean }>`
        select exists (select 1 from pg_database where datname = ${failedDatabase}) as exists
      `.execute(database);
      failedDatabaseRemoved = !required(result.rows[0]).exists;
      publicIdentityPreserved = await tableExists(
        database,
        "identity_link_recoveries",
      );
      // An exception from the operation also survives cleanup unchanged.
      await expect(
        withMigrationDatabase(databaseUrl, failedDatabase, () =>
          Promise.reject(expected),
        ),
      ).rejects.toBe(expected);
    } finally {
      await database.destroy();
    }
  })().finally(() => {
    preparationSettled = true;
  });
  await preparation;
});

afterAll(async () => {
  if (!preparationSettled)
    console.error("migration fixture cleanup joins timed-out preparation", {
      migrationStep,
    });
  // A failed preparation was already reported by beforeAll. Do not replace its failure.
  await preparation?.catch(() => undefined);
});

it("rebuilds the identity-linking migration down and forward", () => {
  expect(membershipRemoved).toBe(true);
  expect(identityRemoved).toBe(true);
  expect(identityRestored).toBe(true);
});

it("removes a failed rollback fixture while preserving PostgreSQL diagnostics and runtime tables", () => {
  expect(failure).toMatchObject({ code: "42P01" });
  expect(failure).toHaveProperty(
    "message",
    'relation "identity_link_recoveries" does not exist',
  );
  expect(failedDatabaseRemoved).toBe(true);
  expect(publicIdentityPreserved).toBe(true);
});

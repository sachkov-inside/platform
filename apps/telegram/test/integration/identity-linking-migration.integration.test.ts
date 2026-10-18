import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/database/create-database.js";
import type { Database } from "../../src/database/database.js";
import { migrateTo, migrateToLatest } from "../../src/database/migrator.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import {
  createMigrationDatabase,
  withMigrationDatabase,
  type MigrationDatabaseFixture,
} from "../support/migration-database.js";
import { required } from "../support/required.js";

registerFixedClock();
const databaseUrl = required(process.env["DATABASE_URL"]);
async function tableExists(database: Database, name: string): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`select exists (
    select 1 from information_schema.tables
    where table_schema = current_schema() and table_name = ${name}
  ) as exists`.execute(database);
  return required(result.rows[0]).exists;
}

describe("identity-linking rollback fixture", () => {
  const abort = new AbortController();
  let fixture: MigrationDatabaseFixture | undefined;
  let acquisition: Promise<MigrationDatabaseFixture> | undefined;
  let migrationStep = "prepare latest";
  let membershipRemoved: boolean;
  let identityRemoved: boolean;
  let identityRestored = false;
  // Every distinct preparation phase retains Vitest's existing bounded hook budget.
  beforeAll(async () => {
    acquisition = createMigrationDatabase(
      databaseUrl,
      `identity_migration_${randomUUID().replaceAll("-", "")}`,
      { signal: abort.signal },
    );
    fixture = await acquisition;
    await migrateToLatest(fixture.database);
  });
  beforeAll(async () => {
    migrationStep = "rollback to identity linking";
    const database = required(fixture).database;
    await migrateTo(database, "002-identity-linking");
    membershipRemoved = !(await tableExists(
      database,
      "membership_evidence_outbox",
    ));
  });
  beforeAll(async () => {
    migrationStep = "rollback to ordinary start";
    const database = required(fixture).database;
    await migrateTo(database, "001-ordinary-start");
    identityRemoved = !(await tableExists(database, "link_transactions"));
  });
  beforeAll(async () => {
    migrationStep = "restore latest";
    const database = required(fixture).database;
    await migrateToLatest(database);
    identityRestored = await tableExists(database, "link_transactions");
  });
  afterAll(async () => {
    if (!identityRestored)
      console.error("migration fixture failure", { migrationStep });
    abort.abort(new Error("Migration fixture cleanup"));
    // Acquisition may still be finishing after a hook timeout; its abort path owns cleanup.
    const acquired = fixture ?? (await acquisition?.catch(() => undefined));
    await acquired?.close();
  });
  it("rebuilds the identity-linking migration down and forward", () => {
    expect(membershipRemoved).toBe(true);
    expect(identityRemoved).toBe(true);
    expect(identityRestored).toBe(true);
  });
});

describe("failed migration fixture cleanup", () => {
  const abort = new AbortController();
  let preparation: Promise<void> | undefined;
  let failure: unknown;
  let failedDatabaseRemoved: boolean;
  let publicIdentityPreserved: boolean;
  beforeAll(async () => {
    preparation = (async () => {
      const name = `identity_migration_${randomUUID().replaceAll("-", "")}`;
      try {
        await withMigrationDatabase(
          databaseUrl,
          name,
          async (database) => {
            // Prepare the owning recovery migration, rather than the unrelated latest corpus.
            await migrateTo(database, "007-owner-identity-recovery");
            expect(
              await tableExists(database, "identity_link_recoveries"),
            ).toBe(true);
            await migrateTo(database, "001-ordinary-start");
            await sql`select * from identity_link_recoveries`.execute(database);
          },
          { signal: abort.signal },
        );
      } catch (error) {
        failure = error;
      }
      const database = createDatabase(databaseUrl);
      try {
        const result = await sql<{ exists: boolean }>`select exists (
          select 1 from pg_database where datname = ${name}
        ) as exists`.execute(database);
        failedDatabaseRemoved = !required(result.rows[0]).exists;
        publicIdentityPreserved = await tableExists(
          database,
          "identity_link_recoveries",
        );
        const expected = new Error("intentional migration fixture failure");
        await expect(
          withMigrationDatabase(
            databaseUrl,
            name,
            () => Promise.reject(expected),
            { signal: abort.signal },
          ),
        ).rejects.toBe(expected);
      } finally {
        await database.destroy();
      }
    })();
    await preparation;
  });
  afterAll(async () => {
    abort.abort(new Error("Failed migration fixture cleanup"));
    // Preserve the hook's primary failure; cancellation/drop terminates any blocked SQL first.
    await preparation?.catch(() => undefined);
  });
  it("removes a failed rollback fixture while preserving PostgreSQL diagnostics and runtime tables", () => {
    expect(failure).toMatchObject({
      code: "42P01",
      message: 'relation "identity_link_recoveries" does not exist',
    });
    expect(failedDatabaseRemoved).toBe(true);
    expect(publicIdentityPreserved).toBe(true);
  });
});

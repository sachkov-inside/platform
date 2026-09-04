import { describe, expect, test } from "vitest";

import { parseAppliedMigrations } from "../../src/infrastructure/postgres/migrate-to-latest.js";
import {
  expectedPgBossSchemaVersion,
  runtimeDatabaseSchemaIdentity,
} from "../../src/migrations/migrate.js";

describe("runtime database schema identity", () => {
  test("changes when the PgBoss schema target changes", () => {
    const migrations = [{ name: "0001_example", statement: "select 1" }];

    expect(
      runtimeDatabaseSchemaIdentity(migrations, expectedPgBossSchemaVersion),
    ).not.toBe(
      runtimeDatabaseSchemaIdentity(
        migrations,
        expectedPgBossSchemaVersion + 1,
      ),
    );
  });

  test("validates raw migration ledger rows at the database boundary", () => {
    expect(() =>
      parseAppliedMigrations([
        { checksum: "not-a-checksum", name: "0001_example", position: 1 },
      ]),
    ).toThrow();
  });
});

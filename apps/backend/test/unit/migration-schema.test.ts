import { describe, expect, test } from "vitest";

import { parseAppliedMigrations } from "../../src/infrastructure/postgres/migrate-to-latest.js";
import { runtimeSchemaReadiness as compatibleRuntimeSchemaReadiness } from "../../src/infrastructure/operational-readiness.js";
import { platformMigrations } from "../../src/migrations/index.js";
import { runtimeSchemaReadiness } from "../../src/migrations/runtime-schema.js";
import {
  expectedPgBossSchemaVersion,
  runtimeDatabaseSchemaIdentity,
} from "../../src/migrations/migrate.js";

describe("runtime database schema identity", () => {
  test("reports the complete deployed schema through both readiness callers", () => {
    const state = {
      appliedMigrations: platformMigrations.map(({ name }) => name),
      jobSchemaVersion: expectedPgBossSchemaVersion,
    };

    expect(compatibleRuntimeSchemaReadiness).toBe(runtimeSchemaReadiness);
    expect(runtimeSchemaReadiness(state)).toEqual({
      identity: runtimeDatabaseSchemaIdentity(
        platformMigrations,
        expectedPgBossSchemaVersion,
      ),
      migrationCount: platformMigrations.length,
    });
  });

  test.each([0, platformMigrations.length - 1, platformMigrations.length + 1])(
    "rejects migration count %i before reporting readiness",
    (count) => {
      for (const readiness of [
        runtimeSchemaReadiness,
        compatibleRuntimeSchemaReadiness,
      ]) {
        expect(() =>
          readiness({
            appliedMigrations: Array.from({ length: count }, () => "migration"),
            jobSchemaVersion: expectedPgBossSchemaVersion,
          }),
        ).toThrow(
          `Expected ${platformMigrations.length} Platform migrations, received ${count}`,
        );
      }
    },
  );

  test.each([
    null,
    0,
    expectedPgBossSchemaVersion - 1,
    expectedPgBossSchemaVersion + 1,
  ])(
    "rejects PgBoss schema %s before reporting readiness",
    (jobSchemaVersion) => {
      for (const readiness of [
        runtimeSchemaReadiness,
        compatibleRuntimeSchemaReadiness,
      ]) {
        expect(() =>
          readiness({
            appliedMigrations: platformMigrations.map(({ name }) => name),
            jobSchemaVersion,
          }),
        ).toThrow(
          `Expected PgBoss schema ${expectedPgBossSchemaVersion}, received ${String(jobSchemaVersion)}`,
        );
      }
    },
  );

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

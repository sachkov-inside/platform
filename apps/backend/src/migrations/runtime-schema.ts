import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import { sha256IdentitySchema } from "@inside/runtime-identity";
import { z } from "zod";

import {
  migrationRegistryIdentity,
  type Migration,
  type MigrationVerification,
} from "../infrastructure/postgres/migrate-to-latest.js";

import { platformMigrations } from "./index.js";

const pgBossPackageSchema = z.object({
  pgboss: z.object({
    schema: z.number().int().positive(),
  }),
});
const pgBossSchemaVersionSchema = z.number().int().positive().nullable();
const require = createRequire(import.meta.url);
const pgBossPackage: unknown = require("pg-boss/package.json");

export const expectedPgBossSchemaVersion =
  pgBossPackageSchema.parse(pgBossPackage).pgboss.schema;

export function runtimeDatabaseSchemaIdentity(
  migrations: readonly Migration[],
  jobSchemaVersion: number | null,
): string {
  jobSchemaVersion = pgBossSchemaVersionSchema.parse(jobSchemaVersion);
  return sha256IdentitySchema.parse(
    `sha256:${createHash("sha256")
      .update(
        JSON.stringify({
          jobSchemaVersion,
          platformMigrationRegistry: migrationRegistryIdentity(migrations),
        }),
      )
      .digest("hex")}`,
  );
}

export interface RuntimeSchemaReadiness {
  readonly identity: string;
  readonly migrationCount: number;
}

export function runtimeSchemaReadiness(
  migrationState: MigrationVerification,
): RuntimeSchemaReadiness {
  if (migrationState.appliedMigrations.length !== platformMigrations.length) {
    throw new Error(
      `Expected ${String(platformMigrations.length)} Platform migrations, received ${String(migrationState.appliedMigrations.length)}`,
    );
  }
  const { jobSchemaVersion } = migrationState;
  if (jobSchemaVersion !== expectedPgBossSchemaVersion) {
    throw new Error(
      `Expected PgBoss schema ${String(expectedPgBossSchemaVersion)}, received ${String(jobSchemaVersion)}`,
    );
  }
  return {
    identity: runtimeDatabaseSchemaIdentity(
      platformMigrations,
      jobSchemaVersion,
    ),
    migrationCount: platformMigrations.length,
  };
}

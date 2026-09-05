import { pathToFileURL } from "node:url";

import { sha256IdentitySchema } from "@inside/runtime-identity";
import { PgBoss } from "pg-boss";

import { loadRepositoryEnvironment } from "../config/load-repository-environment.js";
import {
  parsePlatformDatabaseConfig,
  parsePlatformMode,
} from "../config/platform-config.js";
import { parseRuntimeIdentity } from "../infrastructure/runtime-identity.js";
import { verifyMigrationState } from "../infrastructure/postgres/migrate-to-latest.js";
import { migrateToLatest, platformMigrations } from "./index.js";
import {
  expectedPgBossSchemaVersion,
  runtimeDatabaseSchemaIdentity,
} from "./runtime-schema.js";

export {
  expectedPgBossSchemaVersion,
  runtimeDatabaseSchemaIdentity,
} from "./runtime-schema.js";

export interface RuntimeMigrationOutcome {
  readonly appliedMigrations: readonly string[];
  readonly jobSchemaVersion: number;
}

export async function migrateRuntimeDatabase(
  databaseUrl: string,
  options: { readonly afterPlatformMigrations?: () => void | Promise<void> } = {},
): Promise<RuntimeMigrationOutcome> {
  const outcome = await migrateToLatest(databaseUrl);
  await options.afterPlatformMigrations?.();
  const jobs = new PgBoss({
    connectionString: databaseUrl,
    schema: "pgboss",
    schedule: false,
    supervise: false,
  });
  let started = false;
  try {
    await jobs.start();
    started = true;
    const jobSchemaVersion = await jobs.schemaVersion();
    if (jobSchemaVersion === null) {
      throw new Error("PgBoss schema version is unavailable after startup");
    }
    return { ...outcome, jobSchemaVersion };
  } finally {
    if (started) {
      await jobs.stop({ close: true, graceful: true });
    }
  }
}

export interface RuntimeSchemaVerification {
  readonly appliedMigrations: readonly string[];
  readonly identity: string;
  readonly jobSchemaVersion: number | null;
}

export async function verifyRuntimeDatabaseSchema(
  databaseUrl: string,
  expectedIdentity: string,
): Promise<RuntimeSchemaVerification> {
  expectedIdentity = sha256IdentitySchema.parse(expectedIdentity);
  const migrationState = await verifyMigrationState(
    databaseUrl,
    platformMigrations,
  );
  const { jobSchemaVersion } = migrationState;
  const identity = runtimeDatabaseSchemaIdentity(
    platformMigrations.slice(0, migrationState.appliedMigrations.length),
    jobSchemaVersion,
  );
  if (identity !== expectedIdentity) {
    throw new Error(
      "Runtime database schema identity does not match the deployed release",
    );
  }
  return { ...migrationState, identity };
}

export async function verifyRuntimeDatabaseSchemaCompatibility(
  databaseUrl: string,
): Promise<RuntimeSchemaVerification> {
  const migrationState = await verifyMigrationState(
    databaseUrl,
    platformMigrations,
  );
  const { jobSchemaVersion } = migrationState;
  if (
    jobSchemaVersion !== null &&
    jobSchemaVersion > expectedPgBossSchemaVersion
  ) {
    throw new Error(
      `PgBoss schema ${String(jobSchemaVersion)} is newer than supported schema ${String(expectedPgBossSchemaVersion)}`,
    );
  }
  return {
    ...migrationState,
    identity: runtimeDatabaseSchemaIdentity(
      platformMigrations.slice(0, migrationState.appliedMigrations.length),
      jobSchemaVersion,
    ),
  };
}

async function main(): Promise<void> {
  loadRepositoryEnvironment();
  const databaseConfig = parsePlatformDatabaseConfig(process.env);
  const runtimeIdentity = parseRuntimeIdentity(
    process.env,
    parsePlatformMode(process.env.NODE_ENV),
  );
  const [operation, expectedIdentity, extra] = process.argv.slice(2);
  if (
    extra !== undefined ||
    (operation !== undefined &&
      operation !== "--verify-schema-identity" &&
      operation !== "--verify-schema-compatible") ||
    (operation === "--verify-schema-identity") !==
      (expectedIdentity !== undefined) ||
    (operation === "--verify-schema-compatible" &&
      expectedIdentity !== undefined)
  ) {
    throw new Error(
      "usage: migrate.js [--verify-schema-identity <sha256:identity>|--verify-schema-compatible]",
    );
  }
  const outcome =
    operation === "--verify-schema-identity" && expectedIdentity !== undefined
      ? await verifyRuntimeDatabaseSchema(databaseConfig.url, expectedIdentity)
      : operation === "--verify-schema-compatible"
        ? await verifyRuntimeDatabaseSchemaCompatibility(databaseConfig.url)
        : await migrateRuntimeDatabase(databaseConfig.url);
  process.stdout.write(`${JSON.stringify({ ...outcome, release: runtimeIdentity })}\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}

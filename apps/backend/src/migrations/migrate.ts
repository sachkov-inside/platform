import { pathToFileURL } from "node:url";

import { PgBoss } from "pg-boss";

import { loadRepositoryEnvironment } from "../config/load-repository-environment.js";
import {
  parsePlatformDatabaseConfig,
  parsePlatformMode,
} from "../config/platform-config.js";
import { parseRuntimeIdentity } from "../infrastructure/runtime-identity.js";
import { verifyMigrationLedger } from "../infrastructure/postgres/migrate-to-latest.js";
import { migrateToLatest, platformMigrations } from "./index.js";

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

export async function verifyRuntimeDatabaseMigrationLedger(
  databaseUrl: string,
): Promise<{ readonly appliedMigrations: readonly string[] }> {
  return verifyMigrationLedger(databaseUrl, platformMigrations);
}

async function main(): Promise<void> {
  loadRepositoryEnvironment();
  const databaseConfig = parsePlatformDatabaseConfig(process.env);
  const runtimeIdentity = parseRuntimeIdentity(
    process.env,
    parsePlatformMode(process.env.NODE_ENV),
  );
  const [operation, extra] = process.argv.slice(2);
  if (extra !== undefined || (operation !== undefined && operation !== "--verify-ledger")) {
    throw new Error("usage: migrate.js [--verify-ledger]");
  }
  const outcome =
    operation === "--verify-ledger"
      ? await verifyRuntimeDatabaseMigrationLedger(databaseConfig.url)
      : await migrateRuntimeDatabase(databaseConfig.url);
  process.stdout.write(`${JSON.stringify({ ...outcome, release: runtimeIdentity })}\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}

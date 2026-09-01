import { PgBoss } from "pg-boss";

import { loadRepositoryEnvironment } from "../config/load-repository-environment.js";
import { parsePlatformDatabaseConfig } from "../config/platform-config.js";
import { migrateToLatest } from "./index.js";

async function main(): Promise<void> {
  loadRepositoryEnvironment();
  const databaseConfig = parsePlatformDatabaseConfig(process.env);
  const outcome = await migrateToLatest(databaseConfig.url);
  const jobs = new PgBoss({
    connectionString: databaseConfig.url,
    schema: "pgboss",
    schedule: false,
    supervise: false,
  });
  await jobs.start();
  const jobSchemaVersion = await jobs.schemaVersion();
  await jobs.stop({ close: true, graceful: true });
  process.stdout.write(`${JSON.stringify({ ...outcome, jobSchemaVersion })}\n`);
}

void main();

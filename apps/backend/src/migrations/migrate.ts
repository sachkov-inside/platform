import { loadRepositoryEnvironment } from "../config/load-repository-environment.js";
import { parsePlatformDatabaseConfig } from "../config/platform-config.js";
import { createPlatformDatabase } from "../infrastructure/postgres/create-platform-database.js";
import { migrateToLatest } from "./index.js";

async function main(): Promise<void> {
  loadRepositoryEnvironment();
  const databaseConfig = parsePlatformDatabaseConfig(process.env);
  const database = createPlatformDatabase(databaseConfig.url);
  try {
    const outcome = await migrateToLatest(database);
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
  } finally {
    await database.destroy();
  }
}

void main();

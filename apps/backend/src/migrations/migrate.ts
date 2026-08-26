import { loadRepositoryEnvironment } from "../config/load-repository-environment.js";
import { parsePlatformDatabaseConfig } from "../config/platform-config.js";
import { migrateToLatest } from "./index.js";

async function main(): Promise<void> {
  loadRepositoryEnvironment();
  const databaseConfig = parsePlatformDatabaseConfig(process.env);
  const outcome = await migrateToLatest(databaseConfig.url);
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
}

void main();

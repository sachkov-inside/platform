import { loadPlatformConfig } from "../config/load-platform-config.js";
import { createPlatformDatabase } from "../infrastructure/postgres/create-platform-database.js";
import { migrateToLatest } from "./index.js";

async function main(): Promise<void> {
  const database = createPlatformDatabase(loadPlatformConfig().database.url);
  try {
    const outcome = await migrateToLatest(database);
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
  } finally {
    await database.destroy();
  }
}

void main();

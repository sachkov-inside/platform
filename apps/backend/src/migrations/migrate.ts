import { readDatabaseConfig } from "../config/database.js";
import { createPlatformDatabase } from "../infrastructure/postgres/create-platform-database.js";
import { migrateToLatest } from "./index.js";

async function main(): Promise<void> {
  const database = createPlatformDatabase(readDatabaseConfig().url);
  try {
    const outcome = await migrateToLatest(database);
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
  } finally {
    await database.destroy();
  }
}

void main();

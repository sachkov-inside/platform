import { readDatabaseConfig } from "../../config/database.js";
import { createPlatformDatabase } from "./create-platform-database.js";
import { migrateToLatest } from "./migrate-to-latest.js";

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

import { loadPlatformConfig } from "../config/load-platform-config.js";
import { createPlatformDatabase } from "../infrastructure/postgres/create-platform-database.js";
import { seedLocalDevelopment } from "./seed-local-development.js";

async function main(): Promise<void> {
  const config = loadPlatformConfig();
  if (config.mode !== "development") {
    throw new Error("Local seed runs only with NODE_ENV=development");
  }

  const database = createPlatformDatabase(config.database.url);
  try {
    const seed = await seedLocalDevelopment(database);
    process.stdout.write(`${JSON.stringify(seed)}\n`);
  } finally {
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

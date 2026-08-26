import { loadPlatformConfig } from "../config/load-platform-config.js";
import { createPrismaClient } from "../infrastructure/prisma/index.js";
import { seedLocalDevelopment } from "./seed-local-development.js";

async function main(): Promise<void> {
  const config = loadPlatformConfig();
  if (config.mode !== "development") {
    throw new Error("Local seed runs only with NODE_ENV=development");
  }

  const prisma = createPrismaClient(config.database.url);
  try {
    const seed = await seedLocalDevelopment(prisma);
    process.stdout.write(`${JSON.stringify(seed)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

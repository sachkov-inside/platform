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
    // The shared stand is the default target, so demos stay hidden unless a check asks for them.
    const demo = process.env.LOCAL_SEED_DEMO ?? "hidden";
    if (demo !== "published" && demo !== "hidden") {
      throw new Error("LOCAL_SEED_DEMO must be published or hidden");
    }
    const seed = await seedLocalDevelopment(prisma, { demo });
    process.stdout.write(`${JSON.stringify(seed)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

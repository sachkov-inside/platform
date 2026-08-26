import { PrismaClient } from "./generated/client.js";
import { createPrismaPgAdapter } from "./prisma-adapter.js";
import type { PlatformPrisma } from "./prisma-client.js";

export function createPrismaClient(connectionString: string): PlatformPrisma {
  return new PrismaClient({
    adapter: createPrismaPgAdapter(connectionString),
  });
}

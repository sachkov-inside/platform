import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../src/infrastructure/prisma/generated/client.js";
import type { PlatformPrisma } from "../../../src/infrastructure/prisma/index.js";
import type { TestDatabase } from "./test-database.js";

/** Only stops a run whose operation asked the pool for a second connection. */
const SECOND_CONNECTION_WAIT_MS = 2_000;

/**
 * A client whose pool is one connection. An open transaction holds all of it, as concurrent
 * operations hold the whole production pool: an operation that asks for another connection while
 * its transaction is open waits for itself and fails, instead of finishing.
 */
export async function withExhaustedPool<Result>(
  database: TestDatabase,
  scenario: (prisma: PlatformPrisma) => Promise<Result>,
): Promise<Result> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: database.url,
      max: 1,
      connectionTimeoutMillis: SECOND_CONNECTION_WAIT_MS,
    }),
  });
  try {
    return await scenario(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

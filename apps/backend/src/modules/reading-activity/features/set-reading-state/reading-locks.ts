import { Prisma, type ReadingActivityPrisma } from "../../../../infrastructure/prisma/index.js";

export async function lockReadingCommand(transaction: ReadingActivityPrisma, accountId: string, commandId: string): Promise<void> {
  const key = `reading-command:${accountId}:${commandId}`;
  await transaction.$executeRaw(Prisma.sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0::bigint))`);
}

export async function lockReadingPair(transaction: ReadingActivityPrisma, accountId: string, materialId: string): Promise<void> {
  const key = `reading-pair:${accountId}:${materialId}`;
  await transaction.$executeRaw(Prisma.sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0::bigint))`);
}

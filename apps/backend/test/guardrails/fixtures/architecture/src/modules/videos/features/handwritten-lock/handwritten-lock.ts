import { Prisma } from "../../../../infrastructure/prisma/index.js";

// A key written by hand here would silently stop excluding Material Save if its owner renamed it.
export async function lockMaterialByHand(
  transaction: { $executeRaw(query: Prisma.Sql): Promise<number> },
  materialId: string,
): Promise<void> {
  await transaction.$executeRaw(Prisma.sql`
    select pg_advisory_xact_lock(hashtextextended(${materialId}, 0))
  `);
}

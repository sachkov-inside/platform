import {
  type IdentityPrincipalsPrisma,
  Prisma,
} from "../../../../infrastructure/prisma/index.js";

export async function acquireAdvisoryLocks(
  prisma: IdentityPrincipalsPrisma,
  lockKeys: readonly string[],
): Promise<void> {
  for (const lockKey of [...lockKeys].sort()) {
    await prisma.$queryRaw(Prisma.sql`
      select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))::text
    `);
  }
}

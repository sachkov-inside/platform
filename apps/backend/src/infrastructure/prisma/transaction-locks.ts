import { Prisma } from "./generated/client.js";

interface AdvisoryLockTransaction {
  $executeRaw(query: Prisma.Sql): Promise<number>;
}

export async function lockAccountEntitlementChanges(
  transaction: AdvisoryLockTransaction,
  accountId: string,
): Promise<void> {
  const key = `account-entitlement:${accountId}`;
  await transaction.$executeRaw(Prisma.sql`
    select pg_advisory_xact_lock(hashtextextended(${key}, 0::bigint))
  `);
}

export async function lockMaterialReferenceChanges(
  transaction: AdvisoryLockTransaction,
  materialIds: readonly string[],
): Promise<void> {
  const orderedIds = [...new Set(materialIds)].sort();
  for (const materialId of orderedIds) {
    await transaction.$executeRaw(Prisma.sql`
      select pg_advisory_xact_lock(hashtextextended(${materialId}, 0::bigint))
    `);
  }
}

/** Same key as the durable Telegram binding trigger; holds a verified binding through commit. */
export async function lockTelegramAccountBinding(transaction: AdvisoryLockTransaction, accountId: string): Promise<void> {
  await transaction.$executeRaw(Prisma.sql`select pg_advisory_xact_lock(hashtextextended(${`telegram-link-state:${accountId}`}, 0::bigint))`);
}

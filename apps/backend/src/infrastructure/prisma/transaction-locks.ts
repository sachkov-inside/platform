import { Prisma } from "./generated/client.js";

interface AdvisoryLockTransaction {
  $executeRaw(query: Prisma.Sql): Promise<number>;
}

/**
 * The single source of transaction advisory lock keys. Two operations exclude each other only when
 * they call the same function here; `scripts/check-backend-architecture.mjs` rejects a lock written
 * anywhere else, so a key cannot drift between the Modules that share it.
 */
async function lockTransactionKey(transaction: AdvisoryLockTransaction, key: string): Promise<void> {
  await transaction.$executeRaw(Prisma.sql`
    select pg_advisory_xact_lock(hashtextextended(${key}, 0::bigint))
  `);
}

export async function lockAccountEntitlementChanges(
  transaction: AdvisoryLockTransaction,
  accountId: string,
): Promise<void> {
  await lockTransactionKey(transaction, `account-entitlement:${accountId}`);
}

/**
 * Serializes every change of what a Material references with the cleanup that trusts it: Save,
 * draft deletion, Guide order and Workshop Cases against orphan Asset cleanup and Video deletion.
 * Keys are taken in one order, so callers that lock several Materials cannot deadlock each other.
 */
export async function lockMaterialReferenceChanges(
  transaction: AdvisoryLockTransaction,
  materialIds: readonly string[],
): Promise<void> {
  const orderedIds = [...new Set(materialIds)].sort();
  for (const materialId of orderedIds) {
    await lockTransactionKey(transaction, `material-references:${materialId}`);
  }
}

/** Serializes a cover change of one Material, Topic or Series with its orphan cleanup. */
export async function lockContentCoverOwner(
  transaction: AdvisoryLockTransaction,
  owner: Readonly<{ id: string; kind: "material" | "series" | "topic" }>,
): Promise<void> {
  await lockTransactionKey(transaction, `${owner.kind}:${owner.id}`);
}

/** Serializes slug allocation, so two first publications cannot take the same slug. */
export async function lockMaterialSlugAllocation(transaction: AdvisoryLockTransaction): Promise<void> {
  await lockTransactionKey(transaction, "materials:slug-allocation");
}

/** Same key as the durable Telegram binding trigger; holds a verified binding through commit. */
export async function lockTelegramAccountBinding(transaction: AdvisoryLockTransaction, accountId: string): Promise<void> {
  await lockTransactionKey(transaction, `telegram-link-state:${accountId}`);
}
